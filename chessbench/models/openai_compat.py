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

from ..response_protocols import ResponseFormat
from ..types import Message

# OpenRouter explicitly documents Retry-After for these rejection states. Other
# 5xx responses and transport failures are outcome-ambiguous: the provider may
# have completed and charged the generation before the response was lost.
_SAFE_RETRY_STATUS = {429, 503}


class ModelError(RuntimeError):
    """Raised when a provider call fails (HTTP error, bad payload, empty reply)."""


class Usage(TypedDict, total=False):
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    cost: float  # OpenRouter includes USD cost; OpenAI does not
    completion_tokens_details: dict[str, int]
    prompt_tokens_details: dict[str, int]
    cache_read_input_tokens: int
    cache_creation_input_tokens: int


class _Choice(TypedDict, total=False):
    message: dict[str, object]
    finish_reason: str


class _Response(TypedDict, total=False):
    choices: list[_Choice]
    usage: Usage
    model: str
    error: dict[str, str]
    cache_discount: float


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
        require_structured_parameters: bool = False,
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
            raise ValueError(
                "reasoning_effort and reasoning_max_tokens are mutually exclusive"
            )
        self._reasoning_effort = reasoning_effort
        self._reasoning_max_tokens = reasoning_max_tokens
        self._require_structured_parameters = require_structured_parameters
        self.last_usage: Usage | None = None
        self.last_cost: float = 0.0
        self.total_cost: float = 0.0
        self.last_cache_discount: float = 0.0
        self.last_cache_policy: str = "provider_default"
        self.last_cache_session_id: str | None = None
        self._cache_session_id: str | None = None

    def set_cache_session(self, session_id: str | None) -> None:
        """Set an opaque conversation key for provider prompt-prefix caching."""
        if session_id is not None and len(session_id) > 256:
            raise ValueError("cache session id must be at most 256 characters")
        self._cache_session_id = session_id

    @staticmethod
    def _read_body_with_deadline(resp: object, deadline: float) -> bytes:
        """Read chunked responses without allowing heartbeats to reset timeout.

        ``HTTPResponse.read()`` applies the socket timeout to each receive, not
        to the full body. A provider can therefore keep a nominally
        non-streaming request alive indefinitely with small chunks. ``read1``
        returns after one underlying read, letting us enforce one absolute
        deadline across headers, reasoning, and body delivery.
        """
        read1 = getattr(resp, "read1", None)
        if not callable(read1):
            # Test doubles and non-HTTP compatibility objects generally expose
            # only read(); real urllib HTTPResponse objects provide read1().
            read = getattr(resp, "read")
            return cast(bytes, read())

        chunks: list[bytes] = []
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("total response deadline exceeded")

            # Bound a blocked read by the same remaining wall-clock budget.
            fp = getattr(resp, "fp", None)
            raw = getattr(fp, "raw", None)
            sock = getattr(raw, "_sock", None)
            if sock is not None:
                sock.settimeout(max(0.001, remaining))

            chunk = read1(64 * 1024)
            if not chunk:
                return b"".join(chunks)
            chunks.append(cast(bytes, chunk))

    def _post(self, data: bytes, headers: dict[str, str]) -> str:
        """POST without silently duplicating an outcome-ambiguous generation.

        Only explicit 429/503 rejection responses are retried. A timeout,
        connection reset, or other server error may have happened after model
        inference, and OpenRouter exposes no request idempotency key, so those
        stop the durable cell for an operator-visible resume decision.
        """
        req = urllib.request.Request(
            f"{self._base_url}/chat/completions", data=data, headers=headers
        )
        last: Exception | None = None
        for attempt in range(self._max_retries):
            retry_after: float | None = None
            deadline = time.monotonic() + self._timeout
            try:
                with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                    return self._read_body_with_deadline(resp, deadline).decode(
                        "utf-8"
                    )
            except urllib.error.HTTPError as e:
                if e.code not in _SAFE_RETRY_STATUS:
                    detail = e.read().decode("utf-8", "replace")
                    qualifier = (
                        " outcome may be ambiguous; automatic retry disabled;"
                        if e.code >= 500
                        else ""
                    )
                    raise ModelError(
                        f"{self._model}: HTTP {e.code}:{qualifier} {detail}"
                    ) from e
                last = e
                value = e.headers.get("Retry-After") if e.headers else None
                if value is not None:
                    try:
                        retry_after = max(0.0, float(value))
                    except ValueError:
                        pass
            except (urllib.error.URLError, http.client.HTTPException, OSError) as e:
                raise ModelError(
                    f"{self._model}: transport failure; outcome may be ambiguous; "
                    "automatic retry disabled: "
                    f"{e}"
                ) from e
            if attempt < self._max_retries - 1:
                delay = (
                    min(60.0, retry_after)
                    if retry_after is not None
                    else min(8.0, 0.7 * (2**attempt))
                )
                time.sleep(delay)
        raise ModelError(
            f"{self._model}: rejected after {self._max_retries} safe retries: {last}"
        )

    def _complete(
        self,
        messages: list[object],
        temperature: float,
        max_tokens: int,
        *,
        response_format: ResponseFormat | None = None,
    ) -> str:
        # Per-call audit fields must never inherit a preceding response. A
        # provider error or a successful response without ``usage`` is still a
        # real call, but it has no attributable usage rather than the previous
        # call's tokens/cost.
        self.last_usage = None
        self.last_cost = 0.0
        self.last_cache_discount = 0.0
        self.last_cache_session_id = self._cache_session_id
        self.last_cache_policy = "provider_default"
        if not self._api_key:
            raise ModelError(f"No API key: set {self._env_var} or pass api_key=.")
        payload: dict[str, object] = {
            "model": self._model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        # The benchmark never sends a ``tools`` or ``plugins`` array, so there is
        # nothing the model can invoke. Do not also send ``tool_choice: none``:
        # xAI correctly rejects a tool choice when no tools were declared. We
        # still fail closed below if a provider ever returns a tool call anyway.
        if self._cache_session_id is not None:
            if self._base_url.startswith("https://openrouter.ai"):
                # Session stickiness is routing metadata, not conversation state.
                # It ensures an append-only chat returns to the endpoint holding
                # its prompt-prefix cache.
                payload["session_id"] = self._cache_session_id
                self.last_cache_policy = "prompt_prefix_v1"
                if self._model.startswith("openai/"):
                    payload["prompt_cache_key"] = self._cache_session_id
                if self._model.startswith("anthropic/"):
                    # Anthropic requires an explicit opt-in. Automatic 5-minute
                    # caching advances the breakpoint as the conversation grows.
                    payload["cache_control"] = {"type": "ephemeral"}
            elif self._base_url.startswith("https://api.openai.com"):
                payload["prompt_cache_key"] = self._cache_session_id
                self.last_cache_policy = "prompt_prefix_v1"
        if self._reasoning_effort is not None:
            payload["reasoning"] = {"effort": self._reasoning_effort, "exclude": True}
        elif self._reasoning_max_tokens is not None:
            payload["reasoning"] = {
                "max_tokens": self._reasoning_max_tokens,
                "exclude": True,
            }
            payload["max_tokens"] = max(max_tokens, self._reasoning_max_tokens + 512)
        if response_format is not None:
            payload["response_format"] = response_format
            if self._require_structured_parameters:
                # OpenRouter otherwise permits a provider to silently ignore
                # unsupported parameters. Benchmark protocol constraints fail
                # closed instead of mixing constrained and unconstrained cells.
                payload["provider"] = {"require_parameters": True}
        data = json.dumps(payload).encode("utf-8")
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
            **self._extra_headers,
        }
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
        discount = parsed.get("cache_discount", 0.0)
        if isinstance(discount, (int, float)):
            self.last_cache_discount = float(discount)
        if usage is not None:
            self.last_usage = usage
            self.last_cost = float(usage.get("cost", 0.0))
            self.total_cost += self.last_cost
        content = message.get("content")
        return content if isinstance(content, str) else ""

    def chat(
        self,
        messages: list[Message],
        *,
        temperature: float = 0.0,
        max_tokens: int = 2048,
    ) -> str:
        return self._complete(list(messages), temperature, max_tokens)

    def chat_structured(
        self,
        messages: list[Message],
        *,
        response_format: ResponseFormat,
        temperature: float = 0.0,
        max_tokens: int = 2048,
    ) -> str:
        return self._complete(
            list(messages),
            temperature,
            max_tokens,
            response_format=response_format,
        )

    def chat_image(
        self, text: str, png: bytes, *, temperature: float = 0.0, max_tokens: int = 2048
    ) -> str:
        """Vision call: a text prompt plus a board PNG (OpenAI image_url format)."""
        import base64

        data_uri = "data:image/png;base64," + base64.b64encode(png).decode("ascii")
        content = [
            {"type": "text", "text": text},
            {"type": "image_url", "image_url": {"url": data_uri}},
        ]
        return self._complete(
            [{"role": "user", "content": content}], temperature, max_tokens
        )

    def chat_image_structured(
        self,
        text: str,
        png: bytes,
        *,
        response_format: ResponseFormat,
        temperature: float = 0.0,
        max_tokens: int = 2048,
    ) -> str:
        import base64

        data_uri = "data:image/png;base64," + base64.b64encode(png).decode("ascii")
        content = [
            {"type": "text", "text": text},
            {"type": "image_url", "image_url": {"url": data_uri}},
        ]
        return self._complete(
            [{"role": "user", "content": content}],
            temperature,
            max_tokens,
            response_format=response_format,
        )

    def generate(
        self, prompt: str, *, temperature: float = 0.0, max_tokens: int = 2048
    ) -> str:
        msg: Message = {"role": "user", "content": prompt}
        return self.chat([msg], temperature=temperature, max_tokens=max_tokens)

    def generate_structured(
        self,
        prompt: str,
        *,
        response_format: ResponseFormat,
        temperature: float = 0.0,
        max_tokens: int = 2048,
    ) -> str:
        msg: Message = {"role": "user", "content": prompt}
        return self.chat_structured(
            [msg],
            response_format=response_format,
            temperature=temperature,
            max_tokens=max_tokens,
        )


class OpenRouterModel(_OpenAICompatModel):
    """Any model routed through https://openrouter.ai (e.g. ``openai/gpt-4o-mini``,
    ``google/gemini-2.0-flash-001``). Reports USD cost per call."""

    def __init__(
        self,
        model: str,
        *,
        api_key: str | None = None,
        timeout: float = 120.0,
        reasoning_effort: str | None = None,
        reasoning_max_tokens: int | None = None,
    ) -> None:
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
            require_structured_parameters=True,
        )


class OpenAIModel(_OpenAICompatModel):
    """A model on OpenAI's own API (e.g. ``gpt-4.1``, ``gpt-4o-mini``)."""

    def __init__(
        self,
        model: str = "gpt-4.1",
        *,
        api_key: str | None = None,
        timeout: float = 120.0,
    ) -> None:
        super().__init__(
            model,
            base_url="https://api.openai.com/v1",
            api_key=api_key,
            env_var="OPENAI_API_KEY",
            timeout=timeout,
        )
