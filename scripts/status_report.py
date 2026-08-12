#!/usr/bin/env python3
"""Campaign status report with deltas since the previous report.

Prints one line per active run (progress, rating +/- deviation, tokens, cost),
campaign totals, and health checks -- unsynced items, dead runs, keepalive
restarts -- so a stalled or silently-failing run is visible rather than implied
by a number that stopped moving.

State for the delta column is kept in runs/monitor-state/status-report.json.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import sqlite3
import subprocess
import urllib.request
from datetime import datetime, timezone

REPO = pathlib.Path(__file__).resolve().parent.parent
STATE = REPO / "runs" / "monitor-state" / "status-report.json"


def load_env() -> None:
    for line in (REPO / ".env").read_text().splitlines():
        if "=" in line and not line.strip().startswith("#"):
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def credits() -> tuple[float | None, float | None]:
    try:
        req = urllib.request.Request(
            "https://openrouter.ai/api/v1/key",
            headers={"Authorization": "Bearer " + os.environ["OPENROUTER_API_KEY"]},
        )
        data = json.load(urllib.request.urlopen(req, timeout=30))["data"]
        return float(data.get("usage") or 0.0), data.get("limit")
    except Exception:  # noqa: BLE001 - the report must survive a flaky key check
        return None, None


def live_ratings() -> dict[str, tuple[float, float, int]]:
    """Latest rating/RD per run label, parsed from the keepalive run logs.

    summary_json is only written when a run finishes, so an in-progress run has
    no rating there. The runner prints `  n/100  rating 1,844 +/- 127  solved 5`
    after every puzzle, which is the live Glicko-2 estimate.
    """
    out: dict[str, tuple[float, float, int]] = {}
    pattern = re.compile(
        r"^\s*(\d+)/\d+\s+rating\s+([\d,]+)\s*±\s*(\d+)\s+solved\s+(\d+)", re.M
    )
    for log in (REPO / "runs/adaptive-supervisor").glob("*.keepalive.log"):
        matches = pattern.findall(log.read_text())
        if matches:
            _, rating, rd, solved = matches[-1]
            out[log.name.split(".keepalive")[0]] = (
                float(rating.replace(",", "")), float(rd), int(solved)
            )
    return out


def live_processes() -> set[tuple[str, str, str]]:
    """(model, effort, seed) for every rate-model process currently running.

    A run row stays 'running' in the database when its process dies, so the row
    alone cannot tell a slow puzzle from a dead run -- only the process can.
    Model labels are slugified to match variant keys (``muse-spark-1.2`` ->
    ``muse-spark-1-2``).
    """
    out: set[tuple[str, str, str]] = set()
    try:
        ps = subprocess.run(
            ["ps", "-eo", "command"], capture_output=True, text=True, timeout=30
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return out
    # The flags are not adjacent and their order is not stable, so match each
    # independently rather than assuming a layout. A run with no --reasoning is
    # at the provider default, which the variant key records as "default".
    for line in ps.splitlines():
        if "rate-model" not in line:
            continue
        model = re.search(r"--model\s+(\S+)", line)
        seed = re.search(r"--seed\s+(\d+)", line)
        if not model or not seed:
            continue
        effort = re.search(r"--reasoning\s+(\S+)", line)
        out.add((
            model.group(1).replace(".", "-"),
            effort.group(1) if effort else "default",
            seed.group(1),
        ))
    return out


def supervised() -> set[tuple[str, str, str]]:
    """(model, effort, seed) for every run a keepalive spec is responsible for.

    Between a crash and the supervisor's next poll a run sits at status
    'partial' with no process. That is a run awaiting relaunch, not an abandoned
    one, so it must stay in the totals -- otherwise the campaign's run count and
    puzzle count drop for a cycle and recover, which reads as lost work.
    """
    out: set[tuple[str, str, str]] = set()
    for spec in (REPO / "runs").glob("keepalive-*.json"):
        try:
            entries = (json.loads(spec.read_text()) or {}).get("runs") or []
        except (OSError, json.JSONDecodeError, AttributeError):
            continue
        for entry in entries:
            out.add((
                str(entry["model"]).replace(".", "-"),
                str(entry["reasoning"]),
                str(entry["seed"]),
            ))
    return out


def variant_of(variant_key: str, seed: object) -> tuple[str, str, str]:
    """(model, effort, seed) identity shared by run rows, processes and specs."""
    name = variant_key.split("--")[0]
    # "r-high-captured" -> "high"; the -captured suffix marks reasoning capture,
    # not a distinct effort level, and the keepalive labels omit it.
    effort = next(
        (p[2:].removesuffix("-captured")
         for p in variant_key.split("--") if p.startswith("r-")),
        "?",
    )
    return name, effort, str(seed)


def spec_labels() -> dict[tuple[str, str, str], str]:
    """(model, effort, seed) -> the keepalive label, read from the specs.

    A run's log file is named after its spec label, which is free text and does
    not follow from the variant key -- ``grok-4.6`` writes ``grok46-*``. Reading
    the specs keeps that association exact; a hand-maintained table silently
    stops resolving the moment a campaign picks a new label style, and the only
    symptom is a live rating column that quietly stays empty.
    """
    out: dict[tuple[str, str, str], str] = {}
    for spec in (REPO / "runs").glob("keepalive-*.json"):
        try:
            entries = (json.loads(spec.read_text()) or {}).get("runs") or []
        except (OSError, json.JSONDecodeError, AttributeError):
            continue
        for entry in entries:
            label = entry.get("label")
            if not label:
                continue
            out[(
                str(entry["model"]).replace(".", "-"),
                str(entry.get("reasoning", "default")),
                str(entry.get("seed", 0)),
            )] = str(label)
    return out


def label_to_log(name: str, effort: str, seed: object, labels: dict | None = None) -> str:
    """Log stem for a variant, preferring the spec's own label."""
    known = (labels or {}).get((name, effort, str(seed)))
    if known:
        return known
    # Runs launched outside a spec still follow the historical naming.
    stem = {
        "deepseek-v4-flash-0423": "ds-flash-0423",
        "deepseek-v4-pro": "ds-pro",
        "deepseek-v4": "ds-pro",
        "muse-spark-1-1": "muse1.1",
        "muse-spark-1-2": "muse1.2",
        "grok-4-5": "grok45",
    }.get(name, name.replace("qwen3-7-", "qwen3.7-").replace("qwen3-8-", "qwen3.8-"))
    return f"{stem}-{effort}-s{seed}"


