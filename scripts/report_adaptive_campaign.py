#!/usr/bin/env python3
"""Emit one compact health report for a supervised adaptive campaign.

The command is deliberately read-only unless ``--record`` is supplied. The
recorded sidecar contains only prior counters and compact checkpoint digests;
it never copies the benchmark database or full provider responses.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
ATTEMPT_FIELDS = (
    "latest_puzzle_id",
    "last_item_at",
    "latest_cost_usd",
    "latest_solved",
    "rating",
    "rd",
    "response_provider",
    "finish_reason",
    "http_status",
    "model_error",
)


@dataclass(frozen=True)
class Target:
    name: str
    label: str
    run_id: str
    model_id: str
    request_timeout_seconds: int
    preferred_provider: str | None = None
    log: str | None = None


def parse_time(value: str | None) -> float | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def age_seconds(value: str | None, now: float) -> int | None:
    parsed = parse_time(value)
    return max(0, int(now - parsed)) if parsed is not None else None


def format_duration(value: int | None) -> str:
    if value is None:
        return "unknown"
    days, remainder = divmod(max(0, value), 86400)
    hours, remainder = divmod(remainder, 3600)
    minutes, seconds = divmod(remainder, 60)
    if days:
        return f"{days}d {hours:02d}h {minutes:02d}m {seconds:02d}s"
    if hours:
        return f"{hours}h {minutes:02d}m {seconds:02d}s"
    return f"{minutes}m {seconds:02d}s"


def process_alive(pid: int | None) -> bool:
    if not pid:
        return False
    try:
        os.kill(pid, 0)
    except PermissionError:
        # Sandboxed monitors can be denied process inspection even when the
        # same-user process exists. EPERM is different from ESRCH.
        return True
    except OSError:
        return False
    return True


def connected_pids(pids: list[int], enabled: bool) -> set[int]:
    if not enabled or not pids:
        return set()
    try:
        result = subprocess.run(
            [
                "lsof",
                "-nP",
                "-a",
                "-p",
                ",".join(str(pid) for pid in pids),
                "-iTCP",
                "-sTCP:ESTABLISHED",
            ],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return set()
    connected: set[int] = set()
    for line in result.stdout.splitlines()[1:]:
        fields = line.split()
        if len(fields) > 1 and fields[1].isdigit():
            connected.add(int(fields[1]))
    return connected


def load_spec(path: Path) -> tuple[dict[str, Any], list[Target]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema") != "chessbench.adaptive_monitor_spec.v1":
        raise ValueError("unsupported adaptive monitor spec")
    targets = [Target(**entry) for entry in payload.get("runs", [])]
    if not targets or len({target.run_id for target in targets}) != len(targets):
        raise ValueError("monitor run IDs must be nonempty and unique")
    return payload, targets


def open_readonly(path: Path) -> sqlite3.Connection:
    database = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5)
    database.row_factory = sqlite3.Row
    database.execute("PRAGMA query_only=ON")
    database.execute("PRAGMA busy_timeout=5000")
    return database


def collect_runs(database: sqlite3.Connection, targets: list[Target]) -> dict[str, dict[str, Any]]:
    marks = ",".join("?" for _ in targets)
    rows = database.execute(
        f"""
        SELECT r.run_id, r.status, r.completed_items, r.total_items,
               printf('%.15f', r.cost_usd) AS cost_usd,
               r.prompt_tokens, r.completion_tokens,
               r.reasoning_tokens, r.cache_read_tokens, r.cache_write_tokens,
               r.updated_at, r.completed_at, r.variant_key, v.model_id,
               (SELECT COUNT(*) FROM puzzle_attempt all_p WHERE all_p.run_id=r.run_id)
                 - (SELECT COUNT(*) FROM sync_delivery d WHERE d.run_id=r.run_id)
                 AS sync_gap
          FROM benchmark_run r
          JOIN model_variant v USING(variant_key)
         WHERE r.run_id IN ({marks})
        """,
        tuple(target.run_id for target in targets),
    ).fetchall()
    return {str(row["run_id"]): dict(row) for row in rows}


def collect_latest_attempts(
    database: sqlite3.Connection, run_ids: list[str]
) -> dict[str, dict[str, Any]]:
    if not run_ids:
        return {}
    marks = ",".join("?" for _ in run_ids)
    rows = database.execute(
        f"""
        SELECT r.run_id, p.puzzle_id AS latest_puzzle_id,
               p.created_at AS last_item_at, p.cost_usd AS latest_cost_usd,
               json_extract(p.result_json, '$.solved') AS latest_solved,
               p.result_json -> '$.solver_rating_after.rating' AS rating,
               p.result_json -> '$.solver_rating_after.rating_deviation' AS rd,
               json_extract(p.result_json, '$.turns[#-1].response_provider') AS response_provider,
               json_extract(p.result_json, '$.turns[#-1].finish_reason') AS finish_reason,
               json_extract(p.result_json, '$.turns[#-1].http_status') AS http_status,
               json_extract(p.result_json, '$.turns[#-1].model_error') AS model_error
          FROM benchmark_run r
          LEFT JOIN puzzle_attempt p
            ON p.run_id=r.run_id AND p.sequence=r.completed_items-1
         WHERE r.run_id IN ({marks})
        """,
        tuple(run_ids),
    ).fetchall()
    return {str(row["run_id"]): dict(row) for row in rows}


def collect_checkpoints(
    database: sqlite3.Connection, targets: list[Target]
) -> dict[str, dict[str, Any]]:
    if not targets:
        return {}
    marks = ",".join("?" for _ in targets)
    rows = database.execute(
        f"""
        SELECT run_id, sequence, puzzle_id, updated_at, length(state_json) AS bytes
          FROM puzzle_checkpoint
         WHERE run_id IN ({marks})
        """,
        tuple(target.run_id for target in targets),
    ).fetchall()
    return {str(row["run_id"]): dict(row) for row in rows}


def checkpoint_detail(
    database: sqlite3.Connection, run_id: str
) -> dict[str, Any]:
    row = database.execute(
        """
        SELECT json_array_length(state_json, '$.turns') AS turns,
               json_extract(state_json, '$.turns[#-1].response_provider') AS provider,
               json_extract(state_json, '$.turns[#-1].finish_reason') AS finish_reason,
               json_extract(state_json, '$.turns[#-1].http_status') AS http_status,
               json_extract(state_json, '$.turns[#-1].model_error') AS model_error,
               json_extract(state_json, '$.turns[#-1].provider_error') AS provider_error
          FROM puzzle_checkpoint WHERE run_id=?
        """,
        (run_id,),
    ).fetchone()
    return dict(row) if row else {}


def load_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def min_age(*values: int | None) -> int | None:
    known = [value for value in values if value is not None]
    return min(known) if known else None


def classify_health(
    *,
    advanced: bool,
    child_alive: bool,
    supervisor_alive: bool,
    connected: bool,
    worker_age: int | None,
    evidence_age: int | None,
    request_timeout: int,
    interval: int,
    flat_reports: int,
    repeated_exit_since_activity: bool,
) -> str:
    if advanced:
        return "advancing"
    if not supervisor_alive:
        return "hard stall/recovery needed: supervisor dead"
    if not child_alive:
        return "hard stall/recovery needed: child missing"
    if repeated_exit_since_activity:
        return "hard stall/recovery active: repeated exits"
    if evidence_age is not None and evidence_age <= interval:
        return "in-flight but active"
    if worker_age is not None and worker_age <= interval:
        return "in-flight but active"
    if connected:
        request_age_bound = evidence_age if evidence_age is not None else worker_age
        if request_age_bound is not None and request_age_bound <= request_timeout + 120:
            return "in-flight but active"
    if flat_reports >= 2:
        return "hard stall/recovery needed: two flat reports"
    if evidence_age is not None and evidence_age > request_timeout + 120:
        return "hard stall/recovery needed: timeout exceeded"
    return "soft stall"


def compact_error(detail: dict[str, Any]) -> str | None:
    for key in ("model_error", "provider_error"):
        value = detail.get(key)
        if value:
            text = value if isinstance(value, str) else json.dumps(value, sort_keys=True)
            return " ".join(text.split())[:280]
    finish_reason = detail.get("finish_reason")
    http_status = detail.get("http_status")
    if finish_reason == "length":
        return "finish_reason=length"
    if http_status and int(http_status) >= 400:
        return f"HTTP {http_status}"
    return None


def markdown_table(rows: list[dict[str, Any]]) -> str:
    lines = [
        "| Run | Progress | Rating | RD | Cost | Tokens P/C/R/CR/CW | Latest | Provider | Δ | Health |",
        "|---|---:|---:|---:|---:|---|---|---|---:|---|",
    ]
    for row in rows:
        delta = row["delta"]
        delta_text = "new" if delta is None else f"+{delta}" if delta > 0 else str(delta)
        latest = f"{row['latest_puzzle_id']} {'correct' if row['latest_solved'] else 'incorrect'}"
        tokens = "/".join(
            f"{int(row[key]):,}"
            for key in (
                "prompt_tokens",
                "completion_tokens",
                "reasoning_tokens",
                "cache_read_tokens",
                "cache_write_tokens",
            )
        )
        lines.append(
            "| {label} | {completed_items}/{total_items} | {rating} | {rd} | "
            "${cost_usd} | {tokens} | {latest} | {provider} | {delta} | "
            "{health} |".format(
                label=row["label"],
                completed_items=row["completed_items"],
                total_items=row["total_items"],
                rating=row["rating"],
                rd=row["rd"],
                cost_usd=row["cost_usd"],
                tokens=tokens,
                latest=latest,
                provider=row.get("activity_provider") or "unknown",
                delta=delta_text,
                health=row["health"],
            )
        )
    return "\n".join(lines)


def build_report(
    *,
    root: Path,
    spec: dict[str, Any],
    targets: list[Target],
    database: sqlite3.Connection,
    supervisor: dict[str, Any],
    previous: dict[str, Any],
    inspect_sockets: bool,
    now: float,
) -> dict[str, Any]:
    rows = collect_runs(database, targets)
    missing = [target.run_id for target in targets if target.run_id not in rows]
    if missing:
        raise ValueError(f"database is missing monitored run IDs: {', '.join(missing)}")
    previous_runs = previous.get("runs", {})
    detail_run_ids: list[str] = []
    for target in targets:
        row = rows[target.run_id]
        prior = previous_runs.get(target.run_id, {})
        needs_active_refresh = (
            row["status"] != "completed"
            and (
                prior.get("completed_items") != row["completed_items"]
                or not isinstance(prior.get("attempt"), dict)
            )
        )
        newly_completed = (
            row["status"] == "completed"
            and bool(previous_runs)
            and prior.get("status") != "completed"
        )
        if needs_active_refresh or newly_completed:
            detail_run_ids.append(target.run_id)
    attempts = collect_latest_attempts(database, detail_run_ids)
    for target in targets:
        run_id = target.run_id
        if run_id in attempts:
            rows[run_id].update(attempts[run_id])
        elif isinstance(previous_runs.get(run_id, {}).get("attempt"), dict):
            rows[run_id].update(previous_runs[run_id]["attempt"])
    active_targets = [
        target for target in targets if rows[target.run_id]["status"] != "completed"
    ]
    checkpoints = collect_checkpoints(database, active_targets)
    supervisor_runs = supervisor.get("runs", {})
    children = supervisor.get("children", {})
    supervisor_pid = supervisor.get("supervisor_pid")
    supervisor_alive = process_alive(supervisor_pid)
    live_children = {
        target.name: int(children[target.name])
        for target in targets
        if target.name in children and process_alive(int(children[target.name]))
    }
    sockets = connected_pids(list(live_children.values()), inspect_sockets)
    interval = int(spec.get("interval_seconds", 600))
    active: list[dict[str, Any]] = []
    completed: list[dict[str, Any]] = []
    alerts: list[str] = []
    fallbacks: list[str] = []
    snapshot_runs: dict[str, Any] = {}

    for target in targets:
        row = rows[target.run_id]
        previous_row = previous_runs.get(target.run_id, {})
        prior_completed = previous_row.get("completed_items")
        delta = (
            int(row["completed_items"]) - int(prior_completed)
            if prior_completed is not None
            else None
        )
        if row["status"] == "completed":
            enriched = {
                **row,
                "name": target.name,
                "label": target.label,
                "delta": delta,
                "model_matches": row["model_id"] == target.model_id,
            }
            completed.append(enriched)
            if not enriched["model_matches"]:
                alerts.append(
                    f"{target.label}: model mismatch {row['model_id']} expected {target.model_id}"
                )
            snapshot_runs[target.run_id] = {
                "status": row["status"],
                "completed_items": row["completed_items"],
                "updated_at": row["updated_at"],
                "checkpoint_updated_at": None,
                "checkpoint_detail": {},
                "flat_reports": 0,
                "worker_pid": None,
                "attempt": {
                    key: row.get(key) for key in ATTEMPT_FIELDS if key in row
                },
            }
            continue
        checkpoint = checkpoints.get(target.run_id)
        detail: dict[str, Any] = {}
        if checkpoint:
            if (
                previous_row.get("checkpoint_updated_at") == checkpoint["updated_at"]
                and isinstance(previous_row.get("checkpoint_detail"), dict)
            ):
                detail = previous_row["checkpoint_detail"]
            else:
                detail = checkpoint_detail(database, target.run_id)

        latest_activity_at = row.get("last_item_at")
        if checkpoint and (
            parse_time(checkpoint.get("updated_at")) or 0
        ) > (parse_time(latest_activity_at) or 0):
            latest_activity_at = checkpoint.get("updated_at")
        log_age = None
        if target.log:
            try:
                log_age = max(0, int(now - (root / target.log).stat().st_mtime))
            except OSError:
                pass
        evidence_age = min_age(age_seconds(latest_activity_at, now), log_age)
        state = supervisor_runs.get(target.name, {})
        child_pid = live_children.get(target.name)
        launch_at = state.get("next_launch_at") if child_pid else None
        worker_age = max(0, int(now - float(launch_at))) if launch_at else None
        retry_in = (
            max(0, int(float(state["next_launch_at"]) - now))
            if not child_pid and state.get("next_launch_at")
            else None
        )
        checkpoint_changed = bool(
            checkpoint
            and checkpoint.get("updated_at") != previous_row.get("checkpoint_updated_at")
        )
        item_changed = bool(delta is not None and delta > 0)
        child_changed = bool(
            child_pid and child_pid != previous_row.get("worker_pid")
        )
        flat_reports = 0
        if delta == 0 and not checkpoint_changed and not child_changed:
            flat_reports = int(previous_row.get("flat_reports", 0)) + 1
        last_exit_at = parse_time(state.get("last_exit_at")) or 0
        last_item_at = parse_time(row.get("last_item_at")) or 0
        checkpoint_at = parse_time(checkpoint.get("updated_at")) if checkpoint else 0
        repeated_exit_since_activity = bool(
            int(state.get("failures_without_progress", 0)) >= 2
            and last_exit_at > max(last_item_at, checkpoint_at or 0)
        )
        advanced = item_changed
        connected = bool(child_pid and child_pid in sockets)
        health = classify_health(
            advanced=advanced,
            child_alive=bool(child_pid),
            supervisor_alive=supervisor_alive,
            connected=connected,
            worker_age=worker_age,
            evidence_age=evidence_age,
            request_timeout=target.request_timeout_seconds,
            interval=interval,
            flat_reports=flat_reports,
            repeated_exit_since_activity=repeated_exit_since_activity,
        )
        flat_for = age_seconds(row.get("last_item_at"), now)
        if not advanced and row["status"] != "completed":
            health = (
                f"{health}; no completed item {format_duration(flat_for)}; "
                f"current worker age {format_duration(worker_age)}"
            )

        activity_provider = detail.get("provider") or row.get("response_provider")
        enriched = {
            **row,
            "name": target.name,
            "label": target.label,
            "delta": delta,
            "health": health,
            "activity_provider": activity_provider,
            "checkpoint": checkpoint,
            "checkpoint_detail": detail,
            "worker_pid": child_pid,
            "worker_connected": connected,
            "worker_age_seconds": worker_age,
            "retry_in_seconds": retry_in,
            "evidence_age_seconds": evidence_age,
            "log_age_seconds": log_age,
            "model_matches": row["model_id"] == target.model_id,
        }
        active.append(enriched)

        is_active = row["status"] != "completed"
        if not enriched["model_matches"]:
            alerts.append(
                f"{target.label}: model mismatch {row['model_id']} expected {target.model_id}"
            )
        error = compact_error(detail or row)
        if error:
            alerts.append(f"{target.label}: {error}")
        if is_active and "hard stall" in health:
            retry_text = (
                f", retry in {format_duration(retry_in)}" if retry_in else ""
            )
            alerts.append(
                f"{target.label}: {health}; PID {child_pid or 'missing'}, "
                f"failures_without_progress={state.get('failures_without_progress', 0)}"
                f"{retry_text}"
            )
        if is_active and int(row.get("sync_gap") or 0) > 5:
            alerts.append(f"{target.label}: live-sync gap {row['sync_gap']} item(s)")
        if (
            is_active
            and target.preferred_provider
            and activity_provider
            and activity_provider != target.preferred_provider
        ):
            fallbacks.append(
                f"{target.label}: {activity_provider} instead of {target.preferred_provider}"
            )
        snapshot_runs[target.run_id] = {
            "status": row["status"],
            "completed_items": row["completed_items"],
            "updated_at": row["updated_at"],
            "checkpoint_updated_at": checkpoint.get("updated_at") if checkpoint else None,
            "checkpoint_detail": detail,
            "flat_reports": flat_reports,
            "worker_pid": child_pid,
            "attempt": {key: row.get(key) for key in ATTEMPT_FIELDS},
        }

    return {
        "schema": "chessbench.adaptive_monitor_report.v1",
        "name": spec["name"],
        "generated_at": datetime.fromtimestamp(now, timezone.utc).isoformat(timespec="seconds"),
        "counts": {"completed": len(completed), "active": len(active)},
        "active": active,
        "completed": completed,
        "newly_completed": [
            row
            for row in completed
            if previous_runs.get(row["run_id"], {}).get("status") != "completed"
            and bool(previous_runs)
        ],
        "alerts": alerts,
        "fallbacks": fallbacks,
        "supervisor": {
            "pid": supervisor_pid,
            "alive": supervisor_alive,
            "updated_at": supervisor.get("updated_at"),
            "children": len(live_children),
        },
        "snapshot": {
            "schema": "chessbench.adaptive_monitor_state.v1",
            "reported_at": datetime.fromtimestamp(now, timezone.utc).isoformat(timespec="seconds"),
            "runs": snapshot_runs,
        },
    }


def render_markdown(report: dict[str, Any]) -> str:
    lines = [markdown_table(report["active"])]
    counts = report["counts"]
    if report["newly_completed"]:
        lines.extend(["", "**Newly completed**", ""])
        for row in report["newly_completed"]:
            lines.append(
                f"- {row['label']}: {row['completed_items']}/{row['total_items']}, "
                f"rating {row['rating']}, RD {row['rd']}, "
                f"${row['cost_usd']}."
            )
    if report["alerts"]:
        lines.extend(["", "**Alerts/retries**", ""])
        lines.extend(f"- {alert}" for alert in report["alerts"])
    if report["fallbacks"]:
        lines.extend(["", "**Provider fallbacks**", ""])
        lines.extend(f"- {fallback}" for fallback in report["fallbacks"])
    supervisor = report["supervisor"]
    lines.extend(["", "**Sync/supervisor**", ""])
    lines.append(f"- Total: {counts['completed']} finished, {counts['active']} active.")
    lines.append(
        f"- Supervisor PID {supervisor['pid']} is "
        f"{'alive' if supervisor['alive'] else 'dead'} with {supervisor['children']} live child(ren)."
    )
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default="runs/chessbench.db")
    parser.add_argument(
        "--spec", default="campaigns/adaptive-2026-08-02-monitor.json"
    )
    parser.add_argument(
        "--supervisor-state",
        default="runs/adaptive-supervisor/campaign-20260802-supervisor.json",
    )
    parser.add_argument("--state")
    parser.add_argument("--record", action="store_true")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--no-sockets", action="store_true")
    args = parser.parse_args()

    spec_path = (ROOT / args.spec).resolve()
    spec, targets = load_spec(spec_path)
    state_path = (
        (ROOT / args.state).resolve()
        if args.state
        else ROOT / "runs" / "monitor-state" / f"{spec['name']}.json"
    )
    previous = load_json(state_path)
    supervisor = load_json((ROOT / args.supervisor_state).resolve())
    database = open_readonly((ROOT / args.db).resolve())
    try:
        report = build_report(
            root=ROOT,
            spec=spec,
            targets=targets,
            database=database,
            supervisor=supervisor,
            previous=previous,
            inspect_sockets=not args.no_sockets,
            now=time.time(),
        )
    finally:
        database.close()

    if args.record:
        state_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = state_path.with_suffix(state_path.suffix + ".tmp")
        temporary.write_text(
            json.dumps(report["snapshot"], indent=2) + "\n", encoding="utf-8"
        )
        temporary.replace(state_path)
    if args.json:
        printable = {key: value for key, value in report.items() if key != "snapshot"}
        print(json.dumps(printable, indent=2, default=str))
    else:
        print(render_markdown(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
