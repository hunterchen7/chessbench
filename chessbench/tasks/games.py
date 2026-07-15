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
from collections.abc import Callable
from dataclasses import dataclass, field

import chess
import chess.pgn

from ..agents import Agent, GameTurnContext
from ..conditions import Condition, Legality
from ..core import board as board_utils, metrics
from ..core.engine import Engine


@dataclass
class GameConfig:
    max_plies: int = 200  # cap the game length (à la LLM Chess)
    eval_moves: bool = False  # score each move's centipawn loss (needs eval_engine)
    adjudicate_cp: int = 200  # at the cap, award the win if |eval| >= this (needs eval_engine); 0 disables


@dataclass
class MoveAttempt:
    system_prompt: str | None
    prompt: str | None
    raw_response: str
    parsed_move: str | None
    legal: bool
    explanation: str | None = None
    response_format_valid: bool | None = None
    response_format_error: str | None = None
    response_format: dict[str, object] | None = None
    prompt_tokens: int = 0
    completion_tokens: int = 0
    reasoning_tokens: int = 0
    cost_usd: float = 0.0


@dataclass
class MoveRecord:
    ply: int
    color: str  # "white" | "black"
    san: str | None
    uci: str | None
    first_attempt_legal: bool
    illegal_attempts: int
    eval_cp: int | None = None  # side-to-move centipawns AFTER the move (if eval_moves)
    forfeited: bool = False
    attempts: list[MoveAttempt] = field(default_factory=list)


@dataclass
class GameRecord:
    white: str
    black: str
    result: str  # "1-0" | "0-1" | "1/2-1/2"
    termination: str  # checkmate | stalemate | insufficient_material |
    # repetition | fifty_moves | move_cap | illegal_forfeit
    plies: int
    moves_san: list[str] = field(default_factory=list)
    records: list[MoveRecord] = field(default_factory=list)
    pgn: str = ""
    start_fen: str | None = None  # None = standard start; set for opening-book games

    @property
    def white_score(self) -> float:
        return {"1-0": 1.0, "1/2-1/2": 0.5, "0-1": 0.0}[self.result]

    def illegal_rate(self) -> float:
        n = len(self.records)
        return (
            sum(1 for r in self.records if not r.first_attempt_legal) / n if n else 0.0
        )


def accuracy_by_color(records: list[MoveRecord]) -> tuple[float | None, float | None]:
    """Lichess-style Accuracy% (0-100) per side from the per-move eval sequence.

    Uses the win%-drop model (no best-move eval needed): each move's accuracy is
    move_accuracy(win_before, win_after) from the *mover's* POV. Requires
    per-move eval_cp (from --eval-moves); returns (None, None) if unavailable.
    """
    if not records or any(r.eval_cp is None for r in records):
        return (None, None)
    white: list[float] = []
    black: list[float] = []
    prev_mover_eval = 0  # before ply 0, ~equal from White's (the mover's) POV
    for r in records:
        assert r.eval_cp is not None
        win_before = metrics.win_percent(prev_mover_eval)  # mover POV, before the move
        win_after = 100.0 - metrics.win_percent(
            r.eval_cp
        )  # mover POV, after (eval is opponent POV)
        (white if r.color == "white" else black).append(
            metrics.move_accuracy(win_before, win_after)
        )
        prev_mover_eval = r.eval_cp  # after this ply the eval is the next mover's POV
    return (
        sum(white) / len(white) if white else None,
        sum(black) / len(black) if black else None,
    )


