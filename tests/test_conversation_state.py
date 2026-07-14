"""Conversation state is scoped to exactly one puzzle."""

from dataclasses import replace

import chess

from chessbench.agents import LLMAgent, TurnContext
from chessbench.conditions import ContextMode, mode_condition
from chessbench.models.base import ScriptedModel


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
