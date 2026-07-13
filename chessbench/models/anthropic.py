"""Anthropic (Claude) provider.

Uses the official `anthropic` SDK, imported lazily so the core has no hard
dependency on it. Anthropic takes the system prompt as a separate parameter, so
we split it out of the message list.
"""

from __future__ import annotations

import os

from ..types import Message
from .base import split_system


class AnthropicModel:
    def __init__(self, model: str = "claude-opus-4-8", *, api_key: str | None = None) -> None:
        self.name = model
        self._model = model
        self._api_key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        self._client: object | None = None

    def _ensure(self) -> object:
        if self._client is None:
            import anthropic  # lazy import

            self._client = anthropic.Anthropic(api_key=self._api_key)
        return self._client

    def chat(self, messages: list[Message], *, temperature: float = 0.0, max_tokens: int = 2048) -> str:
        client = self._ensure()
        system, rest = split_system(messages)
        kwargs: dict[str, object] = {
            "model": self._model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": rest,
        }
        if system:
            kwargs["system"] = system
        msg = client.messages.create(**kwargs)  # type: ignore[attr-defined]
        return "".join(block.text for block in msg.content if getattr(block, "type", None) == "text")

    def generate(self, prompt: str, *, temperature: float = 0.0, max_tokens: int = 2048) -> str:
        msg: Message = {"role": "user", "content": prompt}
        return self.chat([msg], temperature=temperature, max_tokens=max_tokens)
