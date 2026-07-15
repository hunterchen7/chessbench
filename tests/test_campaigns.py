from __future__ import annotations

from collections import Counter

import io
import json

import pytest

from chessbench.campaigns import (
    PUBLIC_MODELS,
    openrouter_credit_remaining,
    public_low_reasoning_campaign,
)


def test_public_campaign_is_complete_and_unique() -> None:
    cells = public_low_reasoning_campaign()

    assert len(cells) == 20
    assert len({cell.key for cell in cells}) == len(cells)
    assert sum(cell.item_count for cell in cells) == 4300
    assert Counter(cell.track for cell in cells) == {
        "standard": 12,
        "woodpecker": 4,
        "esoteric": 4,
    }
    assert Counter(cell.model_label for cell in cells) == {
        model: 10 for model in PUBLIC_MODELS
    }


def test_public_campaign_pins_protocol_and_response_style() -> None:
    cells = public_low_reasoning_campaign()

    for cell in cells:
        command = cell.command(python="python")
        assert "--reasoning" in command
        assert command[command.index("--reasoning") + 1] == "low"
        assert "--max-output-tokens" in command
        assert command[command.index("--max-output-tokens") + 1] == "8192"
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
            for mode in (1, 2, 3)
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
