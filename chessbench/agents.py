"""Agents turn a position into a *move string* (which may be illegal -- that is
deliberate, so legality can be measured).

The Agent boundary (position -> text move) is separate from the Model boundary
(prompt -> text). Baseline agents (random / first-legal / Stockfish) work
directly on the board and need no model, which lets the whole harness be
verified end-to-end with zero API cost. LLMAgent renders a prompt from the
active Condition, calls a Model, and extracts the move.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Protocol

import chess

from . import conditions
from .conditions import Condition
from .core import board as board_utils
from .core.engine import Engine, EngineConfig
from .models import Model
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
    illegal_feedback: str | None = None
    last_opponent_move_san: str | None = None
    ply: int = 0
    last_prompt: str | None = None
    last_raw_response: str | None = None
    last_explanation: str | None = None


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

    def __init__(self, engine: Engine | None = None, config: EngineConfig | None = None):
        self._engine = engine
        self._own = engine is None
        self._config = config or EngineConfig(nodes=200_000)
        self.name = f"stockfish@{self._config.nodes}n" if self._config.nodes else "stockfish"

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
        return self._engine.best_move(board).uci()


class LLMAgent:
    """Wraps a Model: renders the prompt from the Condition, extracts the move."""

    def __init__(self, model: Model, condition: Condition | None = None):
        self._model = model
        self._condition = condition or conditions.HEADLINE
        self.name = model.name

    def choose(self, board: chess.Board, ctx: TurnContext) -> str:
        cond = ctx.condition
        prompt = conditions.build_puzzle_prompt(board, cond, ctx.illegal_feedback)
        raw = self._model.generate(prompt, temperature=cond.temperature)
        ctx.last_prompt = prompt
        ctx.last_raw_response = raw
        # Extract a legal move if we can; else return the raw text so the grader
        # records an illegal/unparseable attempt (never silently repaired).
        move, token, explanation = board_utils.extract_move_and_explanation(board, raw)
        ctx.last_explanation = explanation
        if move is not None:
            return token or move.uci()
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

    def reset(self, color: bool) -> None:
        self._messages = []
        self._system = conditions.game_system_prompt(self._condition, color)
        self._started = False

    def choose(self, board: chess.Board, ctx: MoveContext) -> str:
        cond = ctx.condition
        is_first = not self._started
        user = conditions.build_game_turn(
            board, cond,
            history_san=ctx.history_san,
            last_opponent_move_san=ctx.last_opponent_move_san,
            illegal_feedback=ctx.illegal_feedback,
            is_first=is_first,
        )
        system_msg: Message = {"role": "system", "content": self._system}
        user_msg: Message = {"role": "user", "content": user}
        if cond.context_mode == conditions.ContextMode.FRESH:
            raw = self._model.chat([system_msg, user_msg], temperature=cond.temperature)
        else:  # GROWING / HYBRID: persist the conversation across turns
            if not self._messages:
                self._messages.append(system_msg)
            self._messages.append(user_msg)
            raw = self._model.chat(self._messages, temperature=cond.temperature)
            self._messages.append({"role": "assistant", "content": raw})
        self._started = True

        ctx.last_raw_response = raw
        move, token, explanation = board_utils.extract_move_and_explanation(board, raw)
        ctx.last_explanation = explanation
        if move is not None:
            return token or move.uci()
        return raw.strip().split("\n")[0][:40]
