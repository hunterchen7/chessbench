#!/usr/bin/env python3
"""Idempotently drain the local benchmark outbox into Cloudflare D1."""

from __future__ import annotations

import argparse
import json
import os
import urllib.error
import urllib.request

from chessbench.database import BenchmarkStore
from chessbench.env import load_local_env


def post(api: str, token: str, path: str, document: dict[str, object]) -> dict[str, object]:
    request = urllib.request.Request(
        f"{api.rstrip('/')}/api/{path}",
        data=json.dumps(document).encode(),
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "chessbench-sync/2",
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def sync_run(store: BenchmarkStore, api: str, token: str, run_id: str) -> tuple[int, int]:
    post(api, token, "ingest/run/start", store.run_start_document(run_id))
    sent = 0
    failed = 0
    for item in store.unsynced_item_documents(run_id):
        try:
            post(api, token, "ingest/run/item", item)
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
            print(f"  {run_id}/{item['item_id']}: {type(exc).__name__}: {exc}")
            failed += 1
            continue
        store.mark_item_synced(run_id, str(item["item_id"]))
        sent += 1
    if failed == 0:
        post(api, token, "ingest/run/finish", store.run_finish_document(run_id))
    return sent, failed


def main() -> int:
    load_local_env()
    parser = argparse.ArgumentParser(description="Sync durable benchmark results to Cloudflare D1")
    parser.add_argument("--db", default="runs/chessbench.db")
    parser.add_argument("--api", default=os.environ.get("CHESSBENCH_API"))
    parser.add_argument("--token", default=os.environ.get("CHESSBENCH_INGEST_TOKEN"))
    parser.add_argument("--run", default=None, help="sync one run id (default: every local run)")
    args = parser.parse_args()
    if not args.api or not args.token:
        parser.error("set CHESSBENCH_API and CHESSBENCH_INGEST_TOKEN (or pass --api/--token)")

    sent = failed = 0
    with BenchmarkStore(args.db) as store:
        run_ids = [args.run] if args.run else [str(row["run_id"]) for row in store.list_runs()]
        for run_id in run_ids:
            print(f"sync {run_id}")
            s, f = sync_run(store, args.api, args.token, run_id)
            sent += s
            failed += f
    print(f"synced {sent} item(s); {failed} failed and remain in the outbox")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
