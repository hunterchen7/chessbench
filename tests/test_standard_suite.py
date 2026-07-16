from __future__ import annotations

import json
from collections import Counter
from dataclasses import asdict

from chessbench.corpus import load_corpus
from chessbench.suite import load_suite
from scripts.build_standard_suite import (
    FAMILY_TARGETS,
    ITEMS_PER_BAND,
    RATING_BANDS,
    SELECTION_RECEIPT,
    TARGET_CORPUS,
    TARGET_SUITE,
    build,
    puzzle_family,
)


def test_v3_has_ten_exact_rating_bands() -> None:
    corpus = load_corpus(TARGET_CORPUS)
    suite = load_suite(TARGET_SUITE)
    puzzles = suite.puzzles()

    assert corpus.name == suite.name == "standard-lichess-v3"
    assert corpus.version == suite.version == "3.0.0"
    assert len(puzzles) == 250
    assert suite.items == corpus.items
    assert puzzles == sorted(puzzles, key=lambda puzzle: (puzzle.rating, puzzle.id))
    assert [
        sum(low <= puzzle.rating < high for puzzle in puzzles)
        for low, high in RATING_BANDS
    ] == [ITEMS_PER_BAND] * 10
    assert len({puzzle.game_url.split("#", 1)[0] for puzzle in puzzles}) == 250


def test_v3_balances_primary_puzzle_families_within_each_band() -> None:
    receipt = json.loads(SELECTION_RECEIPT.read_text(encoding="utf-8"))
    puzzles = load_suite(TARGET_SUITE).puzzles()
    for low, high in RATING_BANDS:
        key = f"{low}-{high - 1}"
        actual = Counter(
            puzzle_family(puzzle) for puzzle in puzzles if low <= puzzle.rating < high
        )
        assert dict(sorted(actual.items())) == dict(
            sorted(receipt["family_counts"][key].items())
        )
        assert sum(actual.values()) == 25
        if key != "3000-3199":
            assert actual == Counter(FAMILY_TARGETS)
    assert receipt["family_counts"]["3000-3199"] == {
        "mate": 1,
        "defensive": 5,
        "quiet": 5,
        "pawn_promotion": 4,
        "endgame": 4,
        "tactical": 6,
    }


def test_v3_preserves_quality_gates() -> None:
    for puzzle in load_suite(TARGET_SUITE).puzzles():
        assert puzzle.nb_plays > 500
        assert puzzle.game_url.startswith("https://lichess.org/")
        if puzzle.rating < 3000:
            assert puzzle.rating_deviation < 100
            assert puzzle.popularity >= 90
        else:
            assert puzzle.rating_deviation < 110
            assert puzzle.popularity >= 85


def test_committed_v3_matches_deterministic_builder() -> None:
    corpus, suite = build()
    assert asdict(corpus) == json.loads(TARGET_CORPUS.read_text(encoding="utf-8"))
    assert asdict(suite) == json.loads(TARGET_SUITE.read_text(encoding="utf-8"))