def contamination(con: sqlite3.Connection, hours: float) -> str:
    """Losses where the model never produced a usable answer, per run.

    These are scored as losses but measure the provider, not chess ability, so
    they deflate a rating. A provider error on an earlier turn does not count --
    if a later turn returned a real move the loss is the model's own. The
    infra-failure cap converts a blocked puzzle into one of these, so this is
    the number that says whether the cap is buying liveness too cheaply.
    """
    last = "'$.turns[' || (json_array_length(a.result_json,'$.turns')-1) || '].%s'"
    rows = con.execute(
        f"""SELECT r.variant_key, json_extract(r.protocol_json,'$.selection.seed'),
                   COUNT(*),
                   SUM(CASE WHEN NOT json_extract(a.result_json,'$.solved')
                             AND json_array_length(a.result_json,'$.turns') > 0
                             AND json_extract(a.result_json, {last % 'model_error'})
                                 IS NOT NULL
                             AND json_extract(a.result_json, {last % 'parsed_move'})
                                 IS NULL
                            THEN 1 ELSE 0 END)
            FROM puzzle_attempt a JOIN benchmark_run r ON r.run_id=a.run_id
            WHERE r.suite_name='rated-lichess-v1'
              AND (julianday('now')-julianday(r.updated_at))*24 < ?
            GROUP BY r.run_id""",
        (hours,),
    ).fetchall()
    dirty = [(vk.split("--")[0], seed, bad, n) for vk, seed, n, bad in rows if bad]
    total = sum(bad for _, _, bad, _ in dirty)
    attempts = sum(n for _, _, n, _ in rows)
    if not attempts:
        return "no-answer losses: none"
    worst = sorted(dirty, key=lambda x: x[2] / x[3], reverse=True)[:3]
    detail = ", ".join(f"{name}/s{seed} {bad}/{n}" for name, seed, bad, n in worst)
    return (f"no-answer losses: {total}/{attempts} ({100*total/attempts:.1f}%)"
            + (f" · worst: {detail}" if detail else ""))


def rating_of(summary: str | None) -> tuple[float | None, float | None, bool]:
    if not summary:
        return None, None, False
    try:
        block = (json.loads(summary) or {}).get("puzzle_performance_rating") or {}
    except json.JSONDecodeError:
        return None, None, False
    return block.get("rating"), block.get("rating_deviation"), bool(block.get("provisional"))


