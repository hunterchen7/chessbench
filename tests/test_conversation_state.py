"""Conversation state is scoped to exactly one puzzle."""

import json
from dataclasses import replace

import chess

from chessbench.agents import LLMAgent, LLMGameAgent, TurnContext
from chessbench.conditions import ContextMode, mode_condition
from chessbench.models.base import ScriptedModel
from chessbench.tasks.games import GameConfig, play_game
from chessbench.tasks.puzzles import Puzzle, grade_puzzle


class ReasoningScriptedModel(ScriptedModel):
    def __init__(self, moves: list[str], prefix: str):
        self.moves = moves
        self.prefix = prefix
        self.calls: list[list[dict[str, object]]] = []
        self.last_reasoning: str | None = None
        self.last_reasoning_details: list[dict[str, object]] | None = None
        super().__init__(self._respond, name=prefix)

    def _respond(self, messages):
        self.calls.append([dict(message) for message in messages])
        index = len(self.calls) - 1
        self.last_reasoning = f"{self.prefix}-REASON-{index + 1}"
        self.last_reasoning_details = [
            {
                "type": "reasoning.text",
                "text": self.last_reasoning,
                "signature": f"{self.prefix}-signature-{index + 1}",
            }
        ]
        return self.moves[index]


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


def test_puzzle_reasoning_is_stored_and_preserved_only_within_that_puzzle():
    puzzle = Puzzle(
        id="reasoning-puzzle",
        fen=chess.STARTING_FEN,
        moves=["e2e4", "e7e5", "g1f3", "b8c6"],
        rating=1500,
    )
    model = ReasoningScriptedModel(["e7e5", "b8c6"], "PUZZLE")
    agent = LLMAgent(model)

    result = grade_puzzle(agent, puzzle, mode_condition(2))

    assert result.solved
    assert result.turns[0]["reasoning"] == "PUZZLE-REASON-1"
    assert result.turns[0]["reasoning_details"] == [
        {
            "type": "reasoning.text",
            "text": "PUZZLE-REASON-1",
            "signature": "PUZZLE-signature-1",
        }
    ]
    assert model.calls[1][2]["role"] == "assistant"
    assert model.calls[1][2]["reasoning"] == "PUZZLE-REASON-1"
    assert (
        model.calls[1][2]["reasoning_details"] == result.turns[0]["reasoning_details"]
    )

    agent.reset_puzzle()
    assert agent.puzzle_conversation() == []


def test_game_restore_keeps_reasoning_in_one_players_private_chat():
    condition = mode_condition(2)
    white_model = ReasoningScriptedModel(["e2e4"], "WHITE")
    white = LLMGameAgent(white_model, condition)
    white.restore(
        chess.WHITE,
        [
            (
                "old white prompt",
                "g1f3",
                "WHITE-OLD-REASON",
                [{"type": "reasoning.text", "text": "WHITE-OLD-REASON"}],
            )
        ],
        "You are playing White.",
    )

    white.choose(chess.Board(), TurnContext(condition=condition))

    request = white_model.calls[0]
    assert request[2]["reasoning"] == "WHITE-OLD-REASON"
    assert "BLACK" not in json.dumps(request)


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
