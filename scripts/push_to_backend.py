#!/usr/bin/env python3
"""Push local chessbench run + tournament records to the Cloudflare backend.

Replaces the "copy JSON into the web app" step: it POSTs each run and tournament
document (the exact shape from chessbench/store.py) to the backend's authenticated
ingest endpoints, which upsert them into D1.

Usage:
    export CHESSBENCH_API=https://chessbench.<subdomain>.workers.dev
    export CHESSBENCH_INGEST_TOKEN=<the INGEST_TOKEN secret>
    python scripts/push_to_backend.py                     # push webapp/data/{runs,tournaments}
    python scripts/push_to_backend.py --runs-dir path --tournaments-dir path

Idempotent: re-pushing a run replaces its rows. Safe to run repeatedly (e.g. after
each benchmark completes).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

RUN_SCHEMA = "chessbench.run.v1"
TOURNAMENT_SCHEMA = "chessbench.tournament.v1"


def _post(url: str, token: str, payload: dict) -> dict:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=body, method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
            # Cloudflare's edge blocks the default Python-urllib UA (error 1010).
            "User-Agent": "chessbench-push/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def push_runs(api: str, token: str, runs_dir: Path) -> int:
    n = 0
    for path in sorted(runs_dir.glob("*.json")):
        try:
            doc = json.loads(path.read_text())
        except (json.JSONDecodeError, OSError) as e:
            print(f"  skip {path.name}: {e}", file=sys.stderr)
            continue
        if doc.get("schema") != RUN_SCHEMA:
            continue
        try:
            res = _post(f"{api}/api/ingest/run", token, doc)
            print(f"  run  {res.get('run_id')}  ({res.get('items')} items)")
            n += 1
        except urllib.error.HTTPError as e:
            print(f"  FAIL {path.name}: HTTP {e.code} {e.read().decode()[:200]}", file=sys.stderr)
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as e:
            print(f"  FAIL {path.name}: {type(e).__name__}: {e}", file=sys.stderr)
    return n


def push_tournaments(api: str, token: str, tdir: Path) -> int:
    n = 0
    for path in sorted(tdir.glob("*.json")):
        if path.name == "index.json":
            continue
        try:
            doc = json.loads(path.read_text())
        except (json.JSONDecodeError, OSError) as e:
            print(f"  skip {path.name}: {e}", file=sys.stderr)
            continue
        if doc.get("schema") != TOURNAMENT_SCHEMA:
            continue
        tid = path.stem
        try:
            res = _post(f"{api}/api/ingest/tournament?id={tid}", token, doc)
            print(f"  game {res.get('tid')}")
            n += 1
        except urllib.error.HTTPError as e:
            print(f"  FAIL {path.name}: HTTP {e.code} {e.read().decode()[:200]}", file=sys.stderr)
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as e:
            print(f"  FAIL {path.name}: {type(e).__name__}: {e}", file=sys.stderr)
    return n


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Push runs/tournaments to the chessbench backend.")
    ap.add_argument("--api", default=os.environ.get("CHESSBENCH_API"), help="backend base URL")
    ap.add_argument("--token", default=os.environ.get("CHESSBENCH_INGEST_TOKEN"), help="ingest bearer token")
    ap.add_argument("--runs-dir", default="webapp/data/runs")
    ap.add_argument("--tournaments-dir", default="webapp/data/tournaments")
    args = ap.parse_args(argv)

    if not args.api or not args.token:
        ap.error("set --api/--token or CHESSBENCH_API/CHESSBENCH_INGEST_TOKEN")

    api = args.api.rstrip("/")
    runs = push_runs(api, args.token, Path(args.runs_dir)) if Path(args.runs_dir).is_dir() else 0
    games = push_tournaments(api, args.token, Path(args.tournaments_dir)) if Path(args.tournaments_dir).is_dir() else 0
    print(f"pushed {runs} run(s), {games} tournament(s) -> {api}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
