from __future__ import annotations

from collections import Counter

import io
import json

import pytest

from chessbench.campaigns import (
    PUBLIC_MODELS,
    openrouter_credit_remaining,
    public_low_reasoning_game_campaign,
    public_low_reasoning_campaign,
)


def test_public_campaign_is_complete_and_unique() -> None:
    cells = public_low_reasoning_campaign()

    assert len(cells) == 24
    assert len({cell.key for cell in cells}) == len(cells)
    assert sum(cell.item_count for cell in cells) == 5940
    assert Counter(cell.track for cell in cells) == {
        "standard": 16,
        "woodpecker": 4,
        "esoteric": 4,
    }
    assert Counter(cell.model_label for cell in cells) == {
        model: 12 for model in PUBLIC_MODELS
    }


def test_public_campaign_pins_protocol_and_response_style() -> None:
    cells = public_low_reasoning_campaign()

    for cell in cells:
        command = cell.command(python="python")
        assert "--reasoning" in command
        assert command[command.index("--reasoning") + 1] == "low"
        assert "--provider-output-limit" in command
        assert "--max-output-tokens" not in command
        assert "--response-protocol" in command
        assert command[command.index("--response-protocol") + 1] == "prompt_json_v1"
        assert ("--move-only" in command) != ("--rationale" in command)

    standard = [cell for cell in cells if cell.track == "standard"]
    for model in PUBLIC_MODELS:
        assert {
            (cell.mode, cell.response_style)
            for cell in standard
            if cell.model_label == model
        } == {
            (mode, style)
            for mode in (1, 2, 3, 5)
            for style in ("move_only", "json_rationale")
        }


def test_esoteric_campaign_uses_registry_identity_and_distinct_exports() -> None:
    cells = [
        cell for cell in public_low_reasoning_campaign() if cell.track == "esoteric"
    ]
    outputs: set[str] = set()

    for cell in cells:
        command = cell.command(python="python")
        assert command[3] == "composed"
        assert command[command.index("--solver") + 1] == "openrouter"
        assert command[command.index("--model") + 1] == cell.model_label
        output = command[command.index("--save-run") + 1]
        outputs.add(output)
        assert cell.response_style.replace("_", "-") in output

    assert len(outputs) == len(cells)


def test_public_game_campaign_crosses_modes_styles_and_colors() -> None:
    cells = public_low_reasoning_game_campaign()
    assert len(cells) == 8
    assert sum(cell.games_per_pair for cell in cells) == 16
    assert {(cell.mode, cell.response_style) for cell in cells} == {
        (mode, style)
        for mode in (1, 2, 3, 5)
        for style in ("move_only", "json_rationale")
    }

    for cell in cells:
        command = cell.command(python="python", publish=True)
        models = command[command.index("--models") + 1].split(",")
        assert models == ["openai/gpt-5.6-luna", "anthropic/claude-haiku-4.5"]
        assert command[command.index("--games") + 1] == "2"
        assert command[command.index("--openings") + 1] == "none"
        assert command[command.index("--context-mode") + 1] == "hybrid"
        assert "--stream" in command and "--tid" in command
        assert ("--move-only" in command) != ("--rationale" in command)

    rationale = next(
        cell
        for cell in cells
        if cell.mode == 1 and cell.response_style == "json_rationale"
    )
    assert rationale.output_stem() == (
        "luna-vs-haiku--mode-1--r-low--o-provider--prompt-json-v1"
    )


def test_openrouter_credit_preflight_parses_limited_and_unlimited_keys(monkeypatch) -> None:
    class Response(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            self.close()

    responses = iter(
        [
            {"data": {"limit_remaining": 12.5}},
            {"data": {"limit_remaining": None}},
        ]
    )

    def fake_open(_request, *, timeout):
        assert timeout == 15.0
        return Response(json.dumps(next(responses)).encode())

    monkeypatch.setattr("urllib.request.urlopen", fake_open)
    assert openrouter_credit_remaining("secret") == 12.5
    assert openrouter_credit_remaining("secret") is None


def test_openrouter_credit_preflight_fails_closed_on_bad_shape(monkeypatch) -> None:
    class Response(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            self.close()

    monkeypatch.setattr(
        "urllib.request.urlopen",
        lambda *_args, **_kwargs: Response(b'{"data":{}}'),
    )
    with pytest.raises(RuntimeError, match="limit_remaining"):
        openrouter_credit_remaining("secret")
