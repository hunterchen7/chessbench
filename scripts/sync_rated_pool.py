#!/usr/bin/env python3
"""Upload the compressed rated-session puzzle pool to its dedicated D1 tables."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request
from dataclasses import asdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from chessbench.categories import categorize_puzzle, profile_families  # noqa: E402
from chessbench.env import load_local_env  # noqa: E402
from chessbench.rated_pool import iter_rated_pool, load_rated_pool_manifest  # noqa: E402


DEFAULT_MANIFEST = ROOT / "corpora/pools/rated-lichess-v1.manifest.json"


def post(
    api: str,
    token: str,
    path: str,
    document: dict[str, object],
    *,
    attempts: int = 6,
) -> dict[str, object]:
    data = json.dumps(document, separators=(",", ":")).encode()
    for attempt in range(1, attempts + 1):
        request = urllib.request.Request(
            f"{api.rstrip('/')}/api/{path}",
            data=data,
            method="POST",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "ChessBench-Rated-Pool/1.0",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            retryable = exc.code == 429 or exc.code >= 500
            detail = exc.read().decode(errors="replace")
            if not retryable or attempt == attempts:
                raise RuntimeError(f"{path} failed with HTTP {exc.code}: {detail}") from exc
        except (urllib.error.URLError, TimeoutError, OSError):
            if attempt == attempts:
                raise
        delay = min(30, 2 ** (attempt - 1))
        print(f"{path}: transient failure; retrying in {delay}s ({attempt}/{attempts})")
        time.sleep(delay)
    raise AssertionError("unreachable")


def random_key(puzzle_id: str) -> int:
    digest = hashlib.sha256(f"rated-puzzle-order:{puzzle_id}".encode()).digest()
    return int.from_bytes(digest[:4], "big")


def upload_item(puzzle) -> dict[str, object]:
    categories = categorize_puzzle(puzzle.themes, puzzle.rating)
    tags = {f"theme:{theme}" for theme in puzzle.themes}
    tags.update(f"family:{family}" for family in profile_families(puzzle.themes))
    for dimension, values in categories.items():
        tags.update(f"{dimension}:{value}" for value in values)
    return {
        "puzzle_id": puzzle.id,
        "rating": puzzle.rating,
        "rating_deviation": puzzle.rating_deviation,
        "popularity": puzzle.popularity,
        "plays": puzzle.nb_plays,
        "random_key": random_key(puzzle.id),
        "tags": sorted(tags),
        "payload": asdict(puzzle),
    }


def main() -> int:
    load_local_env()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", default=os.environ.get("CHESSBENCH_API"))
    parser.add_argument("--token", default=os.environ.get("CHESSBENCH_INGEST_TOKEN"))
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--batch-size", type=int, default=200)
    args = parser.parse_args()
    if not args.api or not args.token:
        parser.error("set CHESSBENCH_API and CHESSBENCH_INGEST_TOKEN")
    if not 1 <= args.batch_size <= 250:
        parser.error("batch-size must be between 1 and 250")

    manifest = load_rated_pool_manifest(args.manifest)
    content_hash = str(manifest["content_hash"])
    started = post(args.api, args.token, "ingest/rated-pool/start", manifest)
    print(
        f"staging {manifest['name']} ({started['expected_items']:,} puzzles, {content_hash})"
    )
    if started.get("already_active"):
        print("the complete content-addressed pool is already active; nothing to upload")
        return 0

    stored = int(started.get("stored_items", 0))
    # Replay the last batch: an interrupted HTTP response may arrive after D1
    # committed its rows, and replaying also repairs its normalized tags.
    resume_at = max(0, stored - args.batch_size)
    if stored:
        print(f"resuming from {resume_at:,}; D1 already contains {stored:,} puzzle rows")

    batch: list[dict[str, object]] = []
    uploaded = resume_at
    for index, puzzle in enumerate(iter_rated_pool(args.manifest, verify_artifact=False)):
        if index < resume_at:
            continue
        batch.append(upload_item(puzzle))
        if len(batch) < args.batch_size:
            continue
        post(
            args.api,
            args.token,
            "ingest/rated-pool/items",
            {"content_hash": content_hash, "items": batch},
        )
        uploaded += len(batch)
        batch = []
        if uploaded % 5_000 == 0:
            print(f"uploaded {uploaded:,}/{manifest['items']:,}")
    if batch:
        post(
            args.api,
            args.token,
            "ingest/rated-pool/items",
            {"content_hash": content_hash, "items": batch},
        )
        uploaded += len(batch)

    finished = post(
        args.api,
        args.token,
        "ingest/rated-pool/finish",
        {"content_hash": content_hash},
    )
    print(f"activated {finished['items']:,} puzzles from {content_hash}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
