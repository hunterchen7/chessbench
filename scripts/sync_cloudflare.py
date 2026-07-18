#!/usr/bin/env python3
"""Idempotently drain the local benchmark outbox into Cloudflare D1."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from chessbench.database import BenchmarkStore  # noqa: E402
from chessbench.cloudflare_sync import sync_run  # noqa: E402
from chessbench.env import load_local_env  # noqa: E402


def main() -> int:
    load_local_env()
    parser = argparse.ArgumentParser(
        description="Sync durable benchmark results to Cloudflare D1"
    )
    parser.add_argument("--db", default="runs/chessbench.db")
    parser.add_argument("--api", default=os.environ.get("CHESSBENCH_API"))
    parser.add_argument("--token", default=os.environ.get("CHESSBENCH_INGEST_TOKEN"))
    parser.add_argument(
        "--run", default=None, help="sync one run id (default: every local run)"
    )
    parser.add_argument(
        "--live",
        action="store_true",
        help="publish current items while leaving the remote run in progress",
    )
    args = parser.parse_args()
    if not args.api or not args.token:
        parser.error(
            "set CHESSBENCH_API and CHESSBENCH_INGEST_TOKEN (or pass --api/--token)"
        )

    sent = failed = 0
    with BenchmarkStore(args.db) as store:
        run_ids = (
            [args.run]
            if args.run
            else [
                str(row["run_id"])
                for row in store.list_runs()
                # Final tournaments use their dedicated document endpoint;
                # benchmark_runs_v2 intentionally accepts item-based tracks only.
                if row["track"] != "tournament"
            ]
        )
        for run_id in run_ids:
            print(f"sync {run_id}")
            s, f = sync_run(store, args.api, args.token, run_id, finish=not args.live)
            sent += s
            failed += f
    print(f"synced {sent} item(s); {failed} failed and remain in the outbox")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
