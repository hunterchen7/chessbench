#!/usr/bin/env python3
"""Recalibrate a suite's puzzle ratings with the Stockfish engine ladder and
rebuild the (private) suite with Lichess-comparable difficulty.

    python scripts/calibrate_suite.py --suite suites/private/tactical-private-v1.json \
        --name tactical-private-cal-v1 --out suites/private/tactical-private-cal-v1.json
"""

from __future__ import annotations

import argparse
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from chessbench.calibration import default_ladder, recalibrate  # noqa: E402
from chessbench.suite import build_puzzle_suite, load_suite, save_suite  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--suite", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--nodes", type=int, default=200_000)
    ap.add_argument("--visibility", default="private", choices=["public", "private"])
    args = ap.parse_args()

    suite = load_suite(args.suite)
    puzzles = suite.puzzles()
    print(f"calibrating {len(puzzles)} puzzles with an {len(default_ladder())}-rung engine ladder...")
    calibrated = recalibrate(puzzles, default_ladder(nodes=args.nodes))

    new = build_puzzle_suite(calibrated, name=args.name, visibility=args.visibility,
                             source_label="generated+calibrated", per_bucket=100_000, lo=1200, hi=3200)
    save_suite(new, args.out)
    from collections import Counter
    dist = dict(sorted(Counter(int(it["rating"]) for it in new.items).items()))  # type: ignore[call-overload]
    print(f"wrote {len(new.items)} calibrated puzzles -> {args.out}")
    print(f"  {new.content_hash}\n  rating distribution: {dist}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
