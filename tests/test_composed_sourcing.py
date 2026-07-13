"""Validate the sourced composed-problem set (``data/composed_problems.json``).

These tests re-run the project's own verifiers over every stored problem, so a
regression in the sourcing script (or a hand-edited unsound problem) fails CI:
the file may only ever contain solver-validated problems.
"""

import pathlib

import chess

from chessbench.solvers import series, stipulations
from chessbench.solvers.proofgame import verify_proofgame
from chessbench.tasks.composed import load_composed

FIXTURE = pathlib.Path(__file__).resolve().parent.parent / "data" / "composed_problems.json"

_TIERS = {"beginner", "intermediate", "advanced", "expert"}
_KEY_VERIFIER = {
    "directmate": stipulations.verify_directmate,
    "selfmate": stipulations.verify_selfmate,
    "reflexmate": stipulations.verify_reflexmate,
}


def _problems():
    return load_composed(FIXTURE)


def test_at_least_40_problems():
    assert len(_problems()) >= 40


def test_key_problems_verify():
    """directmate / selfmate / reflexmate: solution[0] forces the stipulation."""
    checked = 0
    for p in _problems():
        if p.kind not in _KEY_VERIFIER:
            continue
        assert p.solution, f"{p.id} has no stored key"
        board = chess.Board(p.fen)
        key = chess.Move.from_uci(p.solution[0])
        assert _KEY_VERIFIER[p.kind](board, p.n, key), f"{p.id} ({p.label}) key does not verify"
        checked += 1
    assert checked >= 3


def test_helpmate_lines_verify():
    checked = 0
    for p in _problems():
        if p.kind != "helpmate":
            continue
        board = chess.Board(p.fen)
        line = [chess.Move.from_uci(u) for u in p.solution]
        assert stipulations.verify_helpmate_line(board, p.n, line), f"{p.id} helpmate line invalid"
        checked += 1
    assert checked >= 1


def test_series_and_proofgames_verify():
    checked = 0
    for p in _problems():
        board = chess.Board(p.fen)
        moves = [chess.Move.from_uci(u) for u in p.solution]
        if p.kind == "series_directmate":
            assert series.verify_series_directmate(board, p.n, moves), f"{p.id} ser-# invalid"
        elif p.kind == "series_helpmate":
            assert series.verify_series_helpmate(board, p.n, moves), f"{p.id} ser-h# invalid"
        elif p.kind == "proofgame":
            assert verify_proofgame(p.fen, p.solution, n_plies=p.n), f"{p.id} proof game invalid"
        else:
            continue
        checked += 1
    assert checked >= 1


def test_studies_are_valid_positions():
    for p in _problems():
        if p.kind != "study":
            continue
        assert chess.Board(p.fen).is_valid(), f"{p.id} invalid study position"
        assert p.goal in ("win", "draw"), f"{p.id} missing study goal"


def test_multiple_genres_and_tiers_present():
    problems = _problems()
    genres = {p.kind for p in problems}
    assert len(genres) >= 3, f"expected >= 3 genres, got {sorted(genres)}"

    tiers = {t for p in problems for t in p.themes if t in _TIERS}
    assert len(tiers) >= 2, f"expected multiple difficulty tiers, got {sorted(tiers)}"


def test_every_problem_declares_a_tier():
    for p in _problems():
        assert any(t in _TIERS for t in p.themes), f"{p.id} has no difficulty tier tag"
