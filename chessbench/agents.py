"""Agents turn a position into a *move string* (which may be illegal -- that is
deliberate, so legality can be measured).

The Agent boundary (position -> text move) is separate from the Model boundary
(prompt -> text). Baseline agents (random / first-legal / Stockfish) work
directly on the board and need no model, which lets the whole harness be
verified end-to-end with zero API cost. LLMAgent renders a prompt from the
active Condition, calls a Model, and extracts the move.
"""

from __future__ import annotations

import hashlib
import random
from copy import deepcopy
from dataclasses import dataclass, field
from typing import Protocol

import chess
import chess.engine

from . import conditions
from .conditions import Condition
from .core import board as board_utils
from .core.engine import Engine, EngineConfig
from .models import Model, ModelError, VisionModel
from .models.base import (
    chat_with_response_format,
    generate_with_response_format,
    image_with_response_format,
)
from .response_protocols import response_format_for
from .types import Message


@dataclass
class MoveContext:
    """Everything an agent might use to choose a move, across all tracks.

    A single context type keeps the `Agent` protocol uniform (puzzles, games, and
    studies all pass a `MoveContext`); track-specific fields simply default when
    unused (e.g. puzzles never set `last_opponent_move_san`).
    """

    condition: Condition
    history_san: list[str] = field(default_factory=list)
    history_uci: list[str] = field(default_factory=list)
    illegal_feedback: str | None = None
    last_opponent_move_san: str | None = None
    ply: int = 0
    last_system_prompt: str | None = None
    last_prompt: str | None = None
    last_raw_response: str | None = None
    last_explanation: str | None = None
    last_response_format_valid: bool | None = None
    last_response_format_error: str | None = None
    last_response_format: dict[str, object] | None = None
    last_usage: dict[str, object] | None = None
    last_cost: float = 0.0
    last_cache_discount: float = 0.0
    last_cache_policy: str = "provider_default"
    last_cache_session_id: str | None = None
    last_provider_response: dict[str, object] | None = None
    last_response_id: str | None = None
    last_response_model: str | None = None
    last_response_provider: str | None = None
    last_finish_reason: str | None = None
    last_native_finish_reason: str | None = None
    last_provider_error: object | None = None
    last_request_payload: dict[str, object] | None = None
    last_provider_response_raw: str | None = None
    last_http_status: int | None = None
    last_response_headers: dict[str, str] | None = None
    last_reasoning: str | None = None
    last_reasoning_details: list[dict[str, object]] | None = None


def _capture_model_audit(model: object, ctx: MoveContext) -> None:
    """Copy the last provider call's audit fields on success or failure."""
    usage = getattr(model, "last_usage", None)
    ctx.last_usage = dict(usage) if isinstance(usage, dict) else None
    ctx.last_cost = float(getattr(model, "last_cost", 0.0))
    ctx.last_cache_discount = float(getattr(model, "last_cache_discount", 0.0))
    ctx.last_cache_policy = str(getattr(model, "last_cache_policy", "provider_default"))
    session = getattr(model, "last_cache_session_id", None)
    ctx.last_cache_session_id = session if isinstance(session, str) else None
    response = getattr(model, "last_provider_response", None)
    ctx.last_provider_response = dict(response) if isinstance(response, dict) else None
    request = getattr(model, "last_request_payload", None)
    ctx.last_request_payload = dict(request) if isinstance(request, dict) else None
    raw_body = getattr(model, "last_provider_response_raw", None)
    ctx.last_provider_response_raw = raw_body if isinstance(raw_body, str) else None
    http_status = getattr(model, "last_http_status", None)
    ctx.last_http_status = http_status if isinstance(http_status, int) else None
    response_headers = getattr(model, "last_response_headers", None)
    ctx.last_response_headers = (
        dict(response_headers) if isinstance(response_headers, dict) else None
    )
    reasoning = getattr(model, "last_reasoning", None)
    ctx.last_reasoning = reasoning if isinstance(reasoning, str) else None
    reasoning_details = getattr(model, "last_reasoning_details", None)
    ctx.last_reasoning_details = (
        deepcopy(reasoning_details)
        if isinstance(reasoning_details, list)
        and all(isinstance(detail, dict) for detail in reasoning_details)
        else None
    )
    for ctx_name, model_name in (
        ("last_response_id", "last_response_id"),
        ("last_response_model", "last_response_model"),
        ("last_response_provider", "last_response_provider"),
        ("last_finish_reason", "last_finish_reason"),
        ("last_native_finish_reason", "last_native_finish_reason"),
    ):
        value = getattr(model, model_name, None)
        setattr(ctx, ctx_name, value if isinstance(value, str) else None)
    error = getattr(model, "last_provider_error", None)
    ctx.last_provider_error = dict(error) if isinstance(error, dict) else error


