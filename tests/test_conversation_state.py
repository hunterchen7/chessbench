"""Conversation state is scoped to exactly one puzzle."""

import json
from dataclasses import replace

import chess

from chessbench.agents import LLMAgent, LLMGameAgent, TurnContext
from chessbench.conditions import ContextMode, mode_condition
from chessbench.models.base import ScriptedModel
from chessbench.tasks.games import GameConfig, play_game


def test_hybrid_keeps_state_within_a_puzzle_then_resets():
    calls: list[list[dict[str, str]]] = []

    def respond(messages):
        calls.append([dict(message) for message in messages])
        return "e4" if len(calls) != 2 else "Nf3"

    agent = LLMAgent(ScriptedModel(respond))
    condition = mode_condition(2)
    board = chess.Board()
    first = TurnContext(condition=condition)
    agent.choose(board, first)
    board.push_san("e4")
    board.push_san("e5")
    second = TurnContext(condition=condition, history_san=["e4", "e5"])
    agent.choose(board, second)

    assert [len(call) for call in calls] == [2, 4]
    assert calls[1][0]["role"] == "system"
    assert first.last_system_prompt and second.last_system_prompt is None

    agent.reset_puzzle()
    third = TurnContext(condition=condition)
    agent.choose(chess.Board(), third)
    assert len(calls[2]) == 2
    assert third.last_system_prompt


def test_fresh_puzzle_context_never_accumulates_messages():
    calls: list[list[dict[str, str]]] = []

    def respond(messages):
        calls.append([dict(message) for message in messages])
        return "e4"

    agent = LLMAgent(ScriptedModel(respond))
    condition = mode_condition(2)
    condition = replace(condition, context_mode=ContextMode.FRESH)
    agent.choose(chess.Board(), TurnContext(condition=condition))
    agent.choose(chess.Board(), TurnContext(condition=condition))
    assert [len(call) for call in calls] == [1, 1]


def test_game_players_have_strictly_separate_conversations_but_audit_keeps_both():
    white_calls: list[list[dict[str, str]]] = []
    black_calls: list[list[dict[str, str]]] = []

    def responder(moves: list[str], secret: str, calls: list[list[dict[str, str]]]):
        def respond(messages):
            calls.append([dict(message) for message in messages])
            move = moves[len(calls) - 1]
            return json.dumps({"move": move, "rationale": secret})

        return respond

    condition = mode_condition(3)
    white = LLMGameAgent(
        ScriptedModel(
            responder(["e2e4", "g1f3"], "WHITE-PRIVATE", white_calls),
            name="white-model",
        ),
        condition,
    )
    black = LLMGameAgent(
        ScriptedModel(
            responder(["e7e5", "b8c6"], "BLACK-PRIVATE", black_calls),
            name="black-model",
        ),
        condition,
    )

    game = play_game(white, black, condition, GameConfig(max_plies=4))

    assert len(white_calls) == len(black_calls) == 2
    assert all("BLACK-PRIVATE" not in json.dumps(call) for call in white_calls)
    assert all("WHITE-PRIVATE" not in json.dumps(call) for call in black_calls)
    white_audit = [
        attempt.raw_response
        for move in game.records
        if move.color == "white"
        for attempt in move.attempts
    ]
    black_audit = [
        attempt.raw_response
        for move in game.records
        if move.color == "black"
        for attempt in move.attempts
    ]
    assert white_audit and all("WHITE-PRIVATE" in raw for raw in white_audit)
    assert black_audit and all("BLACK-PRIVATE" in raw for raw in black_audit)
