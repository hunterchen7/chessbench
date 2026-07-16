from __future__ import annotations

import json
from chessbench.agents import LLMAgent
from chessbench.conditions import PUZZLE_SYSTEM_PROMPT
from scripts.export_prompt_catalog import OUTPUT_PATH, build_catalog


class _Model:
    name = "prompt-catalog-test"

    def generate(self, prompt: str, *, temperature: float = 0, max_tokens: int = 0) -> str:
        return "a2a3"


def test_agent_uses_canonical_puzzle_system_prompt() -> None:
    agent = LLMAgent(_Model())
    assert agent._system == PUZZLE_SYSTEM_PROMPT


def test_committed_prompt_catalog_matches_harness_builders() -> None:
    committed = json.loads(OUTPUT_PATH.read_text())
    generated = build_catalog()
    assert committed == generated
    assert [method["display_mode"] for method in committed["methods"]] == [1, 2, 3, 4]
    assert all(len(method["styles"]) == 2 for method in committed["methods"])


def test_catalog_contains_literal_deep_coach_and_provider_schema() -> None:
    catalog = build_catalog()
    deep = catalog["methods"][-1]
    move_only, rationale = deep["styles"]
    assert "Assume the opponent may capture back" in move_only["user_prompt"]
    assert move_only["provider_response_format"] is None
    assert rationale["provider_response_format"]["json_schema"]["strict"] is True