def _assistant_message_from_audit(
    content: str,
    reasoning: str | None,
    reasoning_details: list[dict[str, object]] | None,
) -> Message:
    """Build one assistant turn with provider-native reasoning continuity.

    Modern reasoning APIs require the structured block/signature to be returned
    exactly as received.  OpenRouter documents ``reasoning`` as the compatibility
    fallback when no structured ``reasoning_details`` are available.  Sending
    both can duplicate the same thought, so the structured representation wins.
    The readable text is still retained separately in the audit record.
    """
    message: Message = {"role": "assistant", "content": content}
    if reasoning_details and all(
        isinstance(detail, dict) for detail in reasoning_details
    ):
        message["reasoning_details"] = deepcopy(reasoning_details)
    elif isinstance(reasoning, str):
        message["reasoning"] = reasoning
    return message


def _assistant_message(model: object, content: str) -> Message:
    """Preserve native reasoning only inside this model's private chat."""
    reasoning = getattr(model, "last_reasoning", None)
    reasoning_details = getattr(model, "last_reasoning_details", None)
    return _assistant_message_from_audit(
        content,
        reasoning if isinstance(reasoning, str) else None,
        reasoning_details
        if isinstance(reasoning_details, list)
        and reasoning_details
        and all(isinstance(detail, dict) for detail in reasoning_details)
        else None,
    )


# Backwards-compatible names for the two tracks (both are the unified context).
TurnContext = MoveContext
GameTurnContext = MoveContext


class Agent(Protocol):
    name: str

    def choose(self, board: chess.Board, ctx: MoveContext) -> str:
        """Return a move string (SAN or UCI). May be illegal."""
        ...


class RandomAgent:
    """Uniform random *legal* move. Baseline floor; never illegal by construction."""

    name = "random"

    def __init__(self, seed: int | None = 0):
        self._rng = random.Random(seed)

    def choose(self, board: chess.Board, ctx: TurnContext) -> str:
        moves = list(board.legal_moves)
        return self._rng.choice(moves).uci()


class FirstLegalAgent:
    """Deterministic 'always legal, never smart' baseline for grading sanity checks."""

    name = "first_legal"

    def choose(self, board: chess.Board, ctx: TurnContext) -> str:
        return next(iter(board.legal_moves)).uci()


class StockfishAgent:
    """Strong oracle baseline. Used to confirm grading accepts correct solutions
    (a well-set-up puzzle track should show near-100% solve rate here)."""

    def __init__(
        self, engine: Engine | None = None, config: EngineConfig | None = None
    ):
        self._engine = engine
        self._own = engine is None
        self._config = config or EngineConfig(nodes=200_000)
        self.name = (
            f"stockfish@{self._config.nodes}n" if self._config.nodes else "stockfish"
        )

    def __enter__(self):
        if self._own:
            self._engine = Engine(self._config).__enter__()
        return self

    def __exit__(self, *exc):
        if self._own and self._engine is not None:
            self._engine.__exit__(*exc)
            self._engine = None

    def choose(self, board: chess.Board, ctx: TurnContext) -> str:
        assert self._engine is not None, "Use StockfishAgent as a context manager."
        try:
            return self._engine.best_move(board).uci()
        except chess.engine.EngineError:
            # Strength-limited Stockfish (UCI_Elo/Skill) can rarely emit an illegal
            # move; fall back to a legal one rather than crashing the run.
            return next(iter(board.legal_moves)).uci()


