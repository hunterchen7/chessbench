#!/usr/bin/env python3
"""Register result-free public corpora and exact runnable suites in Cloudflare."""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from chessbench.env import load_local_env  # noqa: E402

ACTIVE_SUITE_FILES = (
    "standard-lichess-v2.json",
    "woodpecker-masters-v1.json",
    "esoteric-seed-v1.json",
    "standard-smoke-v1.json",
    "woodpecker-smoke-v1.json",
    "esoteric-smoke-v1.json",
)


def post(api: str, token: str, path: str, document: dict[str, object]) -> dict[str, object]:
    request = urllib.request.Request(
        f"{api.rstrip('/')}/api/{path}",
        data=json.dumps(document).encode(),
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            # Cloudflare may reject urllib's default Python-urllib user agent.
            "User-Agent": "ChessBench-Registry/1.0",
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def suite_track(name: str, kind: str) -> str:
    if kind == "composed":
        return "esoteric"
    return "woodpecker" if name.startswith("woodpecker") else "puzzle"


def main() -> int:
    load_local_env()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", default=os.environ.get("CHESSBENCH_API"))
    parser.add_argument("--token", default=os.environ.get("CHESSBENCH_INGEST_TOKEN"))
    parser.add_argument("--corpora", type=Path, default=ROOT / "web" / "public" / "data" / "corpora")
    parser.add_argument("--suites", type=Path, default=ROOT / "suites" / "public")
    parser.add_argument(
        "--include-superseded",
        action="store_true",
        help="also register legacy/superseded suite files (off by default)",
    )
    args = parser.parse_args()
    if not args.api or not args.token:
        parser.error("set CHESSBENCH_API and CHESSBENCH_INGEST_TOKEN")

    for track in ("standard", "woodpecker", "esoteric"):
        document = json.loads((args.corpora / f"{track}.json").read_text(encoding="utf-8"))
        result = post(args.api, args.token, "ingest/corpus", document)
        print(f"corpus {document['name']}: {result['items']} items")

    paths = (
        sorted(args.suites.glob("*.json"))
        if args.include_superseded
        else [args.suites / name for name in ACTIVE_SUITE_FILES]
    )
    for path in paths:
        document = json.loads(path.read_text(encoding="utf-8"))
        document["track"] = suite_track(str(document["name"]), str(document["kind"]))
        result = post(args.api, args.token, "ingest/suite", document)
        print(f"suite {document['name']}: {result['items']} items")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
