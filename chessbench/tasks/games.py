"""Game track: play full games (LLM-vs-LLM or LLM-vs-engine), adjudicate, and
turn match results into an Elo estimate.

Legality handling reuses the Condition axes: FREE_FORM => an illegal move is an
instant forfeit; RETRY => up to `retry_attempts` re-prompts with feedback before
forfeit. Context handling (fresh/growing/hybrid) lives in the agent.

An agent here is anything with `choose(board, GameTurnContext) -> str`; baseline
agents (Random/FirstLegal/Stockfish) qualify directly. Agents may optionally
expose `reset(color)`, called at the start of each game.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import chess
import chess.pgn

from ..agents import Agent, GameTurnContext
from ..conditions import Condition, Legality
from ..core import board as board_utils
from ..core.engine import Engine


@dataclass
class GameConfig:
    max_plies: int = 200          # draw at the cap (à la LLM Chess)
    eval_moves: bool = False      # score each move's centipawn loss (needs eval_engine)


@dataclass
class MoveRecord:
    ply: int
    color: str                    # "white" | "black"
    san: str | None
    uci: str | None
    first_attempt_legal: bool
    illegal_attempts: int
    eval_cp: int | None = None    # side-to-move centipawns AFTER the move (if eval_moves)
    forfeited: bool = False


@dataclass
class GameRecord:
    white: str
    black: str
    result: str                   # "1-0" | "0-1" | "1/2-1/2"
    termination: str              # checkmate | stalemate | insufficient_material |
                                  # repetition | fifty_moves | move_cap | illegal_forfeit
    plies: int
    moves_san: list[str] = field(default_factory=list)
    records: list[MoveRecord] = field(default_factory=list)
    pgn: str = ""

    @property
    def white_score(self) -> float:
        return {"1-0": 1.0, "1/2-1/2": 0.5, "0-1": 0.0}[self.result]

    def illegal_rate(self) -> float:
        n = len(self.records)
        return sum(1 for r in self.records if not r.first_attempt_legal) / n if n else 0.0


def _request_move(
    agent: Agent, board: chess.Board, cond: Condition, history_san: list[str],
    last_opp_san: str | None, prior_illegal: int = 0,
) -> tuple[chess.Move | None, int, bool, str | None]:
    """Solicit one legal move under the condition's legality regime.

    Returns (move|None, illegal_attempts_this_turn, first_attempt_legal, raw).
    A None move means the side forfeits (exhausted retries, or the fatal OTB
    penalty). `prior_illegal` is this side's cumulative illegal count so far (OTB).
    """
    illegal = 0
    first_legal: bool | None = None
    feedback: str | None = None
    raw: str | None = None
    otb = cond.legality == Legality.OTB
    max_tries = None if otb else (cond.retry_attempts + 1 if cond.legality == Legality.RETRY else 1)

    while max_tries is None or illegal < max_tries:
        ctx = GameTurnContext(
            condition=cond, history_san=list(history_san),
            last_opponent_move_san=last_opp_san, illegal_feedback=feedback, ply=board.ply(),
        )
        raw = agent.choose(board, ctx)
        mv = board_utils.parse_move(board, raw)
        if first_legal is None:
            first_legal = mv is not None
        if mv is not None:
            return mv, illegal, bool(first_legal), raw
        illegal += 1
        if otb and prior_illegal + illegal >= cond.otb_illegal_limit:
            return None, illegal, bool(first_legal), raw  # fatal OTB penalty
        feedback = (
            f"Illegal move '{raw}' (OTB penalty {prior_illegal + illegal}/{cond.otb_illegal_limit}); "
            "retract and play a legal move."
            if otb else f"'{raw}' is not a legal move"
        )
    return None, illegal, bool(first_legal), raw


def _termination(board: chess.Board) -> str:
    if board.is_checkmate():
        return "checkmate"
    if board.is_stalemate():
        return "stalemate"
    if board.is_insufficient_material():
        return "insufficient_material"
    if board.is_fivefold_repetition() or board.can_claim_threefold_repetition():
        return "repetition"
    if board.is_seventyfive_moves() or board.can_claim_fifty_moves():
        return "fifty_moves"
    return "unknown"


def play_game(
    white, black, condition: Condition, config: GameConfig | None = None,
    *, eval_engine: Engine | None = None, start_fen: str | None = None,
) -> GameRecord:
    config = config or GameConfig()
    board = chess.Board(start_fen) if start_fen else chess.Board()
    for agent, color in ((white, chess.WHITE), (black, chess.BLACK)):
        if hasattr(agent, "reset"):
            agent.reset(color)

    history_san: list[str] = []
    records: list[MoveRecord] = []
    last_opp_san: str | None = None
    cumulative_illegal: dict[bool, int] = {chess.WHITE: 0, chess.BLACK: 0}  # for OTB penalties

    while True:
        if board.is_game_over(claim_draw=True):
            term = _termination(board)
            result = board.result(claim_draw=True)
            break
        if board.ply() >= config.max_plies:
            term, result = "move_cap", "1/2-1/2"
            break

        mover = white if board.turn == chess.WHITE else black
        color_str = "white" if board.turn == chess.WHITE else "black"
        side = board.turn
        move, illegal, first_legal, raw = _request_move(
            mover, board, condition, history_san, last_opp_san, prior_illegal=cumulative_illegal[side]
        )
        cumulative_illegal[side] += illegal

        if move is None:  # forfeit by illegal move
            result = "0-1" if board.turn == chess.WHITE else "1-0"
            records.append(MoveRecord(board.ply(), color_str, None, None, first_legal, illegal, forfeited=True))
            term = "illegal_forfeit"
            break

        san = board.san(move)
        board.push(move)
        eval_cp = None
        if config.eval_moves and eval_engine is not None:
            eval_cp = eval_engine.evaluate(board)
        records.append(MoveRecord(board.ply(), color_str, san, move.uci(), first_legal, illegal, eval_cp))
        history_san.append(san)
        last_opp_san = san

    white_name = getattr(white, "name", "white")
    black_name = getattr(black, "name", "black")
    return GameRecord(
        white=white_name, black=black_name, result=result, termination=term,
        plies=len(history_san), moves_san=history_san, records=records,
        pgn=_to_pgn(history_san, white_name, black_name, result, term, start_fen),
    )


def _to_pgn(moves_san, white, black, result, termination, start_fen) -> str:
    game = chess.pgn.Game()
    game.headers.update({"White": white, "Black": black, "Result": result, "Termination": termination})
    board = chess.Board(start_fen) if start_fen else chess.Board()
    if start_fen:
        game.headers["FEN"] = start_fen
        game.setup(board)
    node: chess.pgn.GameNode = game
    for san in moves_san:
        move = board.parse_san(san)
        node = node.add_variation(move)
        board.push(move)
    return str(game)


# --- Matches and Elo ---


@dataclass
class MatchResult:
    a: str
    b: str
    a_wins: int = 0
    b_wins: int = 0
    draws: int = 0
    games: list[GameRecord] = field(default_factory=list)

    @property
    def n(self) -> int:
        return self.a_wins + self.b_wins + self.draws

    @property
    def a_score(self) -> float:
        return (self.a_wins + 0.5 * self.draws) / self.n if self.n else 0.0

    def elo_diff(self) -> float | None:
        """Estimated Elo of A minus B from the match score (None if a shutout)."""
        s = self.a_score
        if s <= 0.0 or s >= 1.0:
            return None
        return -400.0 * math.log10(1.0 / s - 1.0)


def play_match(a, b, n_games: int, condition: Condition, config: GameConfig | None = None,
               *, eval_engine: Engine | None = None) -> MatchResult:
    """Play n_games alternating colors so White's advantage cancels out."""
    res = MatchResult(a=getattr(a, "name", "a"), b=getattr(b, "name", "b"))
    for i in range(n_games):
        if i % 2 == 0:
            g = play_game(a, b, condition, config, eval_engine=eval_engine)
            a_is_white = True
        else:
            g = play_game(b, a, condition, config, eval_engine=eval_engine)
            a_is_white = False
        res.games.append(g)
        if g.result == "1/2-1/2":
            res.draws += 1
        else:
            white_won = g.result == "1-0"
            a_won = white_won == a_is_white
            if a_won:
                res.a_wins += 1
            else:
                res.b_wins += 1
    return res
