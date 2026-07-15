from __future__ import annotations

import pathlib
from dataclasses import replace

from chessbench.sources.lichess import (
    iter_lichess_puzzles,
    standard_candidate,
    standard_frontier_candidate,
    woodpecker_candidate,
    woodpecker_frontier_candidate,
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
        assert puzzle.nb_plays > 500
        assert puzzle.rating_deviation < 100
        assert {"master", "masterVsMaster", "superGM"} & set(puzzle.themes)
        assert puzzle.game_url.startswith("https://lichess.org/")


def test_frontier_relaxes_rd_only_for_scarce_3000_plus_positions():
    core = next(
        puzzle
        for puzzle in iter_lichess_puzzles(ROOT / "data" / "sample_puzzles.csv")
        if woodpecker_candidate(puzzle)
    )
    standard_frontier = replace(
        core, rating=3100, rating_deviation=109, popularity=85, nb_plays=501
    )
    wood_frontier = replace(standard_frontier, rating_deviation=119, popularity=80)
    assert standard_frontier_candidate(standard_frontier)
    assert woodpecker_frontier_candidate(wood_frontier)
    assert not standard_candidate(standard_frontier)
    assert not woodpecker_candidate(wood_frontier)
