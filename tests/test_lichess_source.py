from __future__ import annotations

import pathlib

from chessbench.sources.lichess import (
    iter_lichess_puzzles,
    standard_candidate,
    woodpecker_candidate,
)

ROOT = pathlib.Path(__file__).resolve().parent.parent


def test_plain_snapshot_stream_and_quality_gates():
    puzzles = list(iter_lichess_puzzles(ROOT / "data" / "sample_puzzles.csv"))
    assert len(puzzles) == 500
    assert all(puzzle.id for puzzle in puzzles)
    assert any(standard_candidate(puzzle) for puzzle in puzzles)
    assert any(woodpecker_candidate(puzzle) for puzzle in puzzles)


def test_woodpecker_gate_means_long_master_game():
    for puzzle in iter_lichess_puzzles(ROOT / "data" / "sample_puzzles.csv"):
        if not woodpecker_candidate(puzzle):
            continue
        assert puzzle.num_solver_plies() >= 3
        assert {"master", "masterVsMaster", "superGM"} & set(puzzle.themes)
        assert puzzle.game_url.startswith("https://lichess.org/")
