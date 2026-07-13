"""Categorization: difficulty tiers and theme->dimension bucketing."""

from chessbench.categories import categorize_composed, categorize_puzzle, difficulty_tier


def test_difficulty_tiers():
    assert difficulty_tier(800) == "beginner"
    assert difficulty_tier(1200) == "novice"
    assert difficulty_tier(1600) == "intermediate"
    assert difficulty_tier(2000) == "advanced"
    assert difficulty_tier(2400) == "expert"
    assert difficulty_tier(3000) == "master"


def test_categorize_puzzle_buckets_themes():
    cats = categorize_puzzle(["endgame", "fork", "backRankMate", "mate", "short", "mateIn2"], rating=1750)
    assert cats["tier"] == ["intermediate"]
    assert "endgame" in cats["phase"]
    assert "fork" in cats["motif"]
    assert "backRankMate" in cats["mate_pattern"] and "mateIn2" in cats["mate_pattern"]
    assert "mate" in cats["goal"]
    assert "short" in cats["length"]


def test_categorize_puzzle_omits_empty_dimensions():
    cats = categorize_puzzle([], rating=900)
    assert cats == {"tier": ["beginner"]}  # only the tier when there are no themes


def test_categorize_composed():
    assert categorize_composed("selfmate") == {"genre": ["selfmate"], "family": ["composed"]}
    assert categorize_composed("series_helpmate")["genre"] == ["series"]
    assert categorize_composed("proofgame")["genre"] == ["retrograde"]
