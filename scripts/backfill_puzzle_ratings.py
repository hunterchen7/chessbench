#!/usr/bin/env python3
"""Recalculate Bayesian Puzzle Elo in durable runs and static JSON exports."""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from chessbench.rating import puzzle_elo  # noqa: E402


def estimate_from_result_rows(rows: list[sqlite3.Row]) -> dict[str, object]:
    items: list[tuple[float, bool]] = []
    for row in rows:
        result = json.loads(row["result_json"])
        rating = float(result["rating"])
        if rating == rating:  # exclude NaN without importing another helper
            items.append((rating, bool(result["solved"])))
    return puzzle_elo(items).to_dict()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Backfill frozen-prior Bayesian Puzzle Elo into existing runs"
    )
    parser.add_argument("--db", default="runs/chessbench.db")
    parser.add_argument("--runs-dir", default="web/public/data/runs")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    db = sqlite3.connect(args.db)
    db.row_factory = sqlite3.Row
    run_rows = db.execute(
        """SELECT run_id, status, summary_json
           FROM benchmark_run
           WHERE track='puzzle' AND completed_items > 0
           ORDER BY created_at"""
    ).fetchall()
    estimates: dict[str, dict[str, object]] = {}
    completed: list[str] = []
    for run in run_rows:
        result_rows = db.execute(
            """SELECT result_json FROM puzzle_attempt
               WHERE run_id=? ORDER BY sequence""",
            (run["run_id"],),
        ).fetchall()
        estimate = estimate_from_result_rows(result_rows)
        estimates[str(run["run_id"])] = estimate
        if run["status"] == "completed":
            completed.append(str(run["run_id"]))
        if args.dry_run:
            continue
        summary = json.loads(run["summary_json"]) if run["summary_json"] else {}
        summary["puzzle_performance_rating"] = estimate
        db.execute(
            "UPDATE benchmark_run SET summary_json=? WHERE run_id=?",
            (json.dumps(summary, sort_keys=True, separators=(",", ":")), run["run_id"]),
        )
    if not args.dry_run:
        db.commit()
    db.close()

    updated_files = 0
    runs_dir = Path(args.runs_dir)
    for path in sorted(runs_dir.glob("*.json")):
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        estimate = estimates.get(str(document.get("run_id") or ""))
        summary = document.get("summary")
        if estimate is None or not isinstance(summary, dict):
            continue
        if not args.dry_run:
            summary["puzzle_performance_rating"] = estimate
            with path.open("w", encoding="utf-8") as handle:
                json.dump(document, handle, indent=1)
                handle.write("\n")
        updated_files += 1

    action = "would update" if args.dry_run else "updated"
    print(
        f"{action} {len(estimates)} durable puzzle run(s) and "
        f"{updated_files} static export(s)"
    )
    print("completed run ids:")
    for run_id in completed:
        print(run_id)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
