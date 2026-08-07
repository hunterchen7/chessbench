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


def label_to_log(name: str, effort: str, seed: object) -> str:
    """Map a variant to its keepalive log stem (the spec's label)."""
    stem = {
        "deepseek-v4-flash-0423": "ds-flash-0423",
        "deepseek-v4-pro": "ds-pro",
        "deepseek-v4": "ds-pro",
    }.get(name, name.replace("qwen3-7-", "qwen3.7-").replace("qwen3-8-", "qwen3.8-"))
    return f"{stem}-{effort}-s{seed}"


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
    ap.add_argument("--hours", type=float, default=24.0, help="window for 'active' runs")
    ap.add_argument("--target", type=int, default=50)
    args = ap.parse_args()

    con = sqlite3.connect(f"file:{REPO / 'runs/chessbench.db'}?mode=ro", uri=True)
    rows = con.execute(
        """SELECT run_id, variant_key, status, completed_items, cost_usd,
                  prompt_tokens, completion_tokens, reasoning_tokens, summary_json,
                  json_extract(protocol_json,'$.selection.seed') AS seed,
                  (julianday('now')-julianday(updated_at))*60 AS min_ago
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

    now = datetime.now(timezone.utc)
    print(f"CHESSBENCH STATUS  {now:%Y-%m-%d %H:%M UTC}")
    if prev.get("at"):
        print(f"(delta vs {prev['at']})")
    print()
    header = (
        f"{'run':34} {'done':>7} {'Δ':>4} {'rating':>8} {'RD':>6} "
        f"{'tokens':>10} {'cost':>7}  status"
    )
    print(header)
    print("-" * len(header))

    tot = {"done": 0, "delta": 0, "cost": 0.0, "tok": 0, "runs": 0, "complete": 0}
    state_runs = {}
    stalled = []
    stale: list[tuple[str, int, float]] = []
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
            live = lives.get(label_to_log(name, effort, seed))
            if live:
                rating, rd = live[0], live[1]
        tokens = int((ptok or 0) + (ctok or 0))
        before = prev_runs.get(rid, {}).get("done")
        delta = (done - before) if isinstance(before, int) else None

        superseded = status not in ("running", "completed") and done < args.target
        if superseded:
            stale.append((label, done, cost or 0.0))
            continue
        tot["runs"] += 1
        tot["done"] += done
        tot["cost"] += cost or 0.0
        tot["tok"] += tokens
        if delta:
            tot["delta"] += delta
        if done >= args.target or status == "completed":
            tot["complete"] += 1
        # A running row that has not advanced since the last report is suspect.
        if status == "running" and delta == 0 and min_ago and min_ago > 20:
            stalled.append(label)

        print(
            f"{label[:34]:34} {str(done)+'/'+str(args.target):>7} "
            f"{('+'+str(delta)) if delta else ('-' if delta==0 else '·'):>4} "
            f"{(f'{rating:.0f}' if rating else '-'):>8} "
            f"{(f'{rd:.0f}' if rd else '-'):>6} "
            f"{tokens:>10,} {('$'+format(cost or 0,'.2f')):>7}  {status}"
            + ("  PROVISIONAL" if provisional else "")
        )
        state_runs[rid] = {"done": done, "cost": cost, "tokens": tokens}

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
        print(f"  STALLED (no progress since last report): {', '.join(stalled)}")

    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(
        {"at": f"{now:%Y-%m-%d %H:%M UTC}", "runs": state_runs, "spend": spend}, indent=1
    ))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
