import pytest

from chessbench.variants import ModelVariant, ReasoningConfig


def test_reasoning_budget_is_part_of_variant_identity():
    low = ModelVariant("gpt", "GPT", "openrouter", "openai/gpt", ReasoningConfig(max_tokens=512))
    high = ModelVariant("gpt", "GPT", "openrouter", "openai/gpt", ReasoningConfig(max_tokens=8192))
    assert low.key != high.key
    assert "512 reasoning tokens" in low.label


def test_reasoning_effort_and_token_budget_are_exclusive():
    with pytest.raises(ValueError, match="mutually exclusive"):
        ReasoningConfig(effort="high", max_tokens=1024)


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
