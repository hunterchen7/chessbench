"""Composed/esoteric track: solver correctness on discovered examples, plus the
grader accepting correct answers and rejecting wrong ones across answer shapes."""

import pathlib

import chess
import pytest

from chessbench.conditions import HEADLINE, Condition
from chessbench.core.engine import EngineConfig, find_stockfish
from chessbench.solvers import stipulations
from chessbench.solvers.proofgame import verify_proofgame
from chessbench.tasks.composed import (
    ComposedProblem,
    ComposedSolver,
    OracleComposedSolver,
    grade_composed,
    load_composed,
)

FIXTURE = pathlib.Path(__file__).resolve().parent.parent / "data" / "composed_problems.json"


# --- solver unit tests on independently-discovered examples ---


def test_directmate_1_unique_key():
    board = chess.Board("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1")
    keys = [m.uci() for m in stipulations.directmate_keys(board, 1)]
    assert keys == ["a1a8"]


def test_selfmate_1_verified_and_wrong_key_rejected():
    board = chess.Board("8/1Q6/8/4R3/3p4/8/1q6/5k1K w - - 0 1")
    assert stipulations.verify_selfmate(board, 1, chess.Move.from_uci("b7g2"))
    assert not stipulations.verify_selfmate(board, 1, chess.Move.from_uci("b7b1"))


def test_helpmate_2_line_and_wrong_line():
    board = chess.Board("8/3K4/8/8/8/8/3k4/2Q4N b - - 0 1")
    good = [chess.Move.from_uci(u) for u in ["d2e2", "c1c5", "e2f1", "c5f2"]]
    assert stipulations.verify_helpmate_line(board, 2, good)
    bad = [chess.Move.from_uci(u) for u in ["d2d3", "c1c5", "d3d4", "c5c4"]]
    assert not stipulations.verify_helpmate_line(board, 2, bad)


def test_proofgame_target():
    line = ["e2e4", "e7e5", "g1f3"]
    board = chess.Board()
    for u in line:
        board.push(chess.Move.from_uci(u))
    assert verify_proofgame(board.fen(), line, n_plies=3)
    assert not verify_proofgame(board.fen(), ["e2e4", "e7e5", "b1c3"], n_plies=3)


# --- grader across answer shapes ---


class WrongSolver:
    """Returns a legal move that is NOT the stored solution's first move."""

    name = "wrong"

    def solve(self, problem: ComposedProblem, condition: Condition) -> str:
        board = chess.Board(problem.fen)
        sol0 = problem.solution[0] if problem.solution else None
        for move in board.legal_moves:
            if move.uci() != sol0:
                return move.uci()
        return "0000"


def _oneshot_problems() -> list[ComposedProblem]:
    return [p for p in load_composed(FIXTURE) if p.answer_shape in ("key", "line")]


def test_oracle_solves_all_oneshot():
    oracle: ComposedSolver = OracleComposedSolver()
    problems = _oneshot_problems()
    assert problems, "fixture should contain key/line problems"
    for p in problems:
        res = grade_composed(oracle, p, HEADLINE)
        assert res.solved, f"oracle failed {p.id} ({p.label}): {res.detail}"
        assert res.score == 1.0


def test_wrong_answers_rejected():
    for p in _oneshot_problems():
        res = grade_composed(WrongSolver(), p, HEADLINE)
        assert not res.solved, f"{p.id} wrongly accepted a non-solution"


@pytest.mark.skipif(find_stockfish() is None, reason="stockfish not installed")
def test_study_stockfish_converts_random_does_not():
    from chessbench.agents import RandomAgent, StockfishAgent
    from chessbench.core.engine import Engine
    from chessbench.solvers import grade_study

    study = next(p for p in load_composed(FIXTURE) if p.kind == "study")
    with Engine(EngineConfig(nodes=120_000)) as engine:
        with StockfishAgent(engine=engine) as sf:
            won = grade_study(sf, study.fen, "win", engine, HEADLINE)
        assert won.solved and won.outcome == "checkmate_win"

        rand = grade_study(RandomAgent(seed=1), study.fen, "win", engine, HEADLINE)
        assert not rand.solved  # random keeps the queen but never converts to mate
