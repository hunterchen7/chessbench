#!/usr/bin/env python3
"""Build Standard v3 with the v2 membership ordered by rating then puzzle id."""

from __future__ import annotations

from pathlib import Path

from chessbench.suite import Suite, freeze_puzzle_suite, load_suite, save_suite


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "suites/public/standard-lichess-v2.json"
TARGET = ROOT / "suites/public/standard-lichess-v3.json"


def build() -> Suite:
    source = load_suite(SOURCE)
    ordered = sorted(source.puzzles(), key=lambda puzzle: (puzzle.rating, puzzle.id))
    return freeze_puzzle_suite(
        ordered,
        name="standard-lichess-v3",
        version="1.0.0",
        visibility="public",
        source_label=(
            f"suite:{source.name}@{source.content_hash};ordering=rating-asc,id-asc"
        ),
        seed=source.seed,
    )


def main() -> int:
    suite = build()
    save_suite(suite, TARGET)
    print(
        f"{suite.name}: {len(suite.items)} rating-ascending items, "
        f"{suite.content_hash} -> {TARGET.relative_to(ROOT)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
