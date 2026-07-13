#!/usr/bin/env python3
"""Generate fresh, contamination-free tactical puzzles with Stockfish.

    python scripts/generate_puzzles.py --count 30 --out data/generated_puzzles.json

The positions come from random play, so they (almost surely) never appeared in
any game database and cannot be in a model's pretraining data. See
chessbench.tasks.generate for the "only move" criteria.
"""

from __future__ import annotations

import argparse
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from chessbench.core.engine import Engine, EngineConfig  # noqa: E402
from chessbench.tasks.generate import generate_puzzles
from chessbench.tasks.puzzles import save_puzzles_json


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=30)
    ap.add_argument("--out", default="data/generated_puzzles.json")
    ap.add_argument("--nodes", type=int, default=150_000)
    ap.add_argument("--max-solver-plies", type=int, default=4)
    ap.add_argument("--min-gap-cp", type=int, default=150)
    ap.add_argument("--min-advantage-cp", type=int, default=200)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    with Engine(EngineConfig(nodes=args.nodes)) as engine:
        puzzles = generate_puzzles(
            engine, args.count,
            min_gap_cp=args.min_gap_cp, max_solver_plies=args.max_solver_plies,
            min_advantage_cp=args.min_advantage_cp, seed=args.seed,
        )
    save_puzzles_json(puzzles, args.out)
    n_alt = sum(1 for p in puzzles if p.alternates)
    lengths = sorted(p.num_solver_plies() for p in puzzles)
    print(f"generated {len(puzzles)} puzzles -> {args.out}")
    print(f"  solver-ply lengths: min {lengths[0] if lengths else 0}, max {lengths[-1] if lengths else 0}")
    print(f"  with alternate solutions: {n_alt}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
