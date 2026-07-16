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
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field

import chess
import chess.pgn

from ..agents import Agent, GameTurnContext
from ..conditions import Condition, Legality
from ..core import board as board_utils, metrics
from ..core.engine import Engine
from ..usage import normalize_usage


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
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    uncached_prompt_tokens: int = 0
    cache_discount_usd: float = 0.0
    cache_policy: str = "provider_default"
    cache_session_id: str | None = None
    usage: dict[str, object] | None = None


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
    *,
    initial_attempts: list[MoveAttempt] | None = None,
    initial_illegal: int = 0,
    initial_first_legal: bool | None = None,
    on_illegal_attempt: Callable[[int, bool, list[MoveAttempt]], None] | None = None,
) -> tuple[chess.Move | None, int, bool, list[MoveAttempt]]:
    """Solicit one legal move under the condition's legality regime.

    Returns (move|None, illegal_attempts_this_turn, first_attempt_legal, attempts).
    A None move means the side forfeits (exhausted retries, or the fatal OTB
    penalty). `prior_illegal` is this side's cumulative illegal count so far (OTB).
    """
    illegal = initial_illegal
    first_legal = initial_first_legal
    attempts = list(initial_attempts or [])
    feedback: str | None = None
    if attempts and illegal:
        previous = attempts[-1].raw_response
        feedback = (
            f"Illegal move '{previous}' (OTB penalty {prior_illegal + illegal}/{cond.otb_illegal_limit}); "
            "retract and play a legal move."
            if cond.legality == Legality.OTB
            else f"'{previous}' is not a legal move"
        )
    raw: str | None = None
    otb = cond.legality == Legality.OTB
    max_tries = (
        None
        if otb
        else (cond.retry_attempts + 1 if cond.legality == Legality.RETRY else 1)
    )
    if otb and prior_illegal + illegal >= cond.otb_illegal_limit:
        return None, illegal, bool(first_legal), attempts

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
        metrics = normalize_usage(
            usage,
            cost_usd=ctx.last_cost,
            cache_discount_usd=ctx.last_cache_discount,
            cache_policy=ctx.last_cache_policy,
            cache_session_id=ctx.last_cache_session_id,
        )
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
                usage=dict(usage),
                **metrics.to_dict(),
            )
        )
        if first_legal is None:
            first_legal = mv is not None
        if mv is not None:
            return mv, illegal, bool(first_legal), attempts
        illegal += 1
        feedback = (
            f"Illegal move '{raw}' (OTB penalty {prior_illegal + illegal}/{cond.otb_illegal_limit}); "
            "retract and play a legal move."
            if otb
            else f"'{raw}' is not a legal move"
        )
        if on_illegal_attempt is not None:
            on_illegal_attempt(illegal, bool(first_legal), list(attempts))
        if otb and prior_illegal + illegal >= cond.otb_illegal_limit:
            return None, illegal, bool(first_legal), attempts  # fatal OTB penalty
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
    resume: GameRecord | None = None,
    on_move: Callable[[chess.Board, list[MoveRecord]], None] | None = None,
    cache_session_prefix: str | None = None,
) -> GameRecord:
    """Play or exactly resume one game, checkpointing every paid attempt.

    A running record may end with a partial ``MoveRecord`` (illegal attempts but
    no accepted move yet). Its board state, counters, retry feedback, and each
    player's private chat are reconstructed before another model call is made.
    """
    config = config or GameConfig()
    board = chess.Board(start_fen) if start_fen else chess.Board()
    history_san: list[str] = []
    records: list[MoveRecord] = [] if resume is None else list(resume.records)

    if resume is not None:
        if resume.start_fen != start_fen:
            raise ValueError("resume record start position does not match the game")
        for index, record in enumerate(records):
            expected_color = "white" if board.turn == chess.WHITE else "black"
            if record.color != expected_color:
                raise ValueError(f"resume record {index} has the wrong side to move")
            if record.uci is None:
                if index != len(records) - 1:
                    raise ValueError("only the final resume record may be incomplete")
                if record.san is not None:
                    raise ValueError("incomplete resume record cannot contain SAN")
                continue
            replay_move = chess.Move.from_uci(record.uci)
            if replay_move not in board.legal_moves:
                raise ValueError(f"resume record {index} contains an illegal move")
            san = board.san(replay_move)
            if record.san != san:
                raise ValueError(
                    f"resume record {index} SAN does not match its UCI move"
                )
            history_san.append(san)
            board.push(replay_move)

    def private_turns(color: str) -> list[tuple[str, str]]:
        return [
            (attempt.prompt, attempt.raw_response)
            for record in records
            if record.color == color
            for attempt in record.attempts
            if attempt.prompt is not None
        ]

    def private_system_prompt(color: str) -> str | None:
        return next(
            (
                attempt.system_prompt
                for record in records
                if record.color == color
                for attempt in record.attempts
                if attempt.system_prompt is not None
            ),
            None,
        )

    session_prefix = cache_session_prefix or f"cb:ephemeral:game:{uuid.uuid4().hex}"
    for agent, color, color_name in (
        (white, chess.WHITE, "white"),
        (black, chess.BLACK, "black"),
    ):
        start_session = getattr(agent, "start_game_session", None)
        if callable(start_session):
            start_session(f"{session_prefix}:{color_name}")
        restore = getattr(agent, "restore", None)
        if callable(restore):
            restore(
                color,
                private_turns(color_name),
                private_system_prompt(color_name),
            )
        else:
            reset = getattr(agent, "reset", None)
            if callable(reset):
                reset(color)

    cumulative_illegal: dict[bool, int] = {
        chess.WHITE: sum(
            record.illegal_attempts for record in records if record.color == "white"
        ),
        chess.BLACK: sum(
            record.illegal_attempts for record in records if record.color == "black"
        ),
    }  # for OTB penalties

    pending_index: int | None = None
    if records and records[-1].uci is None and not records[-1].forfeited:
        pending_index = len(records) - 1

    if records and records[-1].forfeited:
        term = "illegal_forfeit"
        result = "0-1" if records[-1].color == "white" else "1-0"
    else:
        term = result = ""

    while not term:
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
        existing = records[pending_index] if pending_index is not None else None
        initial_attempts = list(existing.attempts) if existing is not None else []
        initial_illegal = existing.illegal_attempts if existing is not None else 0
        prior_illegal = cumulative_illegal[side] - initial_illegal

        def checkpoint_illegal(
            illegal_count: int,
            first_legal: bool,
            attempts: list[MoveAttempt],
        ) -> None:
            nonlocal pending_index
            partial = MoveRecord(
                board.ply(),
                color_str,
                None,
                None,
                first_legal,
                illegal_count,
                forfeited=False,
                attempts=attempts,
            )
            if pending_index is None:
                records.append(partial)
                pending_index = len(records) - 1
            else:
                records[pending_index] = partial
            if on_move is not None:
                on_move(board, records)

        move, illegal, first_legal, attempts = _request_move(
            mover,
            board,
            condition,
            history_san,
            history_san[-1] if history_san else None,
            prior_illegal=prior_illegal,
            initial_attempts=initial_attempts,
            initial_illegal=initial_illegal,
            initial_first_legal=(
                existing.first_attempt_legal if existing is not None else None
            ),
            on_illegal_attempt=checkpoint_illegal,
        )
        cumulative_illegal[side] = prior_illegal + illegal

        if move is None:  # forfeit by illegal move
            result = "0-1" if board.turn == chess.WHITE else "1-0"
            forfeited = MoveRecord(
                board.ply(),
                color_str,
                None,
                None,
                first_legal,
                illegal,
                forfeited=True,
                attempts=attempts,
            )
            if pending_index is None:
                records.append(forfeited)
            else:
                records[pending_index] = forfeited
            if on_move is not None:
                on_move(board, records)
            term = "illegal_forfeit"
            break

        san = board.san(move)
        board.push(move)
        eval_cp = None
        if config.eval_moves and eval_engine is not None:
            eval_cp = eval_engine.evaluate(board)
        completed_move = MoveRecord(
            board.ply(),
            color_str,
            san,
            move.uci(),
            first_legal,
            illegal,
            eval_cp,
            attempts=attempts,
        )
        if pending_index is None:
            records.append(completed_move)
        else:
            records[pending_index] = completed_move
        pending_index = None
        history_san.append(san)
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
