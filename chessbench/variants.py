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
        visibility = "-captured" if not self.exclude else ""
        if self.max_tokens is not None:
            return f"r{self.max_tokens}t{visibility}"
        if self.effort is not None:
            return f"r-{self.effort}{visibility}"
        return f"r-default{visibility}"

    @property
    def label(self) -> str:
        if self.max_tokens is not None:
            label = f"{self.max_tokens:,} reasoning tokens"
            return label + (" (captured)" if not self.exclude else "")
        if self.effort is not None:
            label = f"{self.effort} reasoning"
            return label + (" (captured)" if not self.exclude else "")
        return "provider default" + (" reasoning captured" if not self.exclude else "")

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


@dataclass(frozen=True)
class ProviderRoute:
    """OpenRouter endpoint policy, persisted as part of participant identity."""

    only: tuple[str, ...] = ()
    order: tuple[str, ...] = ()
    allow_fallbacks: bool = True
    require_parameters: bool = False

    @property
    def is_default(self) -> bool:
        return (
            not self.only
            and not self.order
            and self.allow_fallbacks
            and not self.require_parameters
        )

    @property
    def slug(self) -> str:
        parts: list[str] = []
        if self.only:
            parts.append("only-" + "-".join(_slug(provider) for provider in self.only))
        elif self.order:
            parts.append(
                "order-" + "-".join(_slug(provider) for provider in self.order)
            )
        if not self.allow_fallbacks:
            parts.append("no-fallbacks")
        if self.require_parameters:
            parts.append("required-params")
        return "route-" + "-".join(parts) if parts else "route-default"

    @property
    def label(self) -> str:
        if self.only:
            return "/".join(self.only) + " only"
        if self.order:
            return "/".join(self.order) + " preferred"
        return "default routing"

    def to_request(self) -> dict[str, object]:
        request: dict[str, object] = {}
        if self.only:
            request["only"] = list(self.only)
        if self.order:
            request["order"] = list(self.order)
        if not self.allow_fallbacks:
            request["allow_fallbacks"] = False
        if self.require_parameters:
            request["require_parameters"] = True
        return request

    def to_dict(self) -> dict[str, object]:
        return {
            "only": list(self.only),
            "order": list(self.order),
            "allow_fallbacks": self.allow_fallbacks,
            "require_parameters": self.require_parameters,
        }


@dataclass(frozen=True)
class ModelVariant:
    base_key: str
    display_name: str
    provider: str
    model_id: str
    reasoning: ReasoningConfig = ReasoningConfig()
    max_output_tokens: int = 0
    provider_route: ProviderRoute = ProviderRoute()

    def __post_init__(self) -> None:
        if self.max_output_tokens < 0:
            raise ValueError("max_output_tokens must be non-negative")

    @property
    def key(self) -> str:
        output = (
            "o-provider"
            if self.max_output_tokens == 0
            else f"o{self.max_output_tokens}t"
        )
        base = f"{_slug(self.base_key)}--{self.reasoning.slug}--{output}"
        return (
            base
            if self.provider_route.is_default
            else f"{base}--{self.provider_route.slug}"
        )

    @property
    def label(self) -> str:
        route = (
            "" if self.provider_route.is_default else f" · {self.provider_route.label}"
        )
        return f"{self.display_name} · {self.reasoning.label}{route}"

    def to_dict(self) -> dict[str, object]:
        data: dict[str, object] = {
            "key": self.key,
            "base_key": self.base_key,
            "display_name": self.display_name,
            "label": self.label,
            "provider": self.provider,
            "model_id": self.model_id,
            "reasoning": self.reasoning.to_dict(),
            "max_output_tokens": self.max_output_tokens,
        }
        if not self.provider_route.is_default:
            data["provider_route"] = self.provider_route.to_dict()
        return data
