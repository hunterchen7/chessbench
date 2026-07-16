"""Provider-neutral token, prompt-cache, and cost accounting.

Providers expose the same concepts under different field names.  Keep the raw
usage object for auditability, but normalize the fields used by SQLite, exports,
and the dashboard in one place.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Mapping


def _int(value: object) -> int:
    if isinstance(value, (int, float, str)):
        try:
            return int(value)
        except (TypeError, ValueError):
            pass
    return 0


def _float(value: object) -> float:
    if isinstance(value, (int, float, str)):
        try:
            return float(value)
        except (TypeError, ValueError):
            pass
    return 0.0


@dataclass(frozen=True)
class UsageMetrics:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    reasoning_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    uncached_prompt_tokens: int = 0
    cost_usd: float = 0.0
    cache_discount_usd: float = 0.0
    cache_policy: str = "provider_default"
    cache_session_id: str | None = None

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def normalize_usage(
    usage: Mapping[str, object] | None,
    *,
    cost_usd: float = 0.0,
    cache_discount_usd: float = 0.0,
    cache_policy: str = "provider_default",
    cache_session_id: str | None = None,
) -> UsageMetrics:
    """Normalize OpenAI/OpenRouter and Anthropic usage response shapes."""

    raw = usage or {}
    prompt_details = raw.get("prompt_tokens_details")
    if not isinstance(prompt_details, Mapping):
        prompt_details = raw.get("input_tokens_details")
    if not isinstance(prompt_details, Mapping):
        prompt_details = {}
    completion_details = raw.get("completion_tokens_details")
    if not isinstance(completion_details, Mapping):
        completion_details = raw.get("output_tokens_details")
    if not isinstance(completion_details, Mapping):
        completion_details = {}

    cache_read = _int(
        prompt_details.get("cached_tokens", raw.get("cache_read_input_tokens", 0))
    )
    cache_write = _int(
        prompt_details.get(
            "cache_write_tokens", raw.get("cache_creation_input_tokens", 0)
        )
    )
    if "prompt_tokens" in raw:
        prompt = _int(raw.get("prompt_tokens"))
    elif "input_tokens" in raw:
        # Anthropic's input_tokens excludes tokens read from or written to cache.
        prompt = _int(raw.get("input_tokens")) + cache_read + cache_write
    else:
        prompt = cache_read + cache_write
    completion = _int(raw.get("completion_tokens", raw.get("output_tokens", 0)))
    reasoning = _int(
        completion_details.get("reasoning_tokens", raw.get("reasoning_tokens", 0))
    )
    uncached = max(0, prompt - cache_read - cache_write)
    return UsageMetrics(
        prompt_tokens=prompt,
        completion_tokens=completion,
        reasoning_tokens=reasoning,
        cache_read_tokens=cache_read,
        cache_write_tokens=cache_write,
        uncached_prompt_tokens=uncached,
        cost_usd=_float(cost_usd),
        cache_discount_usd=_float(cache_discount_usd),
        cache_policy=cache_policy,
        cache_session_id=cache_session_id,
    )
