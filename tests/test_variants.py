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
