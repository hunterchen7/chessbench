"""Versioned JSON Schema protocol, provider payload, logging, and isolation."""

from __future__ import annotations

import json
from dataclasses import replace

import chess
import pytest

from chessbench.agents import LLMAgent, LLMGameAgent
from chessbench.conditions import build_puzzle_prompt, mode_condition
from chessbench.core.board import parse_model_line_response, parse_model_move_response
from chessbench.database import RunSpec
from chessbench.models.base import (
    ScriptedModel,
    StructuredOutputUnsupported,
    chat_with_response_format,
)
from chessbench.models.openai_compat import OpenRouterModel
from chessbench.response_protocols import (
    ResponseProtocol,
    response_format,
    response_format_for,
)
from chessbench.tasks.composed import (
    ComposedProblem,
    LLMComposedSolver,
    build_composed_prompt,
    grade_composed,
)
from chessbench.tasks.games import GameConfig, play_game
from chessbench.tasks.puzzles import Puzzle, grade_puzzle
from chessbench.variants import ModelVariant


class CapturingOpenRouter(OpenRouterModel):
    def __init__(self) -> None:
        super().__init__("test/model", api_key="test-key")
        self.payloads: list[dict[str, object]] = []

    def _post(self, data: bytes, headers: dict[str, str]) -> str:
        self.payloads.append(json.loads(data))
        return json.dumps(
            {
                "choices": [
                    {
                        "message": {
                            "content": '{"move":"e2e4","rationale":"Controls the center."}'
                        },
                        "finish_reason": "stop",
                    }
                ],
                "usage": {"prompt_tokens": 3, "completion_tokens": 4},
            }
        )


def test_openrouter_payload_is_strict_fail_closed_and_has_no_tools():
    model = CapturingOpenRouter()
    contract = response_format("move")
    raw = model.chat_structured(
        [{"role": "user", "content": "Your move."}],
        response_format=contract,
        temperature=1.0,
        max_tokens=99,
    )
    assert parse_model_move_response(chess.Board(), raw).format_valid
    [payload] = model.payloads
    assert payload["response_format"] == contract
    assert payload["provider"] == {"require_parameters": True}
    assert payload["tool_choice"] == "none"
    assert "tools" not in payload and "plugins" not in payload
    schema = contract["json_schema"]
    assert isinstance(schema, dict)
    assert schema["name"] == "chess_move_response_v1"
    assert schema["strict"] is True


def test_unstructured_adapter_cannot_silently_run_a_schema_cell():
    class PlainModel:
        name = "plain"

        def __init__(self) -> None:
            self.calls = 0

        def chat(self, messages, *, temperature=0.0, max_tokens=2048):
            self.calls += 1
            return "{}"

        def generate(self, prompt, *, temperature=0.0, max_tokens=2048):
            self.calls += 1
            return "{}"

    model = PlainModel()
    with pytest.raises(StructuredOutputUnsupported, match="cannot enforce"):
        chat_with_response_format(
            model,
            [{"role": "user", "content": "move"}],
            response_format=response_format("move"),
            temperature=1.0,
            max_tokens=100,
        )
    assert model.calls == 0

    no_contract = response_format_for(
        ResponseProtocol.PROMPT_JSON_V1, "move", explain=True
    )
    raw, applied = chat_with_response_format(
        model,
        [{"role": "user", "content": "move"}],
        response_format=no_contract,
        temperature=1.0,
        max_tokens=100,
    )
    assert raw == "{}" and applied is None and model.calls == 1


def test_protocol_version_changes_condition_and_durable_run_identity():
    strict = mode_condition(2)
    prompt_only = replace(strict, response_protocol=ResponseProtocol.PROMPT_JSON_V1)
    variant = ModelVariant("m", "M", "openrouter", "test/m")
    strict_run = RunSpec("puzzle", variant, strict, 1, suite_hash="same")
    prompt_run = RunSpec("puzzle", variant, prompt_only, 1, suite_hash="same")
    assert strict.slug() != prompt_only.slug()
    assert strict.to_dict()["response_protocol"] == "json_schema_v1"
    assert prompt_only.to_dict()["response_protocol"] == "prompt_json_v1"
    assert strict_run.natural_key != prompt_run.natural_key


