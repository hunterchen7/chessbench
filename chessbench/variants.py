"""Stable identities for model + inference-budget combinations.

Provider model IDs are not enough to identify a benchmark participant: a
reasoning model at 512 thinking tokens is a materially different system from
the same model at 8,192 tokens.  ``ModelVariant`` makes that distinction part of
the persisted identity instead of an optional display annotation.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass


_EFFORTS = {"none", "minimal", "low", "medium", "high", "xhigh", "max"}


@dataclass(frozen=True)
class ReasoningConfig:
    effort: str | None = None
    max_tokens: int | None = None
    exclude: bool = True

    def __post_init__(self) -> None:
        if self.effort is not None and self.effort not in _EFFORTS:
            raise ValueError(f"unsupported reasoning effort: {self.effort}")
        if self.effort is not None and self.max_tokens is not None:
            raise ValueError("reasoning effort and max_tokens are mutually exclusive")
        if self.max_tokens is not None and self.max_tokens <= 0:
            raise ValueError("reasoning max_tokens must be positive")

    @property
    def slug(self) -> str:
        if self.max_tokens is not None:
            return f"r{self.max_tokens}t"
        if self.effort is not None:
            return f"r-{self.effort}"
        return "r-default"

    @property
    def label(self) -> str:
        if self.max_tokens is not None:
            return f"{self.max_tokens:,} reasoning tokens"
        if self.effort is not None:
            return f"{self.effort} reasoning"
        return "provider default"

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


@dataclass(frozen=True)
class ModelVariant:
    base_key: str
    display_name: str
    provider: str
    model_id: str
    reasoning: ReasoningConfig = ReasoningConfig()
    max_output_tokens: int = 2048

    def __post_init__(self) -> None:
        if self.max_output_tokens <= 0:
            raise ValueError("max_output_tokens must be positive")

    @property
    def key(self) -> str:
        return f"{_slug(self.base_key)}--{self.reasoning.slug}--o{self.max_output_tokens}t"

    @property
    def label(self) -> str:
        return f"{self.display_name} · {self.reasoning.label}"

    def to_dict(self) -> dict[str, object]:
        return {
            "key": self.key,
            "base_key": self.base_key,
            "display_name": self.display_name,
            "label": self.label,
            "provider": self.provider,
            "model_id": self.model_id,
            "reasoning": self.reasoning.to_dict(),
            "max_output_tokens": self.max_output_tokens,
        }
