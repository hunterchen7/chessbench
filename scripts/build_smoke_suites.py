#!/usr/bin/env python3
"""Freeze tiny, deterministic, cross-track suites for paid integration tests."""

from __future__ import annotations

import hashlib
import pathlib
import sys
from collections import defaultdict

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from chessbench.suite import (  # noqa: E402
    Suite,
    freeze_composed_suite,
    freeze_puzzle_suite,
    load_suite,
    save_suite,
)
from chessbench.tasks.composed import ComposedProblem  # noqa: E402
from chessbench.tasks.puzzles import Puzzle  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
SEED = 20260715
STANDARD_V4_BANDS = (
    (600, 899),
    (900, 1199),
    (1200, 1499),
    (1500, 1799),
    (1800, 2099),
    (2100, 2399),
    (2400, 2599),
    (2600, 2799),
    (2800, 2999),
    (3000, 3199),
)


def _priority(item_id: str) -> str:
    return hashlib.sha256(f"chessbench-smoke-v1:{SEED}:{item_id}".encode()).hexdigest()


def _band_sample(
    suite: Suite, bands: tuple[tuple[int, int], ...], per_band: int
) -> list[Puzzle]:
    grouped: dict[tuple[int, int], list[Puzzle]] = defaultdict(list)
    for puzzle in suite.puzzles():
        for band in bands:
            if band[0] <= puzzle.rating <= band[1]:
                grouped[band].append(puzzle)
                break
    selected: list[Puzzle] = []
    for band in bands:
        candidates = sorted(grouped[band], key=lambda puzzle: _priority(puzzle.id))
        if len(candidates) < per_band:
            raise RuntimeError(
                f"{suite.name}: band {band} has only {len(candidates)} items"
            )
        selected.extend(candidates[:per_band])
    return selected


def _genre_sample(suite: Suite) -> list[ComposedProblem]:
    grouped: dict[str, list[ComposedProblem]] = defaultdict(list)
    for problem in suite.composed_problems():
        grouped[problem.kind].append(problem)
    return sorted(
        (
            min(problems, key=lambda problem: _priority(problem.id))
            for problems in grouped.values()
        ),
        key=lambda problem: (problem.kind, problem.id),
    )


def _woodpecker_section_sample(suite: Suite) -> list[Puzzle]:
    """Two deterministic fixtures per editorial section."""
    grouped: dict[str, list[Puzzle]] = defaultdict(list)
    for puzzle in suite.puzzles():
        grouped[puzzle.difficulty_band].append(puzzle)
    selected: list[Puzzle] = []
    for section in ("easy", "medium", "hard"):
        candidates = sorted(grouped[section], key=lambda puzzle: _priority(puzzle.id))
        selected.extend(candidates[:2])
    return sorted(selected, key=lambda puzzle: puzzle.id)


def build() -> list[tuple[Suite, pathlib.Path]]:
    standard_v1_parent = load_suite(ROOT / "suites/public/standard-lichess-v2.json")
    standard_v2_parent = load_suite(ROOT / "suites/public/standard-lichess-v3.json")
    standard_v3_parent = load_suite(ROOT / "suites/public/standard-lichess-v4.json")
    woodpecker_parent = load_suite(ROOT / "suites/public/woodpecker-masters-v1.json")
    esoteric_parent = load_suite(ROOT / "suites/public/esoteric-seed-v2.json")

    bands = (
        *tuple((start, start + 399) for start in range(600, 3000, 400)),
        (3000, 3199),
    )
    standard_v1 = freeze_puzzle_suite(
        sorted(
            _band_sample(standard_v1_parent, bands, 2),
            key=lambda puzzle: puzzle.id,
        ),
        name="standard-smoke-v1",
        version="1.0.0",
        source_label=f"suite:{standard_v1_parent.name}@{standard_v1_parent.content_hash}",
        seed=SEED,
    )
    standard_v2 = freeze_puzzle_suite(
        sorted(
            _band_sample(standard_v2_parent, bands, 2),
            key=lambda puzzle: (puzzle.rating, puzzle.id),
        ),
        name="standard-smoke-v2",
        version="2.0.0",
        source_label=f"suite:{standard_v2_parent.name}@{standard_v2_parent.content_hash}",
        seed=SEED,
    )
    standard_v3 = freeze_puzzle_suite(
        sorted(
            _band_sample(standard_v3_parent, STANDARD_V4_BANDS, 2),
            key=lambda puzzle: (puzzle.rating, puzzle.id),
        ),
        name="standard-smoke-v3",
        version="3.0.0",
        source_label=f"suite:{standard_v3_parent.name}@{standard_v3_parent.content_hash}",
        seed=SEED,
    )
    woodpecker = freeze_puzzle_suite(
        _woodpecker_section_sample(woodpecker_parent),
        name="woodpecker-smoke-v1",
        version="1.0.0",
        source_label=f"suite:{woodpecker_parent.name}@{woodpecker_parent.content_hash}",
        seed=SEED,
    )
    esoteric = freeze_composed_suite(
        _genre_sample(esoteric_parent),
        name="esoteric-smoke-v2",
        version="2.0.0",
        source_label=f"suite:{esoteric_parent.name}@{esoteric_parent.content_hash}",
        seed=SEED,
    )
    return [
        (standard_v1, ROOT / "suites/public/standard-smoke-v1.json"),
        (standard_v2, ROOT / "suites/public/standard-smoke-v2.json"),
        (standard_v3, ROOT / "suites/public/standard-smoke-v3.json"),
        (woodpecker, ROOT / "suites/public/woodpecker-smoke-v1.json"),
        (esoteric, ROOT / "suites/public/esoteric-smoke-v2.json"),
    ]


def main() -> int:
    for suite, path in build():
        save_suite(suite, path)
        print(f"{suite.name}: {len(suite.items)} items, {suite.content_hash} -> {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