class LLMAgent:
    """Wraps a Model: renders the prompt from the Condition, extracts the move."""

    def __init__(
        self,
        model: Model,
        condition: Condition | None = None,
        *,
        cache_namespace: str | None = None,
    ):
        self._model = model
        self._condition = condition or conditions.HEADLINE
        self.name = model.name
        self._messages: list[Message] = []
        self._cache_namespace = cache_namespace or "ephemeral"
        self._system = conditions.PUZZLE_SYSTEM_PROMPT

    def reset_puzzle(self) -> None:
        self._messages = []

    def start_puzzle(self, puzzle_id: str) -> None:
        """Isolate provider routing/cache state for exactly one puzzle."""
        setter = getattr(self._model, "set_cache_session", None)
        if not callable(setter):
            return
        if (
            self._condition.cache_policy == conditions.CachePolicy.DISABLED
            or self._condition.context_mode == conditions.ContextMode.FRESH
            or self._condition.puzzle_protocol == conditions.PuzzleProtocol.FULL_LINE
        ):
            setter(None)
            return
        digest = hashlib.sha256(puzzle_id.encode()).hexdigest()[:16]
        setter(f"cb:{self._cache_namespace}:puzzle:{digest}")

    def puzzle_conversation(self) -> list[Message]:
        """Return a detached snapshot suitable for a durable puzzle checkpoint."""
        return deepcopy(self._messages)

    def restore_puzzle(self, messages: list[Message]) -> None:
        """Restore exactly one puzzle's chat without sharing mutable state."""
        self._messages = deepcopy(messages)

    def choose(self, board: chess.Board, ctx: TurnContext) -> str:
        cond = ctx.condition
        prompt = conditions.build_puzzle_prompt(
            board, cond, ctx.illegal_feedback, history_uci=ctx.history_uci
        )
        response_format = response_format_for(
            cond.response_protocol, "move", explain=cond.explain
        )
        ctx.last_prompt = prompt
        ctx.last_response_format = response_format
        if cond.context_mode == conditions.ContextMode.FRESH:
            try:
                raw, applied_format = generate_with_response_format(
                    self._model,
                    prompt,
                    response_format=response_format,
                    temperature=cond.temperature,
                    max_tokens=cond.max_output_tokens,
                )
            except ModelError:
                _capture_model_audit(self._model, ctx)
                raise
        else:
            if not self._messages:
                self._messages.append({"role": "system", "content": self._system})
                ctx.last_system_prompt = self._system
            self._messages.append({"role": "user", "content": prompt})
            try:
                raw, applied_format = chat_with_response_format(
                    self._model,
                    self._messages,
                    response_format=response_format,
                    temperature=cond.temperature,
                    max_tokens=cond.max_output_tokens,
                )
            except ModelError:
                _capture_model_audit(self._model, ctx)
                # A failed request is an audited provider attempt, but it is not
                # part of the model's chess conversation. Resume from the same
                # prompt instead of leaving a dangling user turn behind.
                self._messages.pop()
                raise
            self._messages.append(_assistant_message(self._model, raw))
        ctx.last_raw_response = raw
        ctx.last_response_format = applied_format
        _capture_model_audit(self._model, ctx)
        # Extract a legal move if we can; else return the raw text so the grader
        # records an illegal/unparseable attempt (never silently repaired).
        parsed = board_utils.parse_model_move_response(board, raw)
        ctx.last_explanation = parsed.rationale
        if cond.explain:
            ctx.last_response_format_valid = parsed.format_valid
            ctx.last_response_format_error = parsed.format_error
        if parsed.move is not None:
            return parsed.move.uci()  # commit to the extracted move as canonical UCI
        return raw.strip().split("\n")[0][:40]

    def solve_line(self, board: chess.Board, ctx: TurnContext) -> str:
        """Answer a tactical puzzle in one request with the full variation."""
        cond = ctx.condition
        self.reset_puzzle()
        prompt = conditions.build_puzzle_prompt(board, cond, ctx.illegal_feedback)
        response_format = response_format_for(
            cond.response_protocol, "line", explain=cond.explain
        )
        ctx.last_prompt = prompt
        ctx.last_response_format = response_format
        try:
            raw, applied_format = generate_with_response_format(
                self._model,
                prompt,
                response_format=response_format,
                temperature=cond.temperature,
                max_tokens=cond.max_output_tokens,
            )
        except ModelError:
            _capture_model_audit(self._model, ctx)
            raise
        ctx.last_raw_response = raw
        ctx.last_response_format = applied_format
        _capture_model_audit(self._model, ctx)
        parsed = board_utils.parse_model_line_response(board, raw)
        ctx.last_explanation = parsed.rationale
        if cond.explain:
            ctx.last_response_format_valid = parsed.format_valid
            ctx.last_response_format_error = parsed.format_error
        return raw


class VisionAgent:
    """Multimodal puzzle agent: shows the model a BOARD IMAGE (not FEN/text) and
    asks for the move. The board's position is conveyed only by the picture."""

    def __init__(self, model: VisionModel, condition: Condition | None = None):
        self._model = model
        self._condition = condition or conditions.HEADLINE
        self.name = f"{model.name}(vision)"

    def choose(self, board: chess.Board, ctx: MoveContext) -> str:
        from .imaging import render_board_png

        cond = ctx.condition
        side = "White" if board.turn == chess.WHITE else "Black"
        lines = [
            f"This image shows a chess position. {side} is to move. Find the best move."
        ]
        if cond.legality == conditions.Legality.LEGAL_LIST:
            lines.append(conditions._legal_line(board, cond))
        if cond.explain:
            lines.append(conditions._json_move_instruction())
        else:
            lines.append(
                f"Reply with ONLY the move in {conditions._notation_name(cond)}."
            )
        if ctx.illegal_feedback:
            lines.append(f"Your previous answer was illegal: {ctx.illegal_feedback}.")

        response_format = response_format_for(
            cond.response_protocol, "move", explain=cond.explain
        )
        ctx.last_prompt = "\n".join(lines)
        ctx.last_response_format = response_format
        raw, applied_format = image_with_response_format(
            self._model,
            ctx.last_prompt,
            render_board_png(board),
            response_format=response_format,
            temperature=cond.temperature,
            max_tokens=cond.max_output_tokens,
        )
        ctx.last_raw_response = raw
        ctx.last_response_format = applied_format
        _capture_model_audit(self._model, ctx)
        parsed = board_utils.parse_model_move_response(board, raw)
        ctx.last_explanation = parsed.rationale
        if cond.explain:
            ctx.last_response_format_valid = parsed.format_valid
            ctx.last_response_format_error = parsed.format_error
        if parsed.move is not None:
            return parsed.move.uci()  # commit to the extracted move as canonical UCI
        return raw.strip().split("\n")[0][:40]


