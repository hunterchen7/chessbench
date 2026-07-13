"""Model interface: turn a prompt into text. Kept deliberately thin and separate
from Agent logic so the same providers serve puzzles, games, and composed problems.

Providers are lazy-imported so the core has no hard dependency on any LLM SDK;
you only need `anthropic` / `openai` installed if you actually use those models.
For CI and pipeline verification, `ScriptedModel` needs no network or keys.
"""

from __future__ import annotations

import os
from typing import Callable, Protocol

Message = dict  # {"role": "system"|"user"|"assistant", "content": str}


class Model(Protocol):
    name: str

    def chat(self, messages: list[Message], *, temperature: float = 0.0, max_tokens: int = 2048) -> str:
        ...

    def generate(self, prompt: str, *, temperature: float = 0.0, max_tokens: int = 2048) -> str:
        ...


def _split_system(messages: list[Message]) -> tuple[str | None, list[Message]]:
    system = None
    rest: list[Message] = []
    for m in messages:
        if m["role"] == "system" and system is None:
            system = m["content"]
        else:
            rest.append(m)
    return system, rest


class ScriptedModel:
    """Deterministic model for tests. `responder` receives the message list (or a
    lone prompt via generate) and returns the reply text."""

    def __init__(self, responder: Callable[[list[Message]], str], name: str = "scripted"):
        self.name = name
        self._responder = responder

    def chat(self, messages: list[Message], *, temperature: float = 0.0, max_tokens: int = 2048) -> str:
        return self._responder(messages)

    def generate(self, prompt: str, *, temperature: float = 0.0, max_tokens: int = 2048) -> str:
        return self.chat([{"role": "user", "content": prompt}], temperature=temperature, max_tokens=max_tokens)


class AnthropicModel:
    def __init__(self, model: str = "claude-opus-4-8", api_key: str | None = None):
        self.name = model
        self._model = model
        self._api_key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        self._client = None

    def _ensure(self):
        if self._client is None:
            import anthropic  # lazy

            self._client = anthropic.Anthropic(api_key=self._api_key)
        return self._client

    def chat(self, messages, *, temperature: float = 0.0, max_tokens: int = 2048) -> str:
        client = self._ensure()
        system, rest = _split_system(messages)
        kwargs = dict(model=self._model, max_tokens=max_tokens, temperature=temperature, messages=rest)
        if system:
            kwargs["system"] = system
        msg = client.messages.create(**kwargs)
        return "".join(block.text for block in msg.content if block.type == "text")

    def generate(self, prompt: str, *, temperature: float = 0.0, max_tokens: int = 2048) -> str:
        return self.chat([{"role": "user", "content": prompt}], temperature=temperature, max_tokens=max_tokens)


class OpenAIModel:
    def __init__(self, model: str = "gpt-4.1", api_key: str | None = None):
        self.name = model
        self._model = model
        self._api_key = api_key or os.environ.get("OPENAI_API_KEY")
        self._client = None

    def _ensure(self):
        if self._client is None:
            import openai  # lazy

            self._client = openai.OpenAI(api_key=self._api_key)
        return self._client

    def chat(self, messages, *, temperature: float = 0.0, max_tokens: int = 2048) -> str:
        client = self._ensure()
        resp = client.chat.completions.create(
            model=self._model, max_tokens=max_tokens, temperature=temperature, messages=messages
        )
        return resp.choices[0].message.content or ""

    def generate(self, prompt: str, *, temperature: float = 0.0, max_tokens: int = 2048) -> str:
        return self.chat([{"role": "user", "content": prompt}], temperature=temperature, max_tokens=max_tokens)
