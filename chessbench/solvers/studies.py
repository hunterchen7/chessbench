"""Endgame studies: adjudicate "White to play and win/draw" vs best defense.

A study has no single "correct line" -- the task is to *achieve* the stipulated
result against the opponent's best defense. So we play the solver's moves against
a strong engine defender and adjudicate by outcome and centipawn evaluation, per
the research recommendation (engine-in-the-loop, not exact-line matching).

This is the one composed genre that needs an engine at grading time.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import chess

from ..agents import Agent, GameTurnContext
from ..conditions import Condition, Legality
from ..core import board as board_utils
from ..core.engine import Engine
from ..types import StudyGoal


@dataclass
class StudyConfig:
    max_moves: int = 40  # solver moves before adjudication
    draw_low_cp: int = (
        -100
    )  # eval floor (solver POV) that still counts as holding a draw


@dataclass
class StudyResult:
    solved: bool
    outcome: str  # "checkmate_win" | "eval_win" | "held_draw" | "lost" | "illegal"
    final_eval_cp: int
    moves_played: int
    first_move_legal: bool
    illegal_attempts: int
    moves_san: list[str] = field(default_factory=list)
    turns: list[dict[str, object]] = field(default_factory=list)


def grade_study(
    agent: Agent,
    fen: str,
    goal: StudyGoal,
    engine: Engine,
    condition: Condition,
    config: StudyConfig | None = None,
) -> StudyResult:
    """Play the solver's moves vs an engine defender and adjudicate the result."""
    config = config or StudyConfig()
    board = chess.Board(fen)
    solver = board.turn
    reset = getattr(agent, "reset", None)
    if callable(reset):
        reset(solver)  # LLM game agents initialise per-game conversation state here

    history_san: list[str] = []
    turns: list[dict[str, object]] = []
    illegal_attempts = 0
    first_move_legal: bool | None = None

    def evaluate_pov() -> int:
        cp = engine.evaluate(board)
        return cp if board.turn == solver else -cp

    for _ in range(config.max_moves):
        if board.is_game_over():
            break

        max_tries = (
            condition.retry_attempts + 1 if condition.legality == Legality.RETRY else 1
        )
        chosen: chess.Move | None = None
        feedback: str | None = None
        for _try in range(max_tries):
            ctx = GameTurnContext(
                condition=condition,
                history_san=list(history_san),
                illegal_feedback=feedback,
            )
            raw = agent.choose(board, ctx)
            move = board_utils.parse_move(board, raw)
            usage = ctx.last_usage or {}
            details = usage.get("completion_tokens_details")
            reasoning_value = (
                details.get("reasoning_tokens", 0) if isinstance(details, dict) else 0
            )
            turns.append(
                {
                    "system_prompt": ctx.last_system_prompt,
                    "prompt": ctx.last_prompt,
                    "raw_response": ctx.last_raw_response or raw,
                    "parsed_move": move.uci() if move is not None else None,
                    "legal": move is not None,
                    "rationale": ctx.last_explanation,
                    "response_format_valid": ctx.last_response_format_valid,
                    "response_format_error": ctx.last_response_format_error,
                    "response_format": ctx.last_response_format,
                    "usage": dict(usage),
                    "reasoning_tokens": int(reasoning_value)
                    if isinstance(reasoning_value, (int, float, str))
                    else 0,
                    "cost_usd": ctx.last_cost,
                }
            )
            if first_move_legal is None:
                first_move_legal = move is not None
            if move is not None:
                chosen = move
                break
            illegal_attempts += 1
            feedback = f"'{raw}' is not a legal move"

        if chosen is None:
            return StudyResult(
                False,
                "illegal",
                evaluate_pov(),
                len(history_san),
                bool(first_move_legal),
                illegal_attempts,
                list(history_san),
                turns,
            )

        history_san.append(board.san(chosen))
        board.push(chosen)
        if board.is_checkmate():  # solver mated the defender
            return StudyResult(
                goal == "win",
                "checkmate_win",
                10_000,
                len(history_san),
                bool(first_move_legal),
                illegal_attempts,
                list(history_san),
                turns,
            )
        if board.is_game_over():
            break

        defender = engine.best_move(board)  # best defense
        history_san.append(board.san(defender))
        board.push(defender)
        if board.is_checkmate():  # defender mated the solver
            return StudyResult(
                False,
                "lost",
                -10_000,
                len(history_san),
                bool(first_move_legal),
                illegal_attempts,
                list(history_san),
                turns,
            )

    final = evaluate_pov()
    if goal == "win":
        # A win must be CONVERTED to checkmate within the budget (handled above);
        # reaching the move cap with only a winning eval is not "achieving the win".
        return StudyResult(
            False,
            "unconverted",
            final,
            len(history_san),
            bool(first_move_legal),
            illegal_attempts,
            list(history_san),
            turns,
        )
    solved = final >= config.draw_low_cp
    return StudyResult(
        solved,
        "held_draw" if solved else "lost",
        final,
        len(history_san),
        bool(first_move_legal),
        illegal_attempts,
        list(history_san),
        turns,
    )