def test_prompts_forbid_san_and_fences_with_exact_uci_examples():
    move_prompt = build_puzzle_prompt(chess.Board(), mode_condition(2))
    line_prompt = build_puzzle_prompt(chess.Board(), mode_condition(4))
    composed_prompt = build_composed_prompt(
        ComposedProblem("c", chess.Board().fen(), "helpmate", 1),
        mode_condition(4),
    )
    for prompt in (move_prompt, line_prompt, composed_prompt):
        assert "lowercase UCI coordinate notation" in prompt
        assert "Do not use SAN" in prompt
        assert "Markdown code fence" in prompt
        assert "e2e4" in prompt and "e7e8q" in prompt


def test_move_and_line_parsers_keep_uci_contract_strict():
    board = chess.Board()
    move = parse_model_move_response(
        board, '{"move":"e2e4","rationale":"Controls the center."}'
    )
    assert move.format_valid and move.move == chess.Move.from_uci("e2e4")
    san = parse_model_move_response(
        board, '{"move":"e4","rationale":"Controls the center."}'
    )
    assert not san.format_valid and san.move == chess.Move.from_uci("e2e4")
    fenced = parse_model_move_response(
        board,
        '```json\n{"move":"e2e4","rationale":"Controls the center."}\n```',
    )
    assert not fenced.format_valid and fenced.move is not None

    line = parse_model_line_response(
        board,
        '{"moves":["e2e4","e7e5"],"rationale":"A legal sequence."}',
    )
    assert line.format_valid and [move.uci() for move in line.moves] == ["e2e4", "e7e5"]


def test_puzzle_full_line_composed_and_game_logs_record_applied_schema():
    move_puzzle = Puzzle(
        "move",
        "6k1/5ppp/8/8/8/7q/8/R5K1 b - - 0 1",
        ["h3h6", "a1a8"],
        1200,
    )
    move_agent = LLMAgent(
        ScriptedModel(lambda _messages: '{"move":"a1a8","rationale":"Back-rank mate."}')
    )
    move_result = grade_puzzle(move_agent, move_puzzle, mode_condition(2))
    move_format = move_result.turns[0]["response_format"]
    assert isinstance(move_format, dict)
    assert move_format["json_schema"]["name"] == "chess_move_response_v1"

    line_puzzle = Puzzle(
        "line",
        chess.STARTING_FEN,
        ["e2e4", "e7e5", "g1f3", "b8c6"],
        1500,
    )
    line_agent = LLMAgent(
        ScriptedModel(
            lambda _messages: (
                '{"moves":["e7e5","g1f3","b8c6"],"rationale":"The complete line."}'
            )
        )
    )
    line_result = grade_puzzle(line_agent, line_puzzle, mode_condition(4))
    line_format = line_result.turns[0]["response_format"]
    assert isinstance(line_format, dict)
    assert line_format["json_schema"]["name"] == "chess_line_response_v1"

    composed = ComposedProblem(
        "direct",
        "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1",
        "directmate",
        1,
    )
    composed_result = grade_composed(
        LLMComposedSolver(
            ScriptedModel(
                lambda _messages: '{"move":"a1a8","rationale":"Back-rank mate."}'
            )
        ),
        composed,
        mode_condition(3),
    )
    assert composed_result.turns[0]["response_format"] == response_format("move")

    white_moves = iter(["e2e4"])
    black_moves = iter(["e7e5"])
    white = LLMGameAgent(
        ScriptedModel(
            lambda _messages: json.dumps(
                {"move": next(white_moves), "rationale": "White private."}
            ),
            name="white",
        )
    )
    black = LLMGameAgent(
        ScriptedModel(
            lambda _messages: json.dumps(
                {"move": next(black_moves), "rationale": "Black private."}
            ),
            name="black",
        )
    )
    game = play_game(white, black, mode_condition(2), GameConfig(max_plies=2))
    assert len(game.records) == 2
    assert all(
        move.attempts[0].response_format == response_format("move")
        for move in game.records
    )
    assert all(move.attempts[0].prompt for move in game.records)
    assert all(move.attempts[0].raw_response for move in game.records)
