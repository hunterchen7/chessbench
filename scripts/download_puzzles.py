#!/usr/bin/env python3
"""Download and stratify puzzles from the full Lichess puzzle database (CC0).

The full dump is ~6M puzzles (~270 MB zstd). This streams it, decompresses on
the fly, and samples up to N puzzles per rating bucket so you get a difficulty-
balanced set without downloading everything.

Usage:
    python scripts/download_puzzles.py --per-bucket 200 --out data/puzzles_balanced.csv

Requires the `zstd` CLI on PATH (brew install zstd / apt install zstd).

CONTAMINATION NOTE: these are public puzzles likely present in pretraining data.
For a clean measurement, prefer post-model-cutoff positions or apply the
color-swap/mirror perturbations described in the README.
"""

from __future__ import annotations

import argparse
import csv
import io
import subprocess
import sys
from collections import defaultdict

URL = "https://database.lichess.org/lichess_db_puzzle.csv.zst"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-bucket", type=int, default=200)
    ap.add_argument("--width", type=int, default=200)
    ap.add_argument("--lo", type=int, default=400)
    ap.add_argument("--hi", type=int, default=3000)
    ap.add_argument("--out", default="data/puzzles_balanced.csv")
    ap.add_argument("--max-scan", type=int, default=2_000_000,
                    help="stop after scanning this many rows")
    args = ap.parse_args()

    curl = subprocess.Popen(["curl", "-s", URL], stdout=subprocess.PIPE)
    zstd = subprocess.Popen(["zstd", "-dc"], stdin=curl.stdout, stdout=subprocess.PIPE)
    assert zstd.stdout is not None
    reader = csv.DictReader(io.TextIOWrapper(zstd.stdout, encoding="utf-8"))

    buckets: dict[int, list[dict]] = defaultdict(list)
    n_buckets = (args.hi - args.lo) // args.width
    header: list[str] = reader.fieldnames or []
    scanned = 0
    for row in reader:
        scanned += 1
        if scanned > args.max_scan:
            break
        try:
            rating = int(row["Rating"])
        except (KeyError, ValueError):
            continue
        idx = (rating - args.lo) // args.width
        if idx < 0 or idx >= n_buckets:
            continue
        if len(buckets[idx]) < args.per_bucket:
            buckets[idx].append(row)
        if all(len(buckets[i]) >= args.per_bucket for i in range(n_buckets)):
            break
        if scanned % 100_000 == 0:
            filled = sum(len(v) for v in buckets.values())
            print(f"  scanned {scanned:,}, collected {filled}", file=sys.stderr)

    rows = [r for i in sorted(buckets) for r in buckets[i]]
    with open(args.out, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=header)
        writer.writeheader()
        writer.writerows(rows)
    print(f"wrote {len(rows)} puzzles across {len(buckets)} buckets -> {args.out}")
    for proc in (zstd, curl):
        if proc.poll() is None:
            proc.terminate()
    return 0


if __name__ == "__main__":
    sys.exit(main())
