"""Game-track correctness: termination, illegal forfeit, retry, ply cap, Elo math,
and that the context-mode axis actually changes the per-turn prompt.
"""

import chess

from chessbench.agents import FirstLegalAgent, GameTurnContext, RandomAgent
from chessbench.conditions import (
    Condition,
    ContextMode,
    Legality,
    PromptStyle,
    Representation,
    build_game_turn,
    game_system_prompt,
)
from chessbench.tasks.games import GameConfig, MatchResult, _request_move, play_game


class FixedGameAgent:
    """Returns a preset sequence of move strings; ignores the board."""

    def __init__(self, *moves: str, name: str = "fixed"):
        self.name = name
        self._moves = list(moves)
        self._i = 0

    def reset(self, color: bool) -> None:
        self._i = 0

    def choose(self, board: chess.Board, ctx: GameTurnContext) -> str:
        m = self._moves[min(self._i, len(self._moves) - 1)]
        self._i += 1
        return m


class BadAgent:
    name = "bad"

    def choose(self, board, ctx):
        return "banana"


def test_fools_mate_checkmate():
    white = FixedGameAgent("f3", "g4")
    black = FixedGameAgent("e5", "Qh4#")
    g = play_game(white, black, Condition(), GameConfig(max_plies=20))
    assert g.result == "0-1"
    assert g.termination == "checkmate"
    assert g.plies == 4


def test_illegal_move_forfeits_free_form():
    g = play_game(BadAgent(), FirstLegalAgent(), Condition(legality=Legality.FREE_FORM))
    assert g.termination == "illegal_forfeit"
    assert g.result == "0-1"          # White (BadAgent) forfeits
    assert g.records[-1].forfeited


def test_move_cap_is_a_draw():
    g = play_game(FirstLegalAgent(), FirstLegalAgent(), Condition(), GameConfig(max_plies=6))
    assert g.termination == "move_cap"
    assert g.result == "1/2-1/2"
    assert g.plies == 6


def test_request_move_retry_recovers():
    board = chess.Board()
    cond = Condition(legality=Legality.RETRY, retry_attempts=3)
    agent = FixedGameAgent("banana", "e4")
    move, illegal, first_legal, raw = _request_move(agent, board, cond, [], None)
    assert move == chess.Move.from_uci("e2e4")
    assert illegal == 1 and first_legal is False


def test_request_move_free_form_no_retry():
    board = chess.Board()
    agent = FixedGameAgent("banana", "e4")
    move, illegal, first_legal, raw = _request_move(agent, board, Condition(legality=Legality.FREE_FORM), [], None)
    assert move is None and illegal == 1


def test_otb_first_illegal_is_recoverable():
    # OTB: the 1st illegal is a penalty, not a loss -- retract and play a legal move.
    cond = Condition(legality=Legality.OTB, otb_illegal_limit=2)
    move, illegal, first_legal, _ = _request_move(FixedGameAgent("banana", "e4"), chess.Board(), cond, [], None)
    assert move == chess.Move.from_uci("e2e4")
    assert illegal == 1 and first_legal is False


def test_otb_second_illegal_forfeits():
    cond = Condition(legality=Legality.OTB, otb_illegal_limit=2)
    move, illegal, *_ = _request_move(BadAgent(), chess.Board(), cond, [], None)
    assert move is None and illegal == 2  # the 2nd cumulative illegal is fatal


def test_otb_prior_penalty_makes_next_illegal_fatal():
    cond = Condition(legality=Legality.OTB, otb_illegal_limit=2)
    move, illegal, *_ = _request_move(BadAgent(), chess.Board(), cond, [], None, prior_illegal=1)
    assert move is None and illegal == 1  # already had 1 penalty -> next illegal loses


def test_pgn_roundtrips():
    g = play_game(FixedGameAgent("f3", "g4"), FixedGameAgent("e5", "Qh4#"), Condition())
    assert '[Result "0-1"]' in g.pgn
    assert "Qh4#" in g.pgn


def test_elo_math():
    assert MatchResult("a", "b", a_wins=5, b_wins=5, draws=0).a_score == 0.5
    ed = MatchResult("a", "b", draws=10).elo_diff()
    assert ed is not None and abs(ed) < 1e-6                            # all draws -> ~0 Elo
    assert MatchResult("a", "b", a_wins=10).elo_diff() is None          # shutout -> undefined
    # a 75% scorer is ~+191 Elo above its opponent
    assert abs(MatchResult("a", "b", a_wins=15, draws=0, b_wins=5).elo_diff() - 190.8) < 1.0


# --- context-mode axis actually changes the prompt ---


def test_context_modes_differ():
    board = chess.Board()
    board.push_san("e4")  # so there is history + a last opponent move
    cond_fresh = Condition(context_mode=ContextMode.FRESH)
    cond_grow = Condition(context_mode=ContextMode.GROWING)
    cond_hybrid = Condition(context_mode=ContextMode.HYBRID)
    kw = dict(history_san=["e4"], last_opponent_move_san="e4", illegal_feedback=None, is_first=False)

    fresh = build_game_turn(board, cond_fresh, **kw)
    grow = build_game_turn(board, cond_grow, **kw)
    hybrid = build_game_turn(board, cond_hybrid, **kw)

    assert "FEN:" in fresh                     # fresh injects the authoritative board
    assert "I played e4" in grow and "FEN:" not in grow   # growing is terse, no board
    assert "I played e4" in hybrid and "FEN:" in hybrid   # hybrid: terse + re-injected board


def test_coached_and_piece_list_render():
    sys = game_system_prompt(Condition(prompt_style=PromptStyle.COACHED), chess.WHITE)
    assert "checklist" in sys.lower()
    turn = build_game_turn(
        chess.Board(), Condition(representation=Representation.PIECE_LIST),
        history_san=[], last_opponent_move_san=None, illegal_feedback=None, is_first=True,
    )
    assert "White: K" in turn and "Black: K" in turn
