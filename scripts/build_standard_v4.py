#!/usr/bin/env python3
"""Build the 250-item Standard v4 suite with a larger calibrated frontier.

The v3 release is immutable because completed runs already refer to its content
hash.  V4 keeps a deterministic, progressively harder 200-item core and raises
the 3000--3199 frontier from 25 to 50 positions.  The extra frontier positions
are frozen in a small curation receipt so ordinary rebuilds do not need to scan
the six-million-row Lichess snapshot.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from dataclasses import asdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from chessbench.corpus import (  # noqa: E402
    Corpus,
    corpus_index,
    finalize_corpus,
    load_corpus,
    save_corpus,
)
from chessbench.sources.lichess import (  # noqa: E402
    iter_lichess_puzzles,
    standard_frontier_candidate,
)
from chessbench.suite import (  # noqa: E402
    Suite,
    freeze_puzzle_suite,
    load_suite,
    save_suite,
)
from chessbench.tasks.puzzles import Puzzle  # noqa: E402


PARENT_CORPUS = ROOT / "corpora/public/standard-lichess-v2.json"
PARENT_SUITE = ROOT / "suites/public/standard-lichess-v3.json"
TARGET_CORPUS = ROOT / "corpora/public/standard-lichess-v4.json"
TARGET_SUITE = ROOT / "suites/public/standard-lichess-v4.json"
FRONTIER_RECEIPT = ROOT / "data/curated/standard-lichess-v4-frontier-additions.json"
DEFAULT_SOURCE = ROOT / "data/lichess_db_puzzle_2026-07-05.csv.zst"

SEED = "20260716"
SOURCE_SHA256 = "5503bfaf5534518ffe3c4c3bb0ac1ae82350d117ad1a52947796096b75e6247e"
CORE_QUOTAS = (
    (600, 1000, 30),
    (1000, 1400, 30),
    (1400, 1800, 30),
    (1800, 2200, 35),
    (2200, 2600, 35),
    (2600, 3000, 40),
)
FRONTIER_LOW = 3000
FRONTIER_HIGH = 3200
RETAINED_FRONTIER = 25
ADDED_FRONTIER = 25


def _priority(item_id: str, namespace: str) -> str:
    return hashlib.sha256(f"{namespace}:{SEED}:{item_id}".encode("utf-8")).hexdigest()


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _select_core(parent: Suite) -> list[Puzzle]:
    selected: list[Puzzle] = []
    for low, high, count in CORE_QUOTAS:
        candidates = [
            puzzle for puzzle in parent.puzzles() if low <= puzzle.rating < high
        ]
        if len(candidates) < count:
            raise ValueError(
                f"v3 band {low}-{high - 1} has {len(candidates)} items; need {count}"
            )
        candidates.sort(
            key=lambda puzzle: (
                _priority(puzzle.id, "standard-lichess-v4-core"),
                puzzle.id,
            )
        )
        selected.extend(candidates[:count])
    return selected


def _load_frontier_additions() -> list[Puzzle]:
    document = json.loads(FRONTIER_RECEIPT.read_text(encoding="utf-8"))
    if document.get("schema") != "chessbench.standard_frontier_additions.v1":
        raise ValueError("unexpected Standard v4 frontier receipt schema")
    if document.get("source_sha256") != SOURCE_SHA256 or document.get("seed") != SEED:
        raise ValueError(
            "Standard v4 frontier receipt provenance does not match the builder"
        )
    puzzles = [Puzzle(**item) for item in document.get("items", [])]
    if (
        len(puzzles) != ADDED_FRONTIER
        or len({puzzle.id for puzzle in puzzles}) != ADDED_FRONTIER
    ):
        raise ValueError(
            f"frontier receipt must contain {ADDED_FRONTIER} unique puzzles"
        )
    if not all(standard_frontier_candidate(puzzle) for puzzle in puzzles):
        raise ValueError(
            "frontier receipt contains an item outside the v4 quality gate"
        )
    return puzzles


def build() -> tuple[Corpus, Suite]:
    parent_corpus = load_corpus(PARENT_CORPUS)
    parent_suite = load_suite(PARENT_SUITE)
    core = _select_core(parent_suite)
    retained = [
        puzzle
        for puzzle in parent_suite.puzzles()
        if FRONTIER_LOW <= puzzle.rating < FRONTIER_HIGH
    ]
    if len(retained) != RETAINED_FRONTIER:
        raise ValueError(
            f"v3 must contain {RETAINED_FRONTIER} frontier puzzles; found {len(retained)}"
        )
    additions = _load_frontier_additions()
    ids = {puzzle.id for puzzle in [*core, *retained]}
    overlap = ids & {puzzle.id for puzzle in additions}
    if overlap:
        raise ValueError(
            f"new frontier additions overlap v3 membership: {sorted(overlap)}"
        )

    puzzles = sorted(
        [*core, *retained, *additions],
        key=lambda puzzle: (puzzle.rating, puzzle.id),
    )
    corpus = Corpus(
        name="standard-lichess-v4",
        title="Standard tactics — 250-item frontier v4",
        version="4.0.0",
        track="standard",
        visibility="public",
        description=(
            "A 250-item rating-ordered Standard suite with a 200-item calibrated "
            "core and 50 high-end Lichess frontier puzzles."
        ),
        item_type="puzzle",
        sources=parent_corpus.sources,
        selection={
            "algorithm": "stable-hash core downsample plus retained and expanded frontier",
            "seed": SEED,
            "core_parent": f"suite:{parent_suite.name}@{parent_suite.content_hash}",
            "core_rating_bands": [[low, high] for low, high, _ in CORE_QUOTAS],
            "core_items_per_band": [count for _, _, count in CORE_QUOTAS],
            "core_quality_gate": "plays>500;rd<100;popularity>=90;game_url",
            "frontier_band": [FRONTIER_LOW, FRONTIER_HIGH],
            "frontier_items": RETAINED_FRONTIER + ADDED_FRONTIER,
            "frontier_retained_from_v3": RETAINED_FRONTIER,
            "frontier_added_from_full_snapshot": ADDED_FRONTIER,
            "frontier_quality_gate": "plays>500;rd<110;popularity>=85;game_url",
            "source_sha256": SOURCE_SHA256,
            "ordering": "rating-asc,id-asc",
        },
        items=[asdict(puzzle) for puzzle in puzzles],
    )
    finalize_corpus(corpus)
    suite = freeze_puzzle_suite(
        corpus.puzzles(),
        name=corpus.name,
        version=corpus.version,
        visibility=corpus.visibility,
        source_label=f"corpus:{corpus.name}@{corpus.content_hash}",
        seed=int(SEED),
    )
    return corpus, suite


def _release_ids() -> tuple[set[str], list[dict[str, str]]]:
    excluded: set[str] = set()
    releases: list[dict[str, str]] = []
    for directory in (ROOT / "corpora/public", ROOT / "corpora/private"):
        if not directory.exists():
            continue
        paths = sorted(
            [*directory.glob("standard*.json"), *directory.glob("woodpecker*.json")]
        )
        for path in paths:
            if path == TARGET_CORPUS:
                continue
            corpus = load_corpus(path)
            if corpus.item_type != "puzzle":
                continue
            excluded.update(puzzle.id for puzzle in corpus.puzzles())
            releases.append({"name": corpus.name, "content_hash": corpus.content_hash})
    return excluded, releases


def refresh_frontier(source: Path) -> dict[str, object]:
    if _file_sha256(source) != SOURCE_SHA256:
        raise ValueError(f"source snapshot hash does not match {SOURCE_SHA256}")
    excluded, releases = _release_ids()
    candidates = [
        puzzle
        for puzzle in iter_lichess_puzzles(source)
        if puzzle.id not in excluded and standard_frontier_candidate(puzzle)
    ]
    candidates.sort(
        key=lambda puzzle: (
            _priority(puzzle.id, "standard-lichess-v4-frontier"),
            puzzle.id,
        )
    )
    if len(candidates) < ADDED_FRONTIER:
        raise ValueError(
            f"only {len(candidates)} disjoint frontier candidates; need {ADDED_FRONTIER}"
        )
    chosen = candidates[:ADDED_FRONTIER]
    return {
        "schema": "chessbench.standard_frontier_additions.v1",
        "snapshot": "2026-07-05",
        "source": source.name,
        "source_sha256": SOURCE_SHA256,
        "seed": SEED,
        "namespace": "standard-lichess-v4-frontier",
        "quality_gate": "rating=3000-3199;plays>500;rd<110;popularity>=85;game_url",
        "eligible_after_disjointness": len(candidates),
        "excluded_releases": releases,
        "items": [asdict(puzzle) for puzzle in chosen],
    }


def write_release(corpus: Corpus, suite: Suite) -> None:
    save_corpus(corpus, TARGET_CORPUS)
    save_suite(suite, TARGET_SUITE)
    public_corpora = [
        load_corpus(path) for path in sorted((ROOT / "corpora/public").glob("*.json"))
    ]
    (ROOT / "corpora/index.json").write_text(
        json.dumps(corpus_index(public_corpora), indent=1) + "\n",
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument(
        "--refresh-frontier",
        action="store_true",
        help="rescan the pinned Lichess snapshot and rewrite the 25-item addition receipt",
    )
    args = parser.parse_args()
    if args.refresh_frontier:
        receipt = refresh_frontier(args.source)
        FRONTIER_RECEIPT.write_text(
            json.dumps(receipt, indent=1, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
    corpus, suite = build()
    write_release(corpus, suite)
    print(
        f"{suite.name}: {len(suite.items)} items, {suite.content_hash}; "
        f"corpus {corpus.content_hash}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
