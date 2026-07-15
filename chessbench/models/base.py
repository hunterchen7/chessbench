"""Model interface: turn a list of chat messages into text.

Kept deliberately thin and provider-agnostic so the same models serve puzzles,
games, and composed problems. Concrete providers live alongside this module.
`ScriptedModel` needs no network or keys and backs the test suite.
"""

from __future__ import annotations

from typing import Callable, Protocol, runtime_checkable

from ..response_protocols import ResponseFormat
from ..types import Message


@runtime_checkable
class Model(Protocol):
    """A text generator. `chat` is the primitive; `generate` is a convenience."""

    name: str

    def chat(
        self,
        messages: list[Message],
        *,
        temperature: float = 0.0,
        max_tokens: int = 2048,
    ) -> str: ...

    def generate(
        self, prompt: str, *, temperature: float = 0.0, max_tokens: int = 2048
    ) -> str: ...


@runtime_checkable
class VisionModel(Protocol):
    """A multimodal model that accepts a text prompt + a board image (PNG)."""

    name: str

    def chat_image(
        self, text: str, png: bytes, *, temperature: float = 0.0, max_tokens: int = 2048
    ) -> str: ...


@runtime_checkable
class StructuredOutputModel(Protocol):
    """Optional capability implemented by providers with API-level JSON Schema."""

    def chat_structured(
        self,
        messages: list[Message],
        *,
        response_format: ResponseFormat,
        temperature: float = 0.0,
        max_tokens: int = 2048,
    ) -> str: ...

    def generate_structured(
        self,
        prompt: str,
        *,
        response_format: ResponseFormat,
        temperature: float = 0.0,
        max_tokens: int = 2048,
    ) -> str: ...


@runtime_checkable
class StructuredVisionModel(Protocol):
    def chat_image_structured(
        self,
        text: str,
        png: bytes,
        *,
        response_format: ResponseFormat,
        temperature: float = 0.0,
        max_tokens: int = 2048,
    ) -> str: ...


class StructuredOutputUnsupported(RuntimeError):
    """The selected model adapter cannot enforce the requested JSON Schema."""


def chat_with_response_format(
    model: Model,
    messages: list[Message],
    *,
    response_format: ResponseFormat | None,
    temperature: float,
    max_tokens: int,
) -> tuple[str, ResponseFormat | None]:
    """Use schema enforcement when the provider exposes it; report what applied."""
    if response_format is not None:
        if not isinstance(model, StructuredOutputModel):
            raise StructuredOutputUnsupported(
                f"{model.name} cannot enforce the requested structured-output protocol"
            )
        return model.chat_structured(
            messages,
            response_format=response_format,
            temperature=temperature,
            max_tokens=max_tokens,
        ), response_format
    return model.chat(messages, temperature=temperature, max_tokens=max_tokens), None


def generate_with_response_format(
    model: Model,
    prompt: str,
    *,
    response_format: ResponseFormat | None,
    temperature: float,
    max_tokens: int,
) -> tuple[str, ResponseFormat | None]:
    if response_format is not None:
        if not isinstance(model, StructuredOutputModel):
            raise StructuredOutputUnsupported(
                f"{model.name} cannot enforce the requested structured-output protocol"
            )
        return model.generate_structured(
            prompt,
            response_format=response_format,
            temperature=temperature,
            max_tokens=max_tokens,
        ), response_format
    return model.generate(prompt, temperature=temperature, max_tokens=max_tokens), None


def image_with_response_format(
    model: VisionModel,
    text: str,
    png: bytes,
    *,
    response_format: ResponseFormat | None,
    temperature: float,
    max_tokens: int,
) -> tuple[str, ResponseFormat | None]:
    if response_format is not None:
        if not isinstance(model, StructuredVisionModel):
            raise StructuredOutputUnsupported(
                f"{model.name} cannot enforce the requested structured-output protocol"
            )
        return model.chat_image_structured(
            text,
            png,
            response_format=response_format,
            temperature=temperature,
            max_tokens=max_tokens,
        ), response_format
    return model.chat_image(
        text, png, temperature=temperature, max_tokens=max_tokens
    ), None


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

    def __init__(
        self, responder: Callable[[list[Message]], str], name: str = "scripted"
    ) -> None:
        self.name = name
        self._responder = responder

    def chat(
        self,
        messages: list[Message],
        *,
        temperature: float = 0.0,
        max_tokens: int = 2048,
    ) -> str:
        return self._responder(messages)

    def generate(
        self, prompt: str, *, temperature: float = 0.0, max_tokens: int = 2048
    ) -> str:
        msg: Message = {"role": "user", "content": prompt}
        return self.chat([msg], temperature=temperature, max_tokens=max_tokens)

    def chat_structured(
        self,
        messages: list[Message],
        *,
        response_format: ResponseFormat,
        temperature: float = 0.0,
        max_tokens: int = 2048,
    ) -> str:
        return self.chat(messages, temperature=temperature, max_tokens=max_tokens)

    def generate_structured(
        self,
        prompt: str,
        *,
        response_format: ResponseFormat,
        temperature: float = 0.0,
        max_tokens: int = 2048,
    ) -> str:
        return self.generate(prompt, temperature=temperature, max_tokens=max_tokens)