def main() -> int:
    load_env()
    ap = argparse.ArgumentParser()
    # The campaign spans days; a 24h window silently drops finished runs from the
    # totals and makes progress look like it went backwards between reports.
    ap.add_argument("--hours", type=float, default=96.0, help="window for 'active' runs")
    ap.add_argument("--target", type=int, default=50)
    args = ap.parse_args()

    con = sqlite3.connect(f"file:{REPO / 'runs/chessbench.db'}?mode=ro", uri=True)
    rows = con.execute(
        """SELECT run_id, variant_key, status, completed_items, cost_usd,
                  prompt_tokens, completion_tokens, reasoning_tokens, summary_json,
                  json_extract(protocol_json,'$.selection.seed') AS seed,
                  -- julianday() differences are in days, so minutes is *1440.
                  (julianday('now')-julianday(updated_at))*1440 AS min_ago
           FROM benchmark_run
           WHERE suite_name='rated-lichess-v1'
             AND (julianday('now')-julianday(updated_at))*24 < ?
           ORDER BY variant_key, seed""",
        (args.hours,),
    ).fetchall()

    prev = {}
    if STATE.exists():
        try:
            prev = json.loads(STATE.read_text())
        except json.JSONDecodeError:
            prev = {}
    prev_runs = prev.get("runs", {})
    lives = live_ratings()
    labels = spec_labels()

    now = datetime.now(timezone.utc)
    print(f"CHESSBENCH STATUS  {now:%Y-%m-%d %H:%M UTC}")
    if prev.get("at"):
        print(f"(delta vs {prev['at']})")
    print()
    header = (
        f"{'model':24} {'reason':8} {'sd':>3} {'done':>7} {'Δ':>4} "
        f"{'rating':>7} {'RD':>5} {'tokens':>11} {'cost':>8}  status"
    )
    # Completed runs are summarised above the table, so collect the live rows
    # first and emit everything after the loop.
    live_rows: list[str] = []

    tot = {"done": 0, "delta": 0, "cost": 0.0, "tok": 0, "runs": 0, "complete": 0}
    state_runs = {}
    stalled: list[str] = []
    slow: list[str] = []
    procs = live_processes()
    specs = supervised()
    waiting: list[str] = []
    # Newest run row per variant (min_ago is smallest for the most recent).
    newest: dict[tuple[str, str, str], str] = {}
    for row in sorted(rows, key=lambda r: r[10] if r[10] is not None else 1e9):
        newest.setdefault(variant_of(row[1], row[9]), row[0])
    stale: list[tuple[str, int, float]] = []
    done_groups: dict[tuple[str, str], list[tuple[object, float, float]]] = {}
    for (rid, vk, status, done, cost, ptok, ctok, rtok, summary, seed, min_ago) in rows:
        name = vk.split("--")[0]
        # "r-high-captured" -> "high"; the -captured suffix marks reasoning capture,
        # not a distinct effort level, and the keepalive labels omit it.
        effort = next(
            (p[2:].removesuffix("-captured") for p in vk.split("--") if p.startswith("r-")),
            "?",
        )
        label = f"{name}/{effort}/s{seed}"
        rating, rd, provisional = rating_of(summary)
        if rating is None and status == "running":
            live = lives.get(label_to_log(name, effort, seed, labels))
            if live:
                rating, rd = live[0], live[1]
        tokens = int((ptok or 0) + (ctok or 0))
        before = prev_runs.get(rid, {}).get("done")
        delta = (done - before) if isinstance(before, int) else None

        # A stopped run a keepalive spec still owns is between launches, not
        # abandoned: keep it in the totals and show it as awaiting relaunch.
        # Only the newest row for a variant qualifies -- an older row the
        # supervisor already replaced is abandoned however live the spec is.
        owned = (name, effort, str(seed)) in specs and newest.get(
            (name, effort, str(seed))
        ) == rid
        superseded = (
            status not in ("running", "completed")
            and done < args.target
            and not owned
        )
        if superseded:
            stale.append((label, done, cost or 0.0))
            continue
        if status not in ("running", "completed") and done < args.target:
            waiting.append(label)
        tot["runs"] += 1
        tot["done"] += done
        tot["cost"] += cost or 0.0
        tot["tok"] += tokens
        if delta:
            tot["delta"] += delta
        if done >= args.target or status == "completed":
            tot["complete"] += 1
        # A row still marked running with no process behind it is a dead run the
        # supervisor has not relaunched yet -- the one case that needs a human.
        if status == "running" and (name, effort, str(seed)) not in procs:
            stalled.append(f"{label} (no process)")
        # Long xhigh puzzles legitimately take 45+ min, so only flag a gap that
        # exceeds --request-total-timeout (7200s), which no single turn can.
        elif status == "running" and min_ago and min_ago > 120:
            slow.append(f"{label} ({min_ago/60:.1f}h since last puzzle)")

        if status == "completed" or done >= args.target:
            # Finished runs are summarised above the table, not repeated row by row.
            done_groups.setdefault((name, effort), []).append((seed, rating, cost or 0.0))
            state_runs[rid] = {"done": done, "cost": cost, "tokens": tokens}
            continue

        live_rows.append(
            f"{name[:24]:24} {effort[:8]:8} {str(seed):>3} "
            f"{str(done)+'/'+str(args.target):>7} "
            f"{('+'+str(delta)) if delta else ('-' if delta==0 else '·'):>4} "
            f"{(f'{rating:.0f}' if rating else '-'):>7} "
            f"{(f'{rd:.0f}' if rd else '-'):>5} "
            f"{tokens:>11,} {('$'+format(cost or 0,'.2f')):>8}  {status}"
            + ("  PROVISIONAL" if provisional else "")
        )
        state_runs[rid] = {"done": done, "cost": cost, "tokens": tokens}

    if done_groups:
        n_done = sum(len(v) for v in done_groups.values())
        spent = sum(c for v in done_groups.values() for _, _, c in v)
        print(f"COMPLETED ({n_done} runs, ${spent:.2f}) — ratings by seed")
        for (name, effort), seeds in sorted(done_groups.items()):
            seeds.sort(key=lambda x: str(x[0]))
            shown = " / ".join(f"{r:.0f}" if r else "-" for _, r, _ in seeds)
            print(f"  {name[:24]:24} {effort[:8]:8} {shown}")
        print()

    if live_rows:
        print(f"RUNNING ({len(live_rows)})")
        print(header)
        print("-" * len(header))
        for line in live_rows:
            print(line)

    if stale:
        print()
        print("SUPERSEDED (stopped, not in any keepalive spec; excluded from totals)")
        for label, done, cost in stale:
            print(f"  {label[:34]:34} {done}/{args.target}  ${cost:.2f}")
    remaining = max(0, tot["runs"] * args.target - tot["done"])
    spend, limit = credits()
    print()
    print(f"TOTALS  {tot['done']} puzzles done · {remaining} remaining · "
          f"{tot['complete']}/{tot['runs']} runs at target")
    print(f"        +{tot['delta']} since last report · {tot['tok']:,} tokens · "
          f"${tot['cost']:.2f} run cost")
    if spend is not None:
        prev_spend = prev.get("spend")
        d = f" (+${spend-prev_spend:.2f})" if isinstance(prev_spend, (int, float)) else ""
        print(f"        OpenRouter credits: ${spend:.2f}{d}" + (f" / limit {limit}" if limit else " (no cap)"))

    # --- health ---
    print("\nHEALTH")
    live = subprocess.run(
        ["bash", "-lc", "ps -eo command | grep -c '[r]ate-model'"],
        capture_output=True, text=True,
    ).stdout.strip()
    print(f"  live rate-model processes: {live}")
    # A live run lags by design (--live-sync-every 5); only a stopped run with
    # undelivered items is a real backlog.
    lagging, stranded = con.execute(
        """SELECT
             SUM(CASE WHEN status='running' THEN 1 ELSE 0 END),
             SUM(CASE WHEN status!='running' THEN 1 ELSE 0 END)
           FROM benchmark_run r
           WHERE r.completed_items >
                 (SELECT COUNT(*) FROM sync_delivery s WHERE s.run_id=r.run_id)"""
    ).fetchone()
    print(f"  sync: {lagging or 0} live run(s) mid-flush (normal), "
          f"{stranded or 0} stopped run(s) unsynced"
          + ("  <-- CHECK" if stranded else ""))
    for log in sorted((REPO / "runs/adaptive-supervisor").glob("keepalive-*.log")):
        text = log.read_text()
        restarts = text.count("launch #")
        done_n = text.count("COMPLETE")
        gave_up = text.count("GAVE UP")
        print(f"  {log.stem}: {restarts} launches, {done_n} complete"
              + (f", {gave_up} GAVE UP" if gave_up else ""))
    if stalled:
        print(f"  STALLED (running row, no process): {', '.join(stalled)}")
    if slow:
        print(f"  SLOW (past the request timeout): {', '.join(slow)}")
    if waiting:
        print(f"  awaiting relaunch (kept in totals): {', '.join(waiting)}")
    print("  " + contamination(con, args.hours))

    # Two reports firing close together would otherwise reset the baseline and
    # show every run as "+0". Keep the older baseline unless enough time passed.
    prev_at = prev.get("epoch")
    if isinstance(prev_at, (int, float)) and now.timestamp() - prev_at < 300:
        print(f"\n(baseline kept: previous report was "
              f"{(now.timestamp()-prev_at)/60:.0f} min ago)")
        return 0
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(
        {"at": f"{now:%Y-%m-%d %H:%M UTC}", "epoch": now.timestamp(),
         "runs": state_runs, "spend": spend}, indent=1
    ))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
