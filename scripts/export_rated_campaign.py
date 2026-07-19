#!/usr/bin/env python3
"""Export a compact, deterministic manifest for completed rated runs."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from pathlib import Path


def load_json(value: str | None) -> object:
    return json.loads(value) if value else None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default="runs/chessbench.db")
    parser.add_argument("--spec", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    spec = json.loads(Path(args.spec).read_text(encoding="utf-8"))
    if spec.get("schema") != "chessbench.rated_campaign_spec.v1":
        raise ValueError("unsupported campaign spec")
    run_ids = [str(value) for value in spec.get("run_ids", [])]
    if not run_ids or len(set(run_ids)) != len(run_ids):
        raise ValueError("campaign run_ids must be nonempty and unique")

    database = sqlite3.connect(args.db)
    database.row_factory = sqlite3.Row
    placeholders = ",".join("?" for _ in run_ids)
    rows = database.execute(
        f"""
        SELECT r.*, v.config_json AS variant_json
          FROM benchmark_run r JOIN model_variant v USING(variant_key)
         WHERE r.run_id IN ({placeholders})
        """,
        run_ids,
    ).fetchall()
    database.close()
    by_id = {str(row["run_id"]): row for row in rows}
    missing = [run_id for run_id in run_ids if run_id not in by_id]
    if missing:
        raise ValueError(f"campaign database is missing run IDs: {', '.join(missing)}")

    runs: list[dict[str, object]] = []
    for run_id in run_ids:
        row = by_id[run_id]
        if row["status"] != "completed":
            raise ValueError(f"campaign run is not completed: {run_id}")
        summary = load_json(row["summary_json"])
        if not isinstance(summary, dict):
            raise ValueError(f"campaign run has no summary: {run_id}")
        runs.append(
            {
                "run_id": run_id,
                "natural_key": row["natural_key"],
                "model_variant": load_json(row["variant_json"]),
                "condition": load_json(row["condition_json"]),
                "suite": {
                    "name": row["suite_name"],
                    "version": row["suite_version"],
                    "content_hash": row["suite_hash"],
                    "visibility": row["suite_visibility"],
                },
                "protocol": load_json(row["protocol_json"]),
                "status": row["status"],
                "progress": {
                    "completed": row["completed_items"],
                    "maximum": row["total_items"],
                },
                "summary": summary,
                "usage": {
                    "prompt_tokens": row["prompt_tokens"],
                    "completion_tokens": row["completion_tokens"],
                    "reasoning_tokens": row["reasoning_tokens"],
                    "cache_read_tokens": row["cache_read_tokens"],
                    "cache_write_tokens": row["cache_write_tokens"],
                    "uncached_prompt_tokens": row["uncached_prompt_tokens"],
                    "cache_discount_usd": row["cache_discount_usd"],
                    "cost_usd": row["cost_usd"],
                },
                "created_at": row["created_at"],
                "completed_at": row["completed_at"],
            }
        )

    canonical_runs = json.dumps(
        runs, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")
    artifact = {
        "schema": "chessbench.rated_campaign.v1",
        "name": spec["name"],
        "description": spec.get("description"),
        "content_hash": f"sha256:{hashlib.sha256(canonical_runs).hexdigest()}",
        "totals": {
            "runs": len(runs),
            "completed_puzzles": sum(
                int(run["progress"]["completed"]) for run in runs
            ),
            "solved": sum(int(run["summary"].get("solved", 0)) for run in runs),
            "cost_usd": sum(float(run["usage"]["cost_usd"]) for run in runs),
        },
        "runs": runs,
    }
    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(artifact, indent=1, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"exported {len(runs)} completed run(s) -> {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
