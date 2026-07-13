"""Model interface: turn a list of chat messages into text.

Kept deliberately thin and provider-agnostic so the same models serve puzzles,
games, and composed problems. Concrete providers live alongside this module.
`ScriptedModel` needs no network or keys and backs the test suite.
"""

from __future__ import annotations

from typing import Callable, Protocol, runtime_checkable

from ..types import Message


@runtime_checkable
class Model(Protocol):
    """A text generator. `chat` is the primitive; `generate` is a convenience."""

    name: str

    def chat(self, messages: list[Message], *, temperature: float = 0.0, max_tokens: int = 2048) -> str: ...

    def generate(self, prompt: str, *, temperature: float = 0.0, max_tokens: int = 2048) -> str: ...


@runtime_checkable
class VisionModel(Protocol):
    """A multimodal model that accepts a text prompt + a board image (PNG)."""

    name: str

    def chat_image(self, text: str, png: bytes, *, temperature: float = 0.0, max_tokens: int = 2048) -> str: ...


def split_system(messages: list[Message]) -> tuple[str | None, list[Message]]:
    """Separate a leading system message from the rest (for APIs like Anthropic
    that take the system prompt as a distinct parameter)."""
    system: str | None = None
    rest: list[Message] = []
    for m in messages:
        if m["role"] == "system" and system is None:
            system = m["content"]
        else:
            rest.append(m)
    return system, rest


class ScriptedModel:
    """Deterministic model for tests. `responder` receives the message list (or a
    lone prompt, via `generate`) and returns the reply text."""

    def __init__(self, responder: Callable[[list[Message]], str], name: str = "scripted") -> None:
        self.name = name
        self._responder = responder

    def chat(self, messages: list[Message], *, temperature: float = 0.0, max_tokens: int = 2048) -> str:
        return self._responder(messages)

    def generate(self, prompt: str, *, temperature: float = 0.0, max_tokens: int = 2048) -> str:
        msg: Message = {"role": "user", "content": prompt}
        return self.chat([msg], temperature=temperature, max_tokens=max_tokens)
