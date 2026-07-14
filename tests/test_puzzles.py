"""Grading correctness -- the ply-offset convention, legality, and mate acceptance.

Uses a hand-built mate-in-1 puzzle so expectations are exact and engine-free.
Puzzle: Black (setup) shuffles a distant queen, then White has Ra8#.
"""

import chess

from chessbench.agents import TurnContext
from chessbench.conditions import HEADLINE, Condition, Legality, mode_condition
from chessbench.tasks.puzzles import Puzzle, grade_puzzle

# FEN is BEFORE the opponent's setup move; moves[0] is that setup move.
MATE_IN_1 = Puzzle(
    id="test1",
    fen="6k1/5ppp/8/8/8/7q/8/R5K1 b - - 0 1",
    moves=["h3h6", "a1a8"],  # Black Qh6 (setup), then White Ra8#
    rating=1200,
    themes=["mate", "mateIn1", "backRankMate"],
)


class FixedAgent:
    """Returns preset move strings in order (one per solver ply)."""

    def __init__(self, *replies: str):
        self.name = "fixed"
        self._replies = list(replies)
        self._i = 0

    def choose(self, board: chess.Board, ctx: TurnContext) -> str:
        r = self._replies[min(self._i, len(self._replies) - 1)]
        self._i += 1
        return r


class FixedLineAgent(FixedAgent):
    def solve_line(self, board: chess.Board, ctx: TurnContext) -> str:
        return self.choose(board, ctx)


def test_setup_move_applied_and_solver_is_white():
    assert MATE_IN_1.solver_is_white is True


def test_correct_move_uci_solves():
    res = grade_puzzle(FixedAgent("a1a8"), MATE_IN_1, HEADLINE)
    assert res.solved and res.failure_reason is None
    assert res.first_move_legal and res.all_moves_legal
    assert res.plies_correct == 1


def test_correct_move_san_solves():
    res = grade_puzzle(FixedAgent("Ra8#"), MATE_IN_1, HEADLINE)
    assert res.solved


def test_illegal_move_recorded_as_illegal():
    res = grade_puzzle(FixedAgent("e2e4"), MATE_IN_1, HEADLINE)  # no piece on e2
    assert not res.solved
    assert res.failure_reason == "illegal"
    assert res.first_move_legal is False
    assert res.illegal_attempts == 1


def test_legal_but_wrong_move():
    res = grade_puzzle(FixedAgent("Kg2"), MATE_IN_1, HEADLINE)  # legal, not the solution
    assert not res.solved
    assert res.failure_reason == "wrong_move"
    assert res.first_move_legal is True


def test_retry_regime_recovers_after_illegal():
    cond = Condition(legality=Legality.RETRY, retry_attempts=3)
    # first reply illegal, second correct
    res = grade_puzzle(FixedAgent("banana", "a1a8"), MATE_IN_1, cond)
    assert res.solved
    assert res.first_move_legal is False   # first attempt was illegal...
    assert res.illegal_attempts == 1       # ...but it recovered on retry


def test_free_form_does_not_retry():
    cond = Condition(legality=Legality.FREE_FORM)
    res = grade_puzzle(FixedAgent("banana", "a1a8"), MATE_IN_1, cond)
    assert not res.solved  # no second attempt allowed
    assert res.failure_reason == "illegal"


# Doubled major pieces: after Black's setup Qh6, White has TWO mates (Re8#, Ra8#).
TWO_MATES = "6k1/5ppp/8/8/8/7q/8/R3R1K1 b - - 0 1"


def test_alternate_mate_accepted_on_final_ply():
    board = chess.Board(TWO_MATES)
    board.push(chess.Move.from_uci("h3h6"))
    mates = [m.uci() for m in board.legal_moves if _is_mate(board, m)]
    assert len(mates) >= 2, "fixture should offer multiple mates"
    expected, alternate = mates[0], mates[1]
    puzzle = Puzzle(id="alt", fen=TWO_MATES, moves=["h3h6", expected], rating=1200)
    res = grade_puzzle(FixedAgent(alternate), puzzle, HEADLINE)
    assert res.solved  # a different mating move is accepted on the mating ply


def _is_mate(board: chess.Board, move: chess.Move) -> bool:
    board.push(move)
    try:
        return board.is_checkmate()
    finally:
        board.pop()


# A 2-solver-move puzzle (setup = e4; solver plays as Black): e5 ... Nc6.
TWO_MOVE = Puzzle(id="two", fen=chess.STARTING_FEN, moves=["e2e4", "e7e5", "g1f3", "b8c6"], rating=1500)


def test_full_credit_multi_move():
    res = grade_puzzle(FixedAgent("e7e5", "b8c6"), TWO_MOVE, HEADLINE)
    assert res.solved and res.score == 1.0
    assert res.plies_correct == 2 and res.solver_plies == 2


def test_partial_credit_multi_move():
    # first solver move right, second wrong -> half credit, not solved
    res = grade_puzzle(FixedAgent("e7e5", "a7a6"), TWO_MOVE, HEADLINE)
    assert not res.solved
    assert res.score == 0.5
    assert res.plies_correct == 1
    assert res.failure_reason == "wrong_move"


def test_zero_credit_first_move_wrong():
    res = grade_puzzle(FixedAgent("d7d5"), TWO_MOVE, HEADLINE)
    assert not res.solved and res.score == 0.0 and res.plies_correct == 0


def test_alternate_solution_accepted():
    # same opening but the 2nd solver move Nf6 is an accepted alternate line
    puzzle = Puzzle(
        id="alt2", fen=chess.STARTING_FEN, moves=["e2e4", "e7e5", "g1f3", "b8c6"], rating=1500,
        alternates=[["e7e5", "g1f3", "g8f6"]],
    )
    res = grade_puzzle(FixedAgent("e7e5", "g8f6"), puzzle, HEADLINE)
    assert res.solved and res.score == 1.0


def test_full_line_protocol_grades_one_request():
    res = grade_puzzle(FixedLineAgent("line: e5 Nf3 Nc6"), TWO_MOVE, mode_condition(4))
    assert res.solved
    assert res.moves_played == ["e7e5", "g1f3", "b8c6"]
    assert res.plies_correct == 2


def test_full_line_protocol_gives_prefix_partial_credit():
    res = grade_puzzle(FixedLineAgent("line: e5 Nf3 a6"), TWO_MOVE, mode_condition(4))
    assert not res.solved
    assert res.failure_reason == "wrong_move"
    assert res.score == 0.5
