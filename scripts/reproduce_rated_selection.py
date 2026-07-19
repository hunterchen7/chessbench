#!/usr/bin/env python3
"""Reproduce one canonical rated-pool selection without a database."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from chessbench.rated_pool import iter_rated_pool, load_rated_pool_manifest  # noqa: E402
from chessbench.rated_sessions import (  # noqa: E402
    DeterministicPuzzleSelector,
    GlickoState,
    RatedSessionConfig,
)


DEFAULT_MANIFEST = ROOT / "corpora/pools/rated-lichess-v1.manifest.json"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--seed", type=int, required=True)
    parser.add_argument("--sequence", type=int, required=True)
    parser.add_argument("--rating", type=float, required=True)
    parser.add_argument("--target-radius", type=int, default=100)
    parser.add_argument(
        "--exclude",
        action="append",
        default=[],
        metavar="PUZZLE_ID",
        help="previously used puzzle ID; repeat this option as needed",
    )
    parser.add_argument(
        "--exclude-file",
        type=Path,
        help="optional newline-delimited list of previously used puzzle IDs",
    )
    args = parser.parse_args()

    manifest = load_rated_pool_manifest(args.manifest)
    excluded = list(args.exclude)
    if args.exclude_file:
        excluded.extend(
            line.strip()
            for line in args.exclude_file.read_text(encoding="utf-8").splitlines()
            if line.strip()
        )
    config = RatedSessionConfig(seed=args.seed, target_radius=args.target_radius)
    selector = DeterministicPuzzleSelector(
        list(iter_rated_pool(args.manifest, verify_artifact=False)),
        pool_hash=str(manifest["content_hash"]),
        config=config,
    )
    puzzle, selection = selector.select(
        GlickoState(rating=args.rating),
        sequence=args.sequence,
        excluded=excluded,
    )
    print(json.dumps({
        "schema": "chessbench.reproduced_rated_selection.v1",
        "pool": {
            "name": manifest["name"],
            "version": manifest["version"],
            "content_hash": manifest["content_hash"],
        },
        "selection": selection.to_dict(),
        "puzzle": {
            "puzzle_id": puzzle.id,
            "rating": puzzle.rating,
            "rating_deviation": puzzle.rating_deviation,
        },
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
