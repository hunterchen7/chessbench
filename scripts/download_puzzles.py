#!/usr/bin/env python3
"""Build a bounded, deterministic source pool from the Lichess puzzle dump.

The upstream database currently contains millions of rows.  This command scans
the entire stream but retains only the lowest stable SHA-256 priorities in each
rating bucket, so memory stays bounded and the result is independent of source
ordering.  Unlike a "take the first N" downloader, it does not overrepresent
alphabetically early puzzle IDs.

Examples:

    # Stream the official CC0 dump (requires curl and zstd on PATH).
    python3 scripts/download_puzzles.py --per-bucket 5000 \
        --snapshot 2026-07-05 --out data/lichess_pool_2026-07-05.csv

    # Exercise the same sampler on a local CSV or .csv.zst snapshot.
    python3 scripts/download_puzzles.py --input data/sample_puzzles.csv \
        --per-bucket 20 --out /tmp/pool.csv
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import heapq
import io
import json
import pathlib
import subprocess
import sys
from contextlib import ExitStack
from datetime import datetime, timezone
from typing import IO, Iterator

URL = "https://database.lichess.org/lichess_db_puzzle.csv.zst"


def _priority(puzzle_id: str, seed: int) -> int:
    digest = hashlib.sha256(f"lichess-pool:{seed}:{puzzle_id}".encode("utf-8")).digest()
    return int.from_bytes(digest, "big")


def _rows_from_stream(stream: IO[bytes]) -> Iterator[dict[str, str]]:
    text = io.TextIOWrapper(stream, encoding="utf-8", newline="")
    yield from csv.DictReader(text)


def _open_rows(path: str | None, stack: ExitStack) -> tuple[Iterator[dict[str, str]], list[subprocess.Popen[bytes]]]:
    processes: list[subprocess.Popen[bytes]] = []
    if path and not path.endswith(".zst"):
        handle = stack.enter_context(open(path, "rb"))
        return _rows_from_stream(handle), processes

    if path:
        zstd = subprocess.Popen(["zstd", "-dc", path], stdout=subprocess.PIPE)
    else:
        curl = subprocess.Popen(
            ["curl", "-fL", "--retry", "3", "--silent", "--show-error", URL],
            stdout=subprocess.PIPE,
        )
        processes.append(curl)
        assert curl.stdout is not None
        zstd = subprocess.Popen(["zstd", "-dc"], stdin=curl.stdout, stdout=subprocess.PIPE)
        curl.stdout.close()
    processes.append(zstd)
    assert zstd.stdout is not None
    return _rows_from_stream(zstd.stdout), processes


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default=None, help="local .csv or .csv.zst; omit to stream Lichess")
    parser.add_argument("--per-bucket", type=int, default=5000)
    parser.add_argument("--width", type=int, default=200)
    parser.add_argument("--lo", type=int, default=400)
    parser.add_argument("--hi", type=int, default=3000)
    parser.add_argument("--min-popularity", type=int, default=80)
    parser.add_argument("--min-plays", type=int, default=50)
    parser.add_argument("--seed", type=int, default=20260714)
    parser.add_argument("--snapshot", default="unknown", help="upstream release date or immutable snapshot label")
    parser.add_argument("--out", default="data/lichess_pool.csv")
    parser.add_argument(
        "--max-scan",
        type=int,
        default=0,
        help="debug only: stop after N rows; 0 scans the full source and is required for a publishable pool",
    )
    args = parser.parse_args()
    if args.per_bucket < 1 or args.width < 1 or args.hi <= args.lo:
        parser.error("per-bucket and width must be positive, and hi must exceed lo")

    n_buckets = (args.hi - args.lo + args.width - 1) // args.width
    # bucket -> max-priority heap represented by negative priorities.
    heaps: dict[int, list[tuple[int, str, dict[str, str]]]] = {
        index: [] for index in range(n_buckets)
    }
    scanned = eligible = 0
    header: list[str] = []
    stopped_early = False

    with ExitStack() as stack:
        rows, processes = _open_rows(args.input, stack)
        try:
            for row in rows:
                scanned += 1
                if not header:
                    header = list(row)
                if args.max_scan and scanned > args.max_scan:
                    stopped_early = True
                    break
                try:
                    rating = int(row["Rating"])
                    popularity = int(row["Popularity"])
                    plays = int(row["NbPlays"])
                except (KeyError, TypeError, ValueError):
                    continue
                index = (rating - args.lo) // args.width
                if index < 0 or index >= n_buckets:
                    continue
                if popularity < args.min_popularity or plays < args.min_plays:
                    continue
                puzzle_id = row.get("PuzzleId", "")
                if not puzzle_id:
                    continue
                eligible += 1
                priority = _priority(puzzle_id, args.seed)
                heap = heaps[index]
                entry = (-priority, puzzle_id, row)
                if len(heap) < args.per_bucket:
                    heapq.heappush(heap, entry)
                else:
                    worst_priority = -heap[0][0]
                    worst_id = heap[0][1]
                    if (priority, puzzle_id) < (worst_priority, worst_id):
                        heapq.heapreplace(heap, entry)
                if scanned % 500_000 == 0:
                    kept = sum(len(bucket) for bucket in heaps.values())
                    print(
                        f"  scanned {scanned:,}; eligible {eligible:,}; retained {kept:,}",
                        file=sys.stderr,
                    )
        finally:
            for process in reversed(processes):
                if process.stdout:
                    process.stdout.close()
            if stopped_early:
                for process in reversed(processes):
                    if process.poll() is None:
                        process.terminate()
            return_codes = [process.wait() for process in reversed(processes)]
            if not stopped_early and any(code != 0 for code in return_codes):
                raise RuntimeError(f"source pipeline failed with exit codes {return_codes}")

    selected: list[dict[str, str]] = []
    bucket_counts: dict[str, int] = {}
    for index in range(n_buckets):
        rows_in_bucket = [entry[2] for entry in heaps[index]]
        rows_in_bucket.sort(key=lambda row: row["PuzzleId"])
        selected.extend(rows_in_bucket)
        lo = args.lo + index * args.width
        hi = min(args.hi, lo + args.width)
        bucket_counts[f"{lo}-{hi - 1}"] = len(rows_in_bucket)

    if not selected:
        raise RuntimeError("source scan retained no puzzles; refusing to write an empty source pool")

    target = pathlib.Path(args.out)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=header)
        writer.writeheader()
        writer.writerows(selected)
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    metadata = {
        "schema": "chessbench.source_pool.v1",
        "source": args.input or URL,
        "source_license": "CC0-1.0",
        "source_license_url": "https://creativecommons.org/publicdomain/zero/1.0/",
        "snapshot": args.snapshot,
        "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "publishable_full_scan": args.max_scan == 0,
        "selection": {
            "algorithm": "lowest-stable-sha256-priority-per-rating-bucket",
            "seed": args.seed,
            "rating_low": args.lo,
            "rating_high_exclusive": args.hi,
            "bucket_width": args.width,
            "per_bucket": args.per_bucket,
            "minimum_popularity": args.min_popularity,
            "minimum_plays": args.min_plays,
        },
        "scanned": scanned,
        "eligible": eligible,
        "retained": len(selected),
        "bucket_counts": bucket_counts,
        "output_sha256": digest,
    }
    meta_path = target.with_suffix(target.suffix + ".meta.json")
    meta_path.write_text(json.dumps(metadata, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {len(selected):,} puzzles -> {target}")
    print(f"metadata -> {meta_path}")
    print(f"sha256:{digest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
