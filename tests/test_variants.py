import pytest

from chessbench.variants import ModelVariant, ProviderRoute, ReasoningConfig


def test_reasoning_budget_is_part_of_variant_identity():
    low = ModelVariant(
        "gpt", "GPT", "openrouter", "openai/gpt", ReasoningConfig(max_tokens=512)
    )
    high = ModelVariant(
        "gpt", "GPT", "openrouter", "openai/gpt", ReasoningConfig(max_tokens=8192)
    )
    assert low.key != high.key
    assert "512 reasoning tokens" in low.label


def test_reasoning_effort_and_token_budget_are_exclusive():
    with pytest.raises(ValueError, match="mutually exclusive"):
        ReasoningConfig(effort="high", max_tokens=1024)


def test_reasoning_capture_is_a_distinct_variant_identity():
    hidden = ModelVariant(
        "minimax-m3",
        "MiniMax M3",
        "openrouter",
        "minimax/minimax-m3",
        ReasoningConfig(effort="low"),
    )
    captured = ModelVariant(
        "minimax-m3",
        "MiniMax M3",
        "openrouter",
        "minimax/minimax-m3",
        ReasoningConfig(effort="low", exclude=False),
    )

    assert hidden.key == "minimax-m3--r-low--o-provider"
    assert captured.key == "minimax-m3--r-low-captured--o-provider"
    assert captured.key != hidden.key
    assert "captured" in captured.label


def test_provider_output_limit_is_a_distinct_variant_identity():
    variant = ModelVariant(
        "qwen",
        "Qwen",
        "openrouter",
        "qwen/qwen",
        ReasoningConfig(effort="low"),
        max_output_tokens=0,
    )

    assert variant.key == "qwen--r-low--o-provider"
    assert variant.to_dict()["max_output_tokens"] == 0


def test_provider_route_is_part_of_variant_identity_without_changing_defaults():
    default = ModelVariant("glm", "GLM", "openrouter", "z-ai/glm-5.2")
    pinned = ModelVariant(
        "glm",
        "GLM",
        "openrouter",
        "z-ai/glm-5.2",
        provider_route=ProviderRoute(
            only=("z-ai",), allow_fallbacks=False, require_parameters=True
        ),
    )

    assert default.key == "glm--r-default--o-provider"
    assert pinned.key != default.key
    assert "route-only-z-ai-no-fallbacks-required-params" in pinned.key
    assert pinned.to_dict()["provider_route"] == {
        "only": ["z-ai"],
        "order": [],
        "allow_fallbacks": False,
        "require_parameters": True,
    }
