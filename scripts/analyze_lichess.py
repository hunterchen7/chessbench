#!/usr/bin/env python3
"""Stream a complete Lichess puzzle snapshot into a compact audit report."""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import sys
from collections import Counter
from datetime import datetime, timezone

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from chessbench.sources.lichess import (  # noqa: E402
    MASTER_THEMES,
    iter_lichess_puzzles,
    standard_candidate,
    standard_frontier_candidate,
    woodpecker_candidate,
    woodpecker_frontier_candidate,
)


def _bucket(rating: int, *, width: int = 200, origin: int = 0) -> str:
    lo = origin + (rating - origin) // width * width
    return f"{lo}-{lo + width - 1}"


def analyze(path: pathlib.Path, *, snapshot: str) -> dict[str, object]:
    scanned = 0
    themes: Counter[str] = Counter()
    ratings: Counter[str] = Counter()
    lengths: Counter[int] = Counter()
    standard_bands: Counter[str] = Counter()
    wood_bands: Counter[str] = Counter()
    wood_lengths: Counter[int] = Counter()
    wood_master_themes: Counter[str] = Counter()
    standard_frontier = 0
    wood_frontier = 0

    for puzzle in iter_lichess_puzzles(path):
        scanned += 1
        themes.update(puzzle.themes)
        ratings.update([_bucket(puzzle.rating)])
        lengths.update([puzzle.num_solver_plies()])
        if standard_candidate(puzzle):
            standard_bands.update([_bucket(puzzle.rating, width=400, origin=600)])
        if woodpecker_candidate(puzzle):
            wood_bands.update([_bucket(puzzle.rating, width=400, origin=1000)])
            wood_lengths.update([puzzle.num_solver_plies()])
            wood_master_themes.update(set(puzzle.themes) & MASTER_THEMES)
        if standard_frontier_candidate(puzzle):
            standard_frontier += 1
        if woodpecker_frontier_candidate(puzzle):
            wood_frontier += 1
        if scanned % 500_000 == 0:
            print(f"scanned {scanned:,}", file=sys.stderr)

    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return {
        "schema": "chessbench.lichess_analysis.v1",
        "snapshot": snapshot,
        "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source_file": path.name,
        "source_sha256": digest,
        "scanned": scanned,
        "rating_buckets_200": dict(sorted(ratings.items(), key=lambda item: int(item[0].split("-")[0]))),
        "solver_plies": {str(k): v for k, v in sorted(lengths.items())},
        "top_themes": dict(themes.most_common(80)),
        "quality_gates": {
            "standard": {
                "definition": "rating 600-2999; RD<100; popularity>=90; plays>500; game URL",
                "eligible": sum(standard_bands.values()),
                "rating_buckets_400": dict(
                    sorted(standard_bands.items(), key=lambda item: int(item[0].split("-")[0]))
                ),
            },
            "woodpecker_master_games": {
                "definition": (
                    "rating 1000-2999; RD<100; popularity>=85; plays>500; "
                    ">=3 solver moves; master/masterVsMaster/superGM; game URL"
                ),
                "eligible": sum(wood_bands.values()),
                "rating_buckets_400": dict(
                    sorted(wood_bands.items(), key=lambda item: int(item[0].split("-")[0]))
                ),
                "solver_plies": {str(k): v for k, v in sorted(wood_lengths.items())},
                "master_theme_counts": dict(sorted(wood_master_themes.items())),
            },
            "standard_frontier": {
                "definition": "rating 3000-3199; RD<110; popularity>=85; plays>500; game URL",
                "eligible": standard_frontier,
            },
            "woodpecker_frontier": {
                "definition": (
                    "rating 3000-3199; RD<120; popularity>=80; plays>500; "
                    ">=3 solver moves; master/masterVsMaster/superGM; game URL"
                ),
                "eligible": wood_frontier,
            },
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("snapshot_file", type=pathlib.Path)
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--out", type=pathlib.Path, required=True)
    args = parser.parse_args()
    report = analyze(args.snapshot_file, snapshot=args.snapshot)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=1) + "\n", encoding="utf-8")
    print(f"wrote analysis of {report['scanned']:,} puzzles -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
