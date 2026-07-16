"""Provider retry policy preserves one auditable attempt per ambiguous call."""

from __future__ import annotations

import io
import json
import urllib.error

import pytest

from chessbench.models.openai_compat import ModelError, OpenAIModel, OpenRouterModel


class _Response:
    def __init__(
        self,
        payload: dict[str, object],
        *,
        status: int = 200,
        headers: dict[str, str] | None = None,
    ) -> None:
        self._body = json.dumps(payload).encode()
        self.status = status
        self.headers = headers or {}

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return None

    def read(self) -> bytes:
        return self._body


class _HeartbeatResponse:
    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return None

    def read1(self, _size: int) -> bytes:
        return b" "


def _http_error(code: int, *, retry_after: str | None = None):
    headers = {"Retry-After": retry_after} if retry_after is not None else {}
    return urllib.error.HTTPError(
        "https://openrouter.ai/api/v1/chat/completions",
        code,
        "failure",
        headers,
        io.BytesIO(b'{"error":"failure"}'),
    )


def test_transport_failure_is_not_retried(monkeypatch):
    calls = 0

    def fail(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        raise urllib.error.URLError("connection reset")

    monkeypatch.setattr("urllib.request.urlopen", fail)
    model = OpenRouterModel("test/model", api_key="test")

    with pytest.raises(ModelError, match="outcome may be ambiguous"):
        model.chat([{"role": "user", "content": "move"}])
    assert calls == 1


def test_chunked_heartbeats_cannot_extend_total_response_deadline(monkeypatch):
    calls = 0
    clock = iter([0.0, 0.4, 1.1])

    def respond(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        return _HeartbeatResponse()

    monkeypatch.setattr("urllib.request.urlopen", respond)
    monkeypatch.setattr("time.monotonic", lambda: next(clock))
    model = OpenRouterModel("test/model", api_key="test", timeout=1.0)

    with pytest.raises(ModelError, match="total response deadline exceeded"):
        model.chat([{"role": "user", "content": "move"}])
    assert calls == 1


def test_ambiguous_502_is_not_retried(monkeypatch):
    calls = 0

    def fail(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        raise _http_error(502)

    monkeypatch.setattr("urllib.request.urlopen", fail)
    model = OpenRouterModel("test/model", api_key="test")

    with pytest.raises(ModelError, match="automatic retry disabled"):
        model.chat([{"role": "user", "content": "move"}])
    assert calls == 1


def test_503_honors_retry_after_then_records_response(monkeypatch):
    calls = 0
    sleeps: list[float] = []

    def respond(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise _http_error(503, retry_after="2.5")
        return _Response(
            {
                "choices": [{"message": {"content": "e2e4"}}],
                "usage": {
                    "prompt_tokens": 7,
                    "completion_tokens": 3,
                    "cost": 0.001,
                },
            }
        )

    monkeypatch.setattr("urllib.request.urlopen", respond)
    monkeypatch.setattr("time.sleep", sleeps.append)
    model = OpenRouterModel("test/model", api_key="test")

    assert model.chat([{"role": "user", "content": "move"}]) == "e2e4"
    assert calls == 2
    assert sleeps == [2.5]
    assert model.last_cost == pytest.approx(0.001)


def _capture_request(
    monkeypatch,
    response: dict[str, object],
    *,
    response_headers: dict[str, str] | None = None,
):
    captured: dict[str, object] = {}

    def respond(request, **_kwargs):
        captured["payload"] = json.loads(request.data)
        captured["headers"] = dict(request.header_items())
        return _Response(response, headers=response_headers)

    monkeypatch.setattr("urllib.request.urlopen", respond)
    return captured


def test_grok_cache_session_is_routing_only_and_tools_are_absent(monkeypatch):
    captured = _capture_request(
        monkeypatch,
        {
            "choices": [{"message": {"content": "e2e4"}}],
            "usage": {
                "prompt_tokens": 100,
                "completion_tokens": 5,
                "prompt_tokens_details": {"cached_tokens": 80},
                "cost": 0.0002,
            },
            "cache_discount": 0.0001,
        },
    )
    model = OpenRouterModel("x-ai/grok-4.5", api_key="test")
    model.set_cache_session("cb:run:puzzle:abc")

    assert model.chat([{"role": "user", "content": "move"}]) == "e2e4"
    payload = captured["payload"]
    assert isinstance(payload, dict)
    assert payload["session_id"] == "cb:run:puzzle:abc"
    assert "prompt_cache_key" not in payload
    assert "cache_control" not in payload
    assert "tools" not in payload
    assert "plugins" not in payload
    assert "tool_choice" not in payload
    headers = captured["headers"]
    assert isinstance(headers, dict)
    assert not any(key.lower() == "x-openrouter-cache" for key in headers)
    assert any(
        key.lower() == "x-openrouter-metadata" and value == "enabled"
        for key, value in headers.items()
    )
    assert model.last_cache_policy == "prompt_prefix_v1"
    assert model.last_cache_session_id == "cb:run:puzzle:abc"
    assert model.last_cache_discount == pytest.approx(0.0001)


@pytest.mark.parametrize(
    ("model_id", "expected"),
    [
        ("openai/gpt-5.6-luna", "prompt_cache_key"),
        ("anthropic/claude-haiku-4.5", "cache_control"),
    ],
)
def test_openrouter_provider_specific_cache_hint(monkeypatch, model_id, expected):
    captured = _capture_request(
        monkeypatch, {"choices": [{"message": {"content": "e2e4"}}]}
    )
    model = OpenRouterModel(model_id, api_key="test")
    model.set_cache_session("cache-key")
    model.chat([{"role": "user", "content": "move"}])
    payload = captured["payload"]
    assert isinstance(payload, dict)
    assert expected in payload


def test_direct_openai_uses_prompt_cache_key_without_session_id(monkeypatch):
    captured = _capture_request(
        monkeypatch, {"choices": [{"message": {"content": "e2e4"}}]}
    )
    model = OpenAIModel("gpt-5.4-mini", api_key="test")
    model.set_cache_session("cache-key")
    model.chat([{"role": "user", "content": "move"}])
    payload = captured["payload"]
    assert isinstance(payload, dict)
    assert payload["prompt_cache_key"] == "cache-key"
    assert "session_id" not in payload


def test_forbidden_returned_tool_call_fails_closed(monkeypatch):
    _capture_request(
        monkeypatch,
        {
            "choices": [
                {
                    "finish_reason": "tool_calls",
                    "message": {"tool_calls": [{"function": {"name": "search"}}]},
                }
            ]
        },
    )
    model = OpenRouterModel("x-ai/grok-4.5", api_key="test")
    with pytest.raises(ModelError, match="forbidden tool call"):
        model.chat([{"role": "user", "content": "move"}])


def test_choice_error_is_not_coerced_to_empty_chess_answer(monkeypatch):
    response = {
        "id": "gen-glm-failed",
        "model": "z-ai/glm-5.2",
        "provider": "Example Inference",
        "choices": [
            {
                "finish_reason": "error",
                "native_finish_reason": "server_error",
                "message": {"content": None},
                "error": {"code": 500, "message": "generation failed"},
            }
        ],
        "usage": {
            "prompt_tokens": 147,
            "completion_tokens": 7610,
            "completion_tokens_details": {"reasoning_tokens": 5368},
            "cost": 0.0292616478,
        },
    }
    _capture_request(monkeypatch, response)
    model = OpenRouterModel("z-ai/glm-5.2", api_key="test")

    with pytest.raises(ModelError, match="choice error"):
        model.chat([{"role": "user", "content": "move"}])

    assert model.last_response_id == "gen-glm-failed"
    assert model.last_response_model == "z-ai/glm-5.2"
    assert model.last_response_provider == "Example Inference"
    assert model.last_finish_reason == "error"
    assert model.last_native_finish_reason == "server_error"
    assert model.last_provider_error == {
        "code": 500,
        "message": "generation failed",
    }
    assert model.last_provider_response == response
    assert model.last_usage == response["usage"]
    assert model.last_cost == pytest.approx(0.0292616478)


@pytest.mark.parametrize("content", [None, "", "   \n"])
def test_null_or_blank_visible_content_is_provider_failure(monkeypatch, content):
    _capture_request(
        monkeypatch,
        {
            "id": "gen-empty",
            "choices": [
                {
                    "finish_reason": "length",
                    "native_finish_reason": "max_tokens",
                    "message": {"content": content},
                }
            ],
        },
    )
    model = OpenRouterModel("z-ai/glm-5.2", api_key="test")

    with pytest.raises(ModelError, match="no visible content"):
        model.chat([{"role": "user", "content": "move"}])

    assert model.last_response_id == "gen-empty"
    assert model.last_finish_reason == "length"
    assert model.last_native_finish_reason == "max_tokens"


def test_successful_response_keeps_full_provider_envelope(monkeypatch):
    response = {
        "id": "gen-success",
        "model": "z-ai/glm-5.2",
        "openrouter_metadata": {
            "strategy": "direct",
            "endpoints": {
                "available": [
                    {
                        "provider": "Example Inference",
                        "model": "z-ai/glm-5.2",
                        "selected": True,
                    }
                ]
            },
        },
        "choices": [
            {
                "finish_reason": "stop",
                "native_finish_reason": "stop",
                "message": {"content": "h5h4"},
            }
        ],
    }
    _capture_request(
        monkeypatch,
        response,
        response_headers={
            "X-Generation-Id": "gen-header",
            "CF-Ray": "example-ray",
            "Set-Cookie": "must-not-be-persisted",
        },
    )
    model = OpenRouterModel("z-ai/glm-5.2", api_key="test")

    assert model.chat([{"role": "user", "content": "move"}]) == "h5h4"
    assert model.last_provider_response == response
    assert model.last_provider_response_raw == json.dumps(response)
    assert model.last_http_status == 200
    assert model.last_response_headers == {
        "x-generation-id": "gen-header",
        "cf-ray": "example-ray",
    }
    assert model.last_request_payload == {
        "model": "z-ai/glm-5.2",
        "messages": [{"role": "user", "content": "move"}],
        "temperature": 0.0,
        "max_tokens": 2048,
    }
    assert model.last_response_provider == "Example Inference"
    assert model.last_finish_reason == "stop"


def test_generation_id_header_is_kept_when_error_body_has_no_id(monkeypatch):
    _capture_request(
        monkeypatch,
        {
            "choices": [
                {
                    "finish_reason": "error",
                    "message": {"content": None},
                    "error": {"code": 502, "message": "provider disconnected"},
                }
            ]
        },
        response_headers={"X-Generation-Id": "gen-from-header"},
    )
    model = OpenRouterModel("z-ai/glm-5.2", api_key="test")

    with pytest.raises(ModelError, match="choice error"):
        model.chat([{"role": "user", "content": "move"}])

    assert model.last_response_id == "gen-from-header"


def test_provider_output_limit_omits_max_tokens_but_keeps_reasoning_effort(monkeypatch):
    captured = _capture_request(
        monkeypatch, {"choices": [{"message": {"content": "e2e4"}}]}
    )
    model = OpenRouterModel(
        "qwen/qwen3.5-flash-02-23",
        api_key="test",
        reasoning_effort="low",
    )

    assert model.chat(
        [{"role": "user", "content": "move"}],
        max_tokens=0,
    ) == "e2e4"
    payload = captured["payload"]
    assert isinstance(payload, dict)
    assert "max_tokens" not in payload
    assert payload["reasoning"] == {"effort": "low", "exclude": True}


def test_provider_route_is_sent_without_tools(monkeypatch):
    captured = _capture_request(
        monkeypatch, {"choices": [{"message": {"content": "h5h4"}}]}
    )
    model = OpenRouterModel(
        "z-ai/glm-5.2",
        api_key="test",
        reasoning_effort="high",
        provider_preferences={
            "only": ["z-ai"],
            "allow_fallbacks": False,
            "require_parameters": True,
        },
    )

    assert model.chat([{"role": "user", "content": "move"}], max_tokens=0) == "h5h4"
    payload = captured["payload"]
    assert isinstance(payload, dict)
    assert payload["provider"] == {
        "only": ["z-ai"],
        "allow_fallbacks": False,
        "require_parameters": True,
    }
    assert "tools" not in payload
