from chessbench.usage import normalize_usage


def test_normalizes_openrouter_prompt_cache_usage():
    usage = normalize_usage(
        {
            "prompt_tokens": 120,
            "completion_tokens": 10,
            "prompt_tokens_details": {
                "cached_tokens": 80,
                "cache_write_tokens": 20,
            },
            "completion_tokens_details": {"reasoning_tokens": 6},
        },
        cost_usd=0.003,
        cache_discount_usd=0.001,
        cache_policy="prompt_prefix_v1",
        cache_session_id="session",
    )
    assert usage.prompt_tokens == 120
    assert usage.cache_read_tokens == 80
    assert usage.cache_write_tokens == 20
    assert usage.uncached_prompt_tokens == 20
    assert usage.reasoning_tokens == 6
    assert usage.cache_session_id == "session"


def test_normalizes_anthropic_cache_usage_without_losing_total_input():
    usage = normalize_usage(
        {
            "input_tokens": 30,
            "output_tokens": 7,
            "cache_read_input_tokens": 90,
            "cache_creation_input_tokens": 10,
        }
    )
    assert usage.prompt_tokens == 130
    assert usage.cache_read_tokens == 90
    assert usage.cache_write_tokens == 10
    assert usage.uncached_prompt_tokens == 30
    assert usage.completion_tokens == 7
