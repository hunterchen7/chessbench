"""OpenAI-compatible chat providers (OpenAI and OpenRouter).

Implemented on the standard library (`urllib`) so the core has no third-party
SDK dependency. Both services share the ``POST /chat/completions`` schema, so a
single base class serves both; only the base URL, env var, and auth header
differ. Per-call token usage and (for OpenRouter) cost are captured so the
harness can report and cap spend.
"""

from __future__ import annotations

import http.client
import json
import os
import time
import urllib.error
import urllib.request
from typing import TypedDict, cast

from ..types import Message

# HTTP statuses worth retrying (rate limit + transient server errors).
_RETRY_STATUS = {429, 500, 502, 503, 504}


class ModelError(RuntimeError):
    """Raised when a provider call fails (HTTP error, bad payload, empty reply)."""


class Usage(TypedDict, total=False):
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    cost: float  # OpenRouter includes USD cost; OpenAI does not
    completion_tokens_details: dict[str, int]


class _Choice(TypedDict, total=False):
    message: dict[str, object]
    finish_reason: str


class _Response(TypedDict, total=False):
    choices: list[_Choice]
    usage: Usage
    model: str
    error: dict[str, str]


class _OpenAICompatModel:
    """Base for any service exposing OpenAI's /chat/completions endpoint."""

    def __init__(
        self,
        model: str,
        *,
        base_url: str,
        api_key: str | None,
        env_var: str,
        extra_headers: dict[str, str] | None = None,
        timeout: float = 120.0,
        max_retries: int = 4,
        reasoning_effort: str | None = None,
        reasoning_max_tokens: int | None = None,
    ) -> None:
        self.name = model
        self._model = model
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key or os.environ.get(env_var)
        self._env_var = env_var
        self._extra_headers = extra_headers or {}
        self._timeout = timeout
        self._max_retries = max_retries
        if reasoning_effort is not None and reasoning_max_tokens is not None:
            raise ValueError("reasoning_effort and reasoning_max_tokens are mutually exclusive")
        self._reasoning_effort = reasoning_effort
        self._reasoning_max_tokens = reasoning_max_tokens
        self.last_usage: Usage | None = None
        self.last_cost: float = 0.0
        self.total_cost: float = 0.0

    def _post(self, data: bytes, headers: dict[str, str]) -> str:
        """POST with retry+backoff on transient failures (network resets,
        timeouts, 429/5xx). Non-retryable HTTP errors raise immediately."""
        req = urllib.request.Request(f"{self._base_url}/chat/completions", data=data, headers=headers)
        last: Exception | None = None
        for attempt in range(self._max_retries):
            try:
                with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                    return resp.read().decode("utf-8")
            except urllib.error.HTTPError as e:
                if e.code not in _RETRY_STATUS:
                    detail = e.read().decode("utf-8", "replace")
                    raise ModelError(f"{self._model}: HTTP {e.code}: {detail}") from e
                last = e
            except (urllib.error.URLError, http.client.HTTPException, OSError) as e:
                last = e  # ConnectionResetError, timeouts, DNS, etc. are OSError/URLError
            if attempt < self._max_retries - 1:
                time.sleep(min(8.0, 0.7 * (2 ** attempt)))  # 0.7, 1.4, 2.8, ...
        raise ModelError(f"{self._model}: transient request failure after {self._max_retries} tries: {last}")

    def _complete(self, messages: list[object], temperature: float, max_tokens: int) -> str:
        if not self._api_key:
            raise ModelError(f"No API key: set {self._env_var} or pass api_key=.")
        payload: dict[str, object] = {
            "model": self._model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            # The benchmark never offers or executes tools.  Explicitly disabling
            # tool choice also protects against provider/router defaults changing.
            "tool_choice": "none",
        }
        if self._reasoning_effort is not None:
            payload["reasoning"] = {"effort": self._reasoning_effort, "exclude": True}
        elif self._reasoning_max_tokens is not None:
            payload["reasoning"] = {"max_tokens": self._reasoning_max_tokens, "exclude": True}
            payload["max_tokens"] = max(max_tokens, self._reasoning_max_tokens + 512)
        data = json.dumps(payload).encode("utf-8")
        headers = {"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json",
                   **self._extra_headers}
        body = self._post(data, headers)
        parsed = cast(_Response, json.loads(body))
        if "error" in parsed:
            raise ModelError(f"{self._model}: {parsed['error']}")
        choices = parsed.get("choices")
        if not choices:
            raise ModelError(f"{self._model}: no choices in response: {body[:200]}")
        choice = choices[0]
        message = choice.get("message", {})
        if choice.get("finish_reason") == "tool_calls" or message.get("tool_calls"):
            raise ModelError(f"{self._model}: provider returned a forbidden tool call")
        usage = parsed.get("usage")
        if usage is not None:
            self.last_usage = usage
            self.last_cost = float(usage.get("cost", 0.0))
            self.total_cost += self.last_cost
        content = message.get("content")
        return content if isinstance(content, str) else ""

    def chat(self, messages: list[Message], *, temperature: float = 0.0, max_tokens: int = 2048) -> str:
        return self._complete(list(messages), temperature, max_tokens)

    def chat_image(self, text: str, png: bytes, *, temperature: float = 0.0, max_tokens: int = 2048) -> str:
        """Vision call: a text prompt plus a board PNG (OpenAI image_url format)."""
        import base64

        data_uri = "data:image/png;base64," + base64.b64encode(png).decode("ascii")
        content = [{"type": "text", "text": text}, {"type": "image_url", "image_url": {"url": data_uri}}]
        return self._complete([{"role": "user", "content": content}], temperature, max_tokens)

    def generate(self, prompt: str, *, temperature: float = 0.0, max_tokens: int = 2048) -> str:
        msg: Message = {"role": "user", "content": prompt}
        return self.chat([msg], temperature=temperature, max_tokens=max_tokens)


class OpenRouterModel(_OpenAICompatModel):
    """Any model routed through https://openrouter.ai (e.g. ``openai/gpt-4o-mini``,
    ``google/gemini-2.0-flash-001``). Reports USD cost per call."""

    def __init__(self, model: str, *, api_key: str | None = None, timeout: float = 120.0,
                 reasoning_effort: str | None = None, reasoning_max_tokens: int | None = None) -> None:
        super().__init__(
            model,
            base_url="https://openrouter.ai/api/v1",
            api_key=api_key,
            env_var="OPENROUTER_API_KEY",
            extra_headers={
                "HTTP-Referer": "https://github.com/chessbench",
                "X-Title": "chessbench",
            },
            timeout=timeout,
            reasoning_effort=reasoning_effort,
            reasoning_max_tokens=reasoning_max_tokens,
        )


class OpenAIModel(_OpenAICompatModel):
    """A model on OpenAI's own API (e.g. ``gpt-4.1``, ``gpt-4o-mini``)."""

    def __init__(self, model: str = "gpt-4.1", *, api_key: str | None = None, timeout: float = 120.0) -> None:
        super().__init__(
            model, base_url="https://api.openai.com/v1", api_key=api_key, env_var="OPENAI_API_KEY", timeout=timeout
        )
