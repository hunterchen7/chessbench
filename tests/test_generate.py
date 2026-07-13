"""Puzzle sourcing: random-position sanity, Lichess curation, and (engine-gated)
that generated puzzles are well-formed and solvable by the oracle."""

import chess
import pytest

from chessbench.core.engine import EngineConfig, find_stockfish
from chessbench.tasks.generate import curate_lichess, random_positions
from chessbench.tasks.puzzles import Puzzle


def test_random_positions_are_legal_with_setup_move():
    positions = random_positions(5, min_plies=6, max_plies=20, seed=1)
    assert len(positions) == 5
    for board, setup in positions:
        assert setup in board.legal_moves           # setup move is legal in the FEN
        assert not board.is_game_over()


def _p(rd: int, plays: int, pop: int) -> Puzzle:
    return Puzzle(id="x", fen=chess.STARTING_FEN, moves=["e2e4", "e7e5"], rating=1500,
                  rating_deviation=rd, nb_plays=plays, popularity=pop)


def test_curate_lichess_filters_low_quality():
    good = _p(rd=70, plays=5000, pop=95)
    bad_rd = _p(rd=200, plays=5000, pop=95)      # unconverged rating
    bad_plays = _p(rd=70, plays=10, pop=95)      # barely tested
    bad_pop = _p(rd=70, plays=5000, pop=10)      # disliked/ambiguous
    kept = curate_lichess([good, bad_rd, bad_plays, bad_pop])
    assert len(kept) == 1 and kept[0] is not good  # returns copies


@pytest.mark.skipif(find_stockfish() is None, reason="stockfish not installed")
def test_generated_puzzles_are_wellformed_and_solvable():
    from chessbench.agents import StockfishAgent
    from chessbench.conditions import HEADLINE
    from chessbench.core.engine import Engine
    from chessbench.tasks.generate import generate_puzzles
    from chessbench.tasks.puzzles import grade_puzzle

    with Engine(EngineConfig(nodes=60_000)) as engine:
        puzzles = generate_puzzles(engine, 2, seed=3, max_solver_plies=3)
        assert puzzles, "generator should find at least one tactic"
        for p in puzzles:
            assert p.source == "generated"
            assert len(p.moves) % 2 == 0  # setup + odd number of solver-ending plies
            assert p.solver_is_white in (True, False)
        with StockfishAgent(engine=engine) as oracle:
            for p in puzzles:
                res = grade_puzzle(oracle, p, HEADLINE)
                assert res.solved, f"oracle failed its own generated puzzle {p.id}"
