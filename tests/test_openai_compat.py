"""Provider retry policy preserves one auditable attempt per ambiguous call."""

from __future__ import annotations

import io
import json
import urllib.error

import pytest

from chessbench.models.openai_compat import ModelError, OpenRouterModel


class _Response:
    def __init__(self, payload: dict[str, object]) -> None:
        self._body = json.dumps(payload).encode()

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return None

    def read(self) -> bytes:
        return self._body


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
