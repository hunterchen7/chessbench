from __future__ import annotations

from scripts.build_rating_ordered_standard import SOURCE, TARGET, build
from chessbench.suite import load_suite


def test_v3_preserves_v2_membership_but_orders_by_rating() -> None:
    v2 = load_suite(SOURCE)
    v3 = load_suite(TARGET)

    v2_ids = [puzzle.id for puzzle in v2.puzzles()]
    v3_puzzles = v3.puzzles()
    v3_ids = [puzzle.id for puzzle in v3_puzzles]

    assert len(v3_ids) == 325
    assert set(v3_ids) == set(v2_ids)
    assert v3_ids != v2_ids
    assert v3_puzzles == sorted(
        v3_puzzles, key=lambda puzzle: (puzzle.rating, puzzle.id)
    )
    assert v3.content_hash != v2.content_hash


def test_committed_v3_matches_deterministic_builder() -> None:
    assert load_suite(TARGET) == build()
