"""Provider retry policy preserves one auditable attempt per ambiguous call."""

from __future__ import annotations

import io
import itertools
import json
import urllib.error

import pytest

from chessbench.models.openai_compat import (
    EmptyCompletionError,
    ModelError,
    OpenAIModel,
    OpenRouterModel,
    StreamTruncatedError,
)


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
    status = 200
    headers = {"Content-Type": "application/json"}

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return None

    def read1(self, _size: int) -> bytes:
        return b" "


class _StreamingResponse:
    status = 200
    headers = {
        "Content-Type": "text/event-stream; charset=utf-8",
        "X-Generation-Id": "gen-stream-header",
    }

    def __init__(self, lines: list[bytes | BaseException]) -> None:
        self._lines = iter(lines)

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return None

    def readline(self) -> bytes:
        value = next(self._lines, b"")
        if isinstance(value, BaseException):
            raise value
        return value


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


def test_nonstreaming_chunks_cannot_extend_total_response_deadline(monkeypatch):
    calls = 0
    clock = iter([0.0, 0.4, 1.1])

    def respond(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        return _HeartbeatResponse()

    monkeypatch.setattr("urllib.request.urlopen", respond)
    monkeypatch.setattr("time.monotonic", lambda: next(clock))
    model = OpenRouterModel(
        "test/model", api_key="test", timeout=10.0, total_timeout=1.0
    )

    with pytest.raises(ModelError, match="total response deadline exceeded"):
        model.chat([{"role": "user", "content": "move"}])
    assert calls == 1


def test_streaming_response_aggregates_content_reasoning_usage_and_audit(monkeypatch):
    events = [
        b": OPENROUTER PROCESSING\n",
        b"\n",
        b'data: {"id":"gen-stream","model":"test/model","provider":"Fast Provider","choices":[{"index":0,"delta":{"reasoning":"calculate "},"finish_reason":null}]}\n',
        b"\n",
        b'data: {"choices":[{"index":0,"delta":{"reasoning":"more","content":"e2"},"finish_reason":null}]}\n',
        b"\n",
        b'data: {"choices":[{"index":0,"delta":{"content":"e4"},"finish_reason":"stop","native_finish_reason":"stop"}],"usage":{"prompt_tokens":7,"completion_tokens":11,"completion_tokens_details":{"reasoning_tokens":9},"cost":0.002}}\n',
        b"\n",
        b"data: [DONE]\n",
        b"\n",
    ]
    captured: dict[str, object] = {}

    def respond(request, **_kwargs):
        captured["payload"] = json.loads(request.data)
        return _StreamingResponse(events)

    monkeypatch.setattr("urllib.request.urlopen", respond)
    model = OpenRouterModel("test/model", api_key="test")

    assert model.chat([{"role": "user", "content": "move"}]) == "e2e4"
    assert captured["payload"] == {
        "model": "test/model",
        "messages": [{"role": "user", "content": "move"}],
        "temperature": 0.0,
        "stream": True,
        "stream_options": {"include_usage": True},
        "max_tokens": 2048,
    }
    assert model.last_reasoning == "calculate more"
    assert model.last_response_id == "gen-stream"
    assert model.last_response_provider == "Fast Provider"
    assert model.last_finish_reason == "stop"
    assert model.last_usage == {
        "prompt_tokens": 7,
        "completion_tokens": 11,
        "completion_tokens_details": {"reasoning_tokens": 9},
        "cost": 0.002,
    }
    assert model.last_cost == pytest.approx(0.002)
    assert model.last_provider_response_raw is not None
    assert ": OPENROUTER PROCESSING" in model.last_provider_response_raw
    assert "data: [DONE]" in model.last_provider_response_raw


def test_stream_keepalive_comments_do_not_reset_idle_deadline(monkeypatch):
    clock = iter([0.0, 0.1, 0.2, 1.2])
    response = _StreamingResponse(
        [b": OPENROUTER PROCESSING\n", b"\n", b": OPENROUTER PROCESSING\n"]
    )
    monkeypatch.setattr("urllib.request.urlopen", lambda *_a, **_kw: response)
    monkeypatch.setattr("time.monotonic", lambda: next(clock))
    model = OpenRouterModel(
        "test/model", api_key="test", timeout=1.0, total_timeout=10.0
    )

    with pytest.raises(ModelError, match="stream idle deadline exceeded"):
        model.chat([{"role": "user", "content": "move"}])


def test_stream_total_deadline_still_bounds_active_generation(monkeypatch):
    clock = itertools.chain([0.0, 0.0, 0.1, 0.2], itertools.repeat(1.1))
    response = _StreamingResponse(
        [
            b'data: {"choices":[{"delta":{"reasoning":"a"}}]}\n',
            b"\n",
            b'data: {"choices":[{"delta":{"reasoning":"b"}}]}\n',
        ]
    )
    monkeypatch.setattr("urllib.request.urlopen", lambda *_a, **_kw: response)
    monkeypatch.setattr("time.monotonic", lambda: next(clock))
    model = OpenRouterModel(
        "test/model", api_key="test", timeout=10.0, total_timeout=1.0
    )

    with pytest.raises(ModelError, match="total response deadline exceeded"):
        model.chat([{"role": "user", "content": "move"}])


def test_midstream_timeout_keeps_partial_provider_audit(monkeypatch):
    response = _StreamingResponse(
        [
            b'data: {"id":"gen-partial","model":"test/model","provider":"Fast Provider","choices":[{"delta":{"reasoning":"working"}}]}\n',
            b"\n",
            TimeoutError("socket timed out"),
        ]
    )
    monkeypatch.setattr("urllib.request.urlopen", lambda *_a, **_kw: response)
    model = OpenRouterModel("test/model", api_key="test")

    with pytest.raises(ModelError, match="stream idle deadline exceeded"):
        model.chat([{"role": "user", "content": "move"}])

    assert model.last_response_id == "gen-partial"
    assert model.last_response_model == "test/model"
    assert model.last_response_provider == "Fast Provider"
    assert model.last_provider_response is not None
    assert model.last_provider_response_raw is not None
    assert "working" in model.last_provider_response_raw


def test_stream_progress_reuses_private_accumulator_without_quadratic_copy():
    model = OpenRouterModel("test/model", api_key="test")
    response = {
        "choices": [
            {
                "index": 0,
                "message": {
                    "reasoning_details": [{"type": "reasoning.text", "text": "working"}]
                },
            }
        ]
    }

    model._capture_stream_progress(response)

    assert model.last_provider_response is response


def test_stream_coalesces_adjacent_reasoning_text_fragments_losslessly():
    response: dict[str, object] = {}
    first = {
        "choices": [
            {
                "delta": {
                    "reasoning_details": [
                        {
                            "type": "reasoning.text",
                            "format": "deepseek-v3",
                            "index": 0,
                            "text": "calcu",
                        }
                    ]
                }
            }
        ]
    }
    second = {
        "choices": [
            {
                "delta": {
                    "reasoning_details": [
                        {
                            "type": "reasoning.text",
                            "format": "deepseek-v3",
                            "index": 0,
                            "text": "late",
                        }
                    ]
                }
            }
        ]
    }

    OpenRouterModel._merge_stream_chunk(response, first)
    OpenRouterModel._merge_stream_chunk(response, second)

    assert response["choices"][0]["message"]["reasoning_details"] == [
        {
            "type": "reasoning.text",
            "format": "deepseek-v3",
            "index": 0,
            "text": "calculate",
        }
    ]


def test_large_raw_response_audit_is_bounded_with_digest():
    model = OpenRouterModel("test/model", api_key="test")
    body = "begin" + ("x" * 300_000) + "end"

    model._capture_http_response(_Response({}), body)

    assert model.last_provider_response_raw is not None
    assert model.last_provider_response_raw.startswith("begin")
    assert model.last_provider_response_raw.endswith("end")
    assert "raw response truncated; bytes=" in model.last_provider_response_raw
    assert "sha256=" in model.last_provider_response_raw
    assert len(model.last_provider_response_raw) < len(body)


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
def test_length_stop_without_visible_content_is_model_answer_failure(
    monkeypatch, content
):
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

    with pytest.raises(EmptyCompletionError, match="no visible content"):
        model.chat([{"role": "user", "content": "move"}])

    assert model.last_response_id == "gen-empty"
    assert model.last_finish_reason == "length"
    assert model.last_native_finish_reason == "max_tokens"


def test_completed_empty_content_is_a_model_answer_failure(monkeypatch):
    _capture_request(
        monkeypatch,
        {
            "id": "gen-empty-completed",
            "choices": [
                {
                    "finish_reason": "stop",
                    "native_finish_reason": "completed",
                    "message": {"content": None, "reasoning": "No final move."},
                }
            ],
            "usage": {"completion_tokens": 100, "cost": 0.01},
        },
    )
    model = OpenRouterModel("x-ai/grok-4.5", api_key="test")

    with pytest.raises(EmptyCompletionError, match="no visible content"):
        model.chat([{"role": "user", "content": "move"}])

    assert model.last_finish_reason == "stop"
    assert model.last_native_finish_reason == "completed"
    assert model.last_cost == pytest.approx(0.01)


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
        "stream": True,
        "stream_options": {"include_usage": True},
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

    assert (
        model.chat(
            [{"role": "user", "content": "move"}],
            max_tokens=0,
        )
        == "e2e4"
    )
    payload = captured["payload"]
    assert isinstance(payload, dict)
    assert "max_tokens" not in payload
    assert payload["reasoning"] == {"effort": "low", "exclude": True}


def test_captured_reasoning_is_requested_and_retained_verbatim(monkeypatch):
    details = [
        {
            "type": "reasoning.text",
            "text": "The h-pawn move forces mate.",
            "signature": "signed-provider-block",
            "format": "unknown",
            "index": 0,
        }
    ]
    captured = _capture_request(
        monkeypatch,
        {
            "choices": [
                {
                    "finish_reason": "stop",
                    "message": {
                        "content": "h5h4",
                        "reasoning": "The h-pawn move forces mate.",
                        "reasoning_details": details,
                    },
                }
            ]
        },
    )
    model = OpenRouterModel(
        "minimax/minimax-m3",
        api_key="test",
        reasoning_effort="low",
        reasoning_exclude=False,
    )

    assert model.chat([{"role": "user", "content": "move"}], max_tokens=0) == "h5h4"
    payload = captured["payload"]
    assert isinstance(payload, dict)
    assert payload["reasoning"] == {"effort": "low", "exclude": False}
    assert model.last_reasoning == "The h-pawn move forces mate."
    assert model.last_reasoning_details == details


def test_openrouter_openai_keeps_reasoning_for_audit_but_does_not_replay_it(
    monkeypatch,
):
    captured = _capture_request(
        monkeypatch, {"choices": [{"message": {"content": "e7e5"}}]}
    )
    model = OpenRouterModel(
        "openai/gpt-5.6-sol",
        api_key="test",
        reasoning_effort="high",
        reasoning_exclude=False,
    )

    model.chat(
        [
            {"role": "user", "content": "Your move."},
            {
                "role": "assistant",
                "content": "e2e4",
                "reasoning": "visible compatibility reasoning",
                "reasoning_details": [
                    {
                        "type": "reasoning.encrypted",
                        "data": "opaque-provider-ciphertext",
                        "format": "openai-responses-v1",
                        "id": "rs_test",
                        "index": 0,
                    }
                ],
            },
            {"role": "user", "content": "The position is now ..."},
        ],
        max_tokens=0,
    )

    payload = captured["payload"]
    assert isinstance(payload, dict)
    messages = payload["messages"]
    assert isinstance(messages, list)
    assistant = messages[1]
    assert isinstance(assistant, dict)
    assert assistant == {"role": "assistant", "content": "e2e4"}


def test_openrouter_anthropic_keeps_reasoning_for_audit_but_does_not_replay_it(
    monkeypatch,
):
    captured = _capture_request(
        monkeypatch, {"choices": [{"message": {"content": "e7e5"}}]}
    )
    model = OpenRouterModel("anthropic/claude-fable-5", api_key="test")
    details = [
        {
            "type": "reasoning.text",
            "text": "preserve me",
            "format": "anthropic-claude-v1",
            "index": 0,
        }
    ]

    model.chat(
        [
            {"role": "assistant", "content": "e2e4", "reasoning_details": details},
            {"role": "user", "content": "The position is now ..."},
        ],
        max_tokens=0,
    )

    payload = captured["payload"]
    assert isinstance(payload, dict)
    messages = payload["messages"]
    assert isinstance(messages, list)
    assistant = messages[0]
    assert isinstance(assistant, dict)
    assert assistant == {"role": "assistant", "content": "e2e4"}


def test_openrouter_anthropic_drops_all_reasoning_fields_before_replay(monkeypatch):
    captured = _capture_request(
        monkeypatch, {"choices": [{"message": {"content": "e7e5"}}]}
    )
    model = OpenRouterModel("anthropic/claude-opus-5", api_key="test")
    substantive = {
        "type": "reasoning.text",
        "text": "preserve me",
        "format": "anthropic-claude-v1",
        "index": 0,
    }
    opaque = {
        "type": "reasoning.encrypted",
        "data": "opaque-provider-ciphertext",
        "format": "anthropic-claude-v1",
        "index": 0,
    }

    model.chat(
        [
            {
                "role": "assistant",
                "content": "e2e4",
                "reasoning": "   \n",
                "reasoning_content": "\t",
                "reasoning_details": [
                    substantive,
                    {
                        "type": "reasoning.text",
                        "text": " \n\t ",
                        "format": "anthropic-claude-v1",
                        "index": 0,
                    },
                    opaque,
                ],
            },
            {"role": "user", "content": "The position is now ..."},
        ],
        max_tokens=0,
    )

    payload = captured["payload"]
    assert isinstance(payload, dict)
    messages = payload["messages"]
    assert isinstance(messages, list)
    assistant = messages[0]
    assert isinstance(assistant, dict)
    assert assistant == {"role": "assistant", "content": "e2e4"}


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


def _reasoning_event(text: str) -> bytes:
    return (
        b'data: {"id":"gen-trunc","choices":[{"index":0,"delta":{"reasoning":"'
        + text.encode()
        + b'"}}]}\n'
    )


def test_truncated_stream_is_named_and_retried(monkeypatch):
    """A reasoning stream cut before its final content event must not look like
    a model that declined to answer, and must be re-issued rather than
    stranding the run."""
    attempts: list[int] = []

    def respond(*_args, **_kwargs):
        attempts.append(1)
        if len(attempts) == 1:
            # Reasoning arrived, then the socket closed: no content, no
            # finish_reason, no [DONE].
            return _StreamingResponse([_reasoning_event("thinking"), b"\n", b""])
        return _StreamingResponse(
            [
                b'data: {"id":"gen-ok","choices":[{"index":0,"delta":{"content":"e2e4"},'
                b'"finish_reason":"stop"}]}\n',
                b"\n",
                b"data: [DONE]\n",
                b"\n",
                b"",
            ]
        )

    monkeypatch.setattr("urllib.request.urlopen", respond)
    monkeypatch.setattr("time.sleep", lambda _s: None)
    model = OpenRouterModel("test/model", api_key="test")

    assert model.chat([{"role": "user", "content": "move"}]) == "e2e4"
    assert len(attempts) == 2  # truncation retried, then succeeded


def test_truncated_stream_raises_truncation_not_empty_completion(monkeypatch):
    def respond(*_args, **_kwargs):
        return _StreamingResponse([_reasoning_event("thinking"), b"\n", b""])

    monkeypatch.setattr("urllib.request.urlopen", respond)
    monkeypatch.setattr("time.sleep", lambda _s: None)
    model = OpenRouterModel("test/model", api_key="test")

    with pytest.raises(StreamTruncatedError, match="truncated before completion"):
        model.chat([{"role": "user", "content": "move"}])


def test_stream_with_finish_reason_is_not_treated_as_truncated(monkeypatch):
    """A provider may close without [DONE]; a terminal finish_reason is enough."""
    monkeypatch.setattr(
        "urllib.request.urlopen",
        lambda *_a, **_kw: _StreamingResponse(
            [
                b'data: {"id":"gen-ok","choices":[{"index":0,"delta":{"content":"e2e4"},'
                b'"finish_reason":"stop"}]}\n',
                b"\n",
                b"",
            ]
        ),
    )
    model = OpenRouterModel("test/model", api_key="test")
    assert model.chat([{"role": "user", "content": "move"}]) == "e2e4"


def test_upstream_disconnect_envelope_is_retried(monkeypatch):
    """OpenRouter reports a mid-generation disconnect as a 502 error envelope in
    the body, not an HTTP status. It delivered no completion, so it is retried
    like a truncated stream instead of stranding the run."""
    attempts: list[int] = []

    def respond(*_args, **_kwargs):
        attempts.append(1)
        if len(attempts) == 1:
            return _Response(
                {
                    "error": {
                        "code": 502,
                        "message": "Network connection lost.",
                        "metadata": {"error_type": "provider_unavailable"},
                    }
                }
            )
        return _Response(
            {
                "id": "gen-ok",
                "choices": [
                    {"finish_reason": "stop", "message": {"content": "e2e4"}}
                ],
            }
        )

    monkeypatch.setattr("urllib.request.urlopen", respond)
    monkeypatch.setattr("time.sleep", lambda _s: None)
    model = OpenRouterModel("test/model", api_key="test")

    assert model.chat([{"role": "user", "content": "move"}]) == "e2e4"
    assert len(attempts) == 2


def test_provider_error_with_content_is_not_retried(monkeypatch):
    """A partial answer must not be re-issued: that would duplicate real work."""
    attempts: list[int] = []

    def respond(*_args, **_kwargs):
        attempts.append(1)
        return _Response(
            {
                "error": {"code": 502, "metadata": {"error_type": "provider_unavailable"}},
                "choices": [{"message": {"content": "e2e4"}}],
            }
        )

    monkeypatch.setattr("urllib.request.urlopen", respond)
    model = OpenRouterModel("test/model", api_key="test")

    with pytest.raises(ModelError, match="provider error"):
        model.chat([{"role": "user", "content": "move"}])
    assert len(attempts) == 1  # not retried
