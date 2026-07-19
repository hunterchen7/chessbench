"""Release checks for the randomized rated-session puzzle pool."""

from __future__ import annotations

import json
import pathlib
from collections import Counter

from chessbench.rated_pool import (
    RATED_LICHESS_V1_BANDS,
    iter_rated_pool,
    load_rated_pool_manifest,
    rated_pool_band,
)


ROOT = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "corpora/pools/rated-lichess-v1.manifest.json"
INDEX = ROOT / "corpora/pools/rated-lichess-v1.index.json"


def test_rated_pool_is_content_addressed_and_exact() -> None:
    document = load_rated_pool_manifest(MANIFEST)
    assert document["name"] == "rated-lichess-v1"
    assert document["items"] == 100_000
    assert str(document["content_hash"]).startswith("sha256:")
    assert document["validation"]["valid"] is True
    assert document["validation"]["unique_ids"] == 100_000
    assert document["validation"]["unique_source_games"] == 100_000


def test_repo_index_lists_every_pinned_puzzle_id_and_rating() -> None:
    document = json.loads(INDEX.read_text(encoding="utf-8"))
    assert document["schema"] == "chessbench.rated_puzzle_pool_index.v1"
    assert document["pool"]["content_hash"] == "sha256:c0f866e19b180bf5169c"
    assert document["columns"] == ["puzzle_id", "rating"]
    assert len(document["puzzles"]) == 100_000
    assert len({puzzle_id for puzzle_id, _rating in document["puzzles"]}) == 100_000
    assert all(400 <= rating < 3_200 for _puzzle_id, rating in document["puzzles"])
    assert document["puzzles"] == [
        [puzzle.id, puzzle.rating]
        for puzzle in iter_rated_pool(MANIFEST, verify_artifact=False)
    ]


def test_every_rated_pool_item_meets_its_published_gate() -> None:
    counts: Counter[int] = Counter()
    ids: set[str] = set()
    games: set[str] = set()
    for puzzle in iter_rated_pool(MANIFEST, verify_artifact=False):
        band = rated_pool_band(puzzle.rating)
        assert band is not None
        assert band.accepts(puzzle)
        assert puzzle.id not in ids
        assert puzzle.game_url.split("#", 1)[0] not in games
        ids.add(puzzle.id)
        games.add(puzzle.game_url.split("#", 1)[0])
        counts[band.low] += 1
    assert len(ids) == 100_000
    assert counts == Counter({band.low: band.target for band in RATED_LICHESS_V1_BANDS})
