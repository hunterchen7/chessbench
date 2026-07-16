from __future__ import annotations

import json
from collections import Counter
from dataclasses import asdict

from chessbench.corpus import load_corpus
from chessbench.suite import load_suite
from scripts.build_standard_v4 import (
    ADDED_FRONTIER,
    CORE_QUOTAS,
    FRONTIER_RECEIPT,
    PARENT_SUITE,
    RETAINED_FRONTIER,
    TARGET_CORPUS,
    TARGET_SUITE,
    build,
)


def test_v4_is_a_250_item_rating_ordered_frontier_suite() -> None:
    corpus = load_corpus(TARGET_CORPUS)
    suite = load_suite(TARGET_SUITE)
    puzzles = suite.puzzles()

    assert corpus.name == suite.name == "standard-lichess-v4"
    assert corpus.version == suite.version == "4.0.0"
    assert len(puzzles) == 250
    assert suite.source == f"corpus:{corpus.name}@{corpus.content_hash}"
    assert suite.items == corpus.items
    assert puzzles == sorted(puzzles, key=lambda puzzle: (puzzle.rating, puzzle.id))
    assert Counter(
        next(
            f"{low}-{high - 1}"
            for low, high, _ in CORE_QUOTAS
            if low <= puzzle.rating < high
        )
        for puzzle in puzzles
        if puzzle.rating < 3000
    ) == Counter({f"{low}-{high - 1}": count for low, high, count in CORE_QUOTAS})
    assert sum(3000 <= puzzle.rating < 3200 for puzzle in puzzles) == 50


def test_v4_retains_v3_frontier_and_adds_25_disjoint_positions() -> None:
    v3 = load_suite(PARENT_SUITE)
    v4 = load_suite(TARGET_SUITE)
    old_frontier = {
        puzzle.id for puzzle in v3.puzzles() if 3000 <= puzzle.rating < 3200
    }
    new_frontier = {
        puzzle.id for puzzle in v4.puzzles() if 3000 <= puzzle.rating < 3200
    }

    assert len(old_frontier) == RETAINED_FRONTIER
    assert old_frontier <= new_frontier
    assert len(new_frontier - old_frontier) == ADDED_FRONTIER
    assert all(
        puzzle.nb_plays > 500
        and puzzle.rating_deviation < 110
        and puzzle.popularity >= 85
        and puzzle.game_url.startswith("https://lichess.org/")
        for puzzle in v4.puzzles()
        if 3000 <= puzzle.rating < 3200
    )
    assert len({puzzle.game_url.split("#")[0] for puzzle in v4.puzzles()}) == 250


def test_frontier_receipt_matches_the_new_v4_membership() -> None:
    receipt = json.loads(FRONTIER_RECEIPT.read_text(encoding="utf-8"))
    additions = {str(item["id"]) for item in receipt["items"]}
    v3_ids = {puzzle.id for puzzle in load_suite(PARENT_SUITE).puzzles()}
    v4_ids = {puzzle.id for puzzle in load_suite(TARGET_SUITE).puzzles()}

    assert receipt["schema"] == "chessbench.standard_frontier_additions.v1"
    assert receipt["eligible_after_disjointness"] >= ADDED_FRONTIER
    assert len(additions) == ADDED_FRONTIER
    assert additions.isdisjoint(v3_ids)
    assert additions <= v4_ids


def test_committed_v4_matches_deterministic_builder() -> None:
    corpus, suite = build()
    assert asdict(corpus) == json.loads(TARGET_CORPUS.read_text(encoding="utf-8"))
    assert asdict(suite) == json.loads(TARGET_SUITE.read_text(encoding="utf-8"))
