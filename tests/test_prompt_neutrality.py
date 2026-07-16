"""Evaluated models are never told that the chess task is a benchmark."""

import chess

from chessbench.conditions import build_game_turn, build_puzzle_prompt, game_system_prompt, mode_condition
from chessbench.tasks.composed import ComposedProblem, build_composed_prompt

FORBIDDEN = ("benchmark", "evaluation", "experiment", "leaderboard", "scored attempt", "your score")


def assert_neutral(*texts: str) -> None:
    joined = "\n".join(texts).lower()
    assert not any(term in joined for term in FORBIDDEN)


def test_every_model_facing_prompt_is_neutral():
    board = chess.Board()
    puzzle_prompts = [
        build_puzzle_prompt(board, mode_condition(mode)) for mode in (1, 2, 3, 4, 5)
    ]
    condition = mode_condition(2)
    game = [
        game_system_prompt(condition, chess.WHITE),
        build_game_turn(
            board,
            condition,
            history_san=[],
            last_opponent_move_san=None,
            illegal_feedback=None,
            is_first=True,
        ),
    ]
    composed = build_composed_prompt(
        ComposedProblem("neutral", board.fen(), "directmate", 1),
        condition,
    )
    assert_neutral(*puzzle_prompts, *game, composed)
    assert all("you are solving a chess puzzle" in prompt.lower() for prompt in puzzle_prompts)
    assert "you are playing a chess game as white" in game[0].lower()