class LLMGameAgent:
    """LLM agent for full-game play. Owns per-game conversation state so it can
    realize the FRESH / GROWING / HYBRID context modes (see conditions.ContextMode).
    Call `reset(color)` at the start of each game."""

    def __init__(self, model: Model, condition: Condition | None = None):
        self._model = model
        self._condition = condition or conditions.HEADLINE
        self.name = model.name
        self._messages: list[Message] = []
        self._system: str = ""
        self._started = False

    def start_game_session(self, session_id: str) -> None:
        """Pin one player's private chat without sharing either side's state."""
        setter = getattr(self._model, "set_cache_session", None)
        if not callable(setter):
            return
        if (
            self._condition.cache_policy == conditions.CachePolicy.DISABLED
            or self._condition.context_mode == conditions.ContextMode.FRESH
        ):
            setter(None)
        else:
            setter(session_id)

    def reset(self, color: bool) -> None:
        self._messages = []
        self._system = conditions.game_system_prompt(self._condition, color)
        self._started = False

    def restore(
        self,
        color: bool,
        turns: list[tuple[str, str, str | None, list[dict[str, object]] | None]],
        system_prompt: str | None = None,
    ) -> None:
        """Restore only this player's private messages for an interrupted game.

        ``turns`` is pre-filtered by color by the game runner. Opponent prompts
        and responses are never accepted here, so resumption cannot leak one
        model's rationale or raw output into the other model's context.
        """
        self.reset(color)
        if system_prompt is not None:
            self._system = system_prompt
        if not turns:
            return
        if self._condition.context_mode != conditions.ContextMode.FRESH:
            self._messages.append({"role": "system", "content": self._system})
            for prompt, raw_response, reasoning, reasoning_details in turns:
                self._messages.append({"role": "user", "content": prompt})
                self._messages.append(
                    _assistant_message_from_audit(
                        raw_response, reasoning, reasoning_details
                    )
                )
        self._started = True

    def choose(self, board: chess.Board, ctx: MoveContext) -> str:
        cond = ctx.condition
        is_first = not self._started
        user = conditions.build_game_turn(
            board,
            cond,
            history_san=ctx.history_san,
            last_opponent_move_san=ctx.last_opponent_move_san,
            illegal_feedback=ctx.illegal_feedback,
            is_first=is_first,
        )
        system_msg: Message = {"role": "system", "content": self._system}
        user_msg: Message = {"role": "user", "content": user}
        response_format = response_format_for(
            cond.response_protocol, "move", explain=cond.explain
        )
        if is_first:
            ctx.last_system_prompt = self._system
        ctx.last_prompt = user
        ctx.last_response_format = response_format
        if cond.context_mode == conditions.ContextMode.FRESH:
            try:
                raw, applied_format = chat_with_response_format(
                    self._model,
                    [system_msg, user_msg],
                    response_format=response_format,
                    temperature=cond.temperature,
                    max_tokens=cond.max_output_tokens,
                )
            except ModelError:
                _capture_model_audit(self._model, ctx)
                raise
        else:  # GROWING / HYBRID: persist the conversation across turns
            if not self._messages:
                self._messages.append(system_msg)
            self._messages.append(user_msg)
            try:
                raw, applied_format = chat_with_response_format(
                    self._model,
                    self._messages,
                    response_format=response_format,
                    temperature=cond.temperature,
                    max_tokens=cond.max_output_tokens,
                )
            except ModelError:
                _capture_model_audit(self._model, ctx)
                self._messages.pop()
                raise
            self._messages.append(_assistant_message(self._model, raw))
        self._started = True

        ctx.last_raw_response = raw
        ctx.last_response_format = applied_format
        _capture_model_audit(self._model, ctx)
        parsed = board_utils.parse_model_move_response(board, raw)
        ctx.last_explanation = parsed.rationale
        if cond.explain:
            ctx.last_response_format_valid = parsed.format_valid
            ctx.last_response_format_error = parsed.format_error
        if parsed.move is not None:
            return parsed.move.uci()  # commit to the extracted move as canonical UCI
        return raw.strip().split("\n")[0][:40]