def _request_move(
    agent: Agent,
    board: chess.Board,
    cond: Condition,
    history_san: list[str],
    last_opp_san: str | None,
    prior_illegal: int = 0,
) -> tuple[chess.Move | None, int, bool, list[MoveAttempt]]:
    """Solicit one legal move under the condition's legality regime.

    Returns (move|None, illegal_attempts_this_turn, first_attempt_legal, attempts).
    A None move means the side forfeits (exhausted retries, or the fatal OTB
    penalty). `prior_illegal` is this side's cumulative illegal count so far (OTB).
    """
    illegal = 0
    first_legal: bool | None = None
    feedback: str | None = None
    raw: str | None = None
    attempts: list[MoveAttempt] = []
    otb = cond.legality == Legality.OTB
    max_tries = (
        None
        if otb
        else (cond.retry_attempts + 1 if cond.legality == Legality.RETRY else 1)
    )

    while max_tries is None or illegal < max_tries:
        ctx = GameTurnContext(
            condition=cond,
            history_san=list(history_san),
            last_opponent_move_san=last_opp_san,
            illegal_feedback=feedback,
            ply=board.ply(),
        )
        raw = agent.choose(board, ctx)
        mv = board_utils.parse_move(board, raw)
        usage = ctx.last_usage or {}
        details = usage.get("completion_tokens_details")
        reasoning_value = (
            details.get("reasoning_tokens", 0) if isinstance(details, dict) else 0
        )
        reasoning_tokens = (
            int(reasoning_value)
            if isinstance(reasoning_value, (int, float, str))
            else 0
        )
        prompt_value = usage.get("prompt_tokens", 0)
        completion_value = usage.get("completion_tokens", 0)
        attempts.append(
            MoveAttempt(
                system_prompt=ctx.last_system_prompt,
                prompt=ctx.last_prompt,
                raw_response=ctx.last_raw_response or raw,
                parsed_move=mv.uci() if mv is not None else None,
                legal=mv is not None,
                explanation=ctx.last_explanation,
                response_format_valid=ctx.last_response_format_valid,
                response_format_error=ctx.last_response_format_error,
                response_format=ctx.last_response_format,
                prompt_tokens=int(prompt_value)
                if isinstance(prompt_value, (int, float, str))
                else 0,
                completion_tokens=int(completion_value)
                if isinstance(completion_value, (int, float, str))
                else 0,
                reasoning_tokens=reasoning_tokens,
                cost_usd=ctx.last_cost,
            )
        )
        if first_legal is None:
            first_legal = mv is not None
        if mv is not None:
            return mv, illegal, bool(first_legal), attempts
        illegal += 1
        if otb and prior_illegal + illegal >= cond.otb_illegal_limit:
            return None, illegal, bool(first_legal), attempts  # fatal OTB penalty
        feedback = (
            f"Illegal move '{raw}' (OTB penalty {prior_illegal + illegal}/{cond.otb_illegal_limit}); "
            "retract and play a legal move."
            if otb
            else f"'{raw}' is not a legal move"
        )
    return None, illegal, bool(first_legal), attempts


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
    white,
    black,
    condition: Condition,
    config: GameConfig | None = None,
    *,
    eval_engine: Engine | None = None,
    start_fen: str | None = None,
    on_move: Callable[[chess.Board, list[MoveRecord]], None] | None = None,
) -> GameRecord:
    config = config or GameConfig()
    board = chess.Board(start_fen) if start_fen else chess.Board()
    for agent, color in ((white, chess.WHITE), (black, chess.BLACK)):
        if hasattr(agent, "reset"):
            agent.reset(color)

    history_san: list[str] = []
    records: list[MoveRecord] = []
    last_opp_san: str | None = None
    cumulative_illegal: dict[bool, int] = {
        chess.WHITE: 0,
        chess.BLACK: 0,
    }  # for OTB penalties

    while True:
        if board.is_game_over(claim_draw=True):
            term = _termination(board)
            result = board.result(claim_draw=True)
            break
        if board.ply() >= config.max_plies:
            # At the cap, adjudicate by engine eval if available: a clearly winning
            # side (>= adjudicate_cp, from side-to-move POV) takes the point instead
            # of a meaningless move-cap draw.
            term, result = "move_cap", "1/2-1/2"
            if (
                config.eval_moves
                and eval_engine is not None
                and config.adjudicate_cp > 0
            ):
                cp = eval_engine.evaluate(board)  # centipawns from side-to-move POV
                if cp >= config.adjudicate_cp:
                    term, result = (
                        "adjudication",
                        ("1-0" if board.turn == chess.WHITE else "0-1"),
                    )
                elif cp <= -config.adjudicate_cp:
                    term, result = (
                        "adjudication",
                        ("0-1" if board.turn == chess.WHITE else "1-0"),
                    )
            break

        mover = white if board.turn == chess.WHITE else black
        color_str = "white" if board.turn == chess.WHITE else "black"
        side = board.turn
        move, illegal, first_legal, attempts = _request_move(
            mover,
            board,
            condition,
            history_san,
            last_opp_san,
            prior_illegal=cumulative_illegal[side],
        )
        cumulative_illegal[side] += illegal

        if move is None:  # forfeit by illegal move
            result = "0-1" if board.turn == chess.WHITE else "1-0"
            records.append(
                MoveRecord(
                    board.ply(),
                    color_str,
                    None,
                    None,
                    first_legal,
                    illegal,
                    forfeited=True,
                    attempts=attempts,
                )
            )
            term = "illegal_forfeit"
            break

        san = board.san(move)
        board.push(move)
        eval_cp = None
        if config.eval_moves and eval_engine is not None:
            eval_cp = eval_engine.evaluate(board)
        records.append(
            MoveRecord(
                board.ply(),
                color_str,
                san,
                move.uci(),
                first_legal,
                illegal,
                eval_cp,
                attempts=attempts,
            )
        )
        history_san.append(san)
        last_opp_san = san
        if on_move is not None:
            on_move(board, records)

    white_name = getattr(white, "name", "white")
    black_name = getattr(black, "name", "black")
    return GameRecord(
        white=white_name,
        black=black_name,
        result=result,
        termination=term,
        plies=len(history_san),
        moves_san=history_san,
        records=records,
        pgn=_to_pgn(history_san, white_name, black_name, result, term, start_fen),
        start_fen=start_fen,
    )


def _to_pgn(moves_san, white, black, result, termination, start_fen) -> str:
    game = chess.pgn.Game()
    game.headers.update(
        {"White": white, "Black": black, "Result": result, "Termination": termination}
    )
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


def play_match(
    a,
    b,
    n_games: int,
    condition: Condition,
    config: GameConfig | None = None,
    *,
    eval_engine: Engine | None = None,
) -> MatchResult:
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
