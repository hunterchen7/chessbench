#!/usr/bin/env python3
"""Build the working ten-band, type-balanced 250-item Standard v4 release."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import Counter, defaultdict
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
    standard_candidate,
    standard_frontier_candidate,
)
from chessbench.suite import Suite, freeze_puzzle_suite, save_suite  # noqa: E402
from chessbench.tasks.puzzles import Puzzle  # noqa: E402


CORPUS_PARENT = ROOT / "corpora/public/standard-lichess-v2.json"
TARGET_CORPUS = ROOT / "corpora/public/standard-lichess-v4.json"
TARGET_SUITE = ROOT / "suites/public/standard-lichess-v4.json"
SELECTION_RECEIPT = ROOT / "data/curated/standard-lichess-v4-selection.json"
DEFAULT_SOURCE = ROOT / "data/lichess_db_puzzle_2026-07-05.csv.zst"

SEED = "20260716-ten-band"
SOURCE_SHA256 = "5503bfaf5534518ffe3c4c3bb0ac1ae82350d117ad1a52947796096b75e6247e"
RATING_BANDS = (
    (600, 900),
    (900, 1200),
    (1200, 1500),
    (1500, 1800),
    (1800, 2100),
    (2100, 2400),
    (2400, 2600),
    (2600, 2800),
    (2800, 3000),
    (3000, 3200),
)
ITEMS_PER_BAND = 25
FAMILY_TARGETS = {
    "mate": 4,
    "defensive": 4,
    "quiet": 4,
    "pawn_promotion": 4,
    "endgame": 4,
    "tactical": 5,
}
FAMILY_ORDER = tuple(FAMILY_TARGETS)
REDISTRIBUTION_ORDER = (
    "tactical",
    "defensive",
    "quiet",
    "endgame",
    "pawn_promotion",
    "mate",
)


def puzzle_family(puzzle: Puzzle) -> str:
    """Assign one auditable primary family despite overlapping Lichess themes."""
    themes = set(puzzle.themes)
    if "mate" in themes:
        return "mate"
    if themes & {"defensiveMove", "equality"}:
        return "defensive"
    if themes & {"quietMove", "zugzwang"}:
        return "quiet"
    if themes & {"promotion", "advancedPawn", "underPromotion"}:
        return "pawn_promotion"
    if "endgame" in themes:
        return "endgame"
    return "tactical"


def _priority(item_id: str, band: tuple[int, int], family: str) -> str:
    low, high = band
    payload = f"standard-lichess-v4:{SEED}:{low}-{high}:{family}:{item_id}"
    return hashlib.sha256(payload.encode()).hexdigest()


def _game_key(puzzle: Puzzle) -> str:
    return puzzle.game_url.split("#", 1)[0]


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _blocked_sources() -> tuple[set[str], set[str], list[dict[str, str]]]:
    """Protect sibling tracks and evaluator-held Standard material."""
    blocked_ids: set[str] = set()
    blocked_games: set[str] = set()
    releases: list[dict[str, str]] = []
    paths = [
        *(ROOT / "corpora/public").glob("woodpecker*.json"),
        *(ROOT / "corpora/private").glob("woodpecker*.json"),
        *(ROOT / "corpora/private").glob("standard-heldout*.json"),
    ]
    for path in sorted(paths):
        corpus = load_corpus(path)
        for puzzle in corpus.puzzles():
            blocked_ids.add(puzzle.id)
            blocked_games.add(_game_key(puzzle))
        releases.append({"name": corpus.name, "content_hash": corpus.content_hash})
    return blocked_ids, blocked_games, releases


def _adapt_targets(grouped: dict[str, list[Puzzle]]) -> dict[str, int]:
    targets = {
        family: min(target, len(grouped[family]))
        for family, target in FAMILY_TARGETS.items()
    }
    deficit = ITEMS_PER_BAND - sum(targets.values())
    while deficit:
        progressed = False
        for family in REDISTRIBUTION_ORDER:
            if targets[family] >= len(grouped[family]):
                continue
            targets[family] += 1
            deficit -= 1
            progressed = True
            if deficit == 0:
                break
        if not progressed:
            raise ValueError("band does not contain 25 family-diverse candidates")
    return targets


def _select_band(
    candidates: list[Puzzle], band: tuple[int, int]
) -> tuple[list[Puzzle], dict[str, int]]:
    grouped: dict[str, list[Puzzle]] = defaultdict(list)
    for puzzle in candidates:
        grouped[puzzle_family(puzzle)].append(puzzle)
    targets = _adapt_targets(grouped)
    chosen: list[Puzzle] = []
    used_games: set[str] = set()
    for family in FAMILY_ORDER:
        ranked = sorted(
            grouped[family],
            key=lambda puzzle: (_priority(puzzle.id, band, family), puzzle.id),
        )
        available = [puzzle for puzzle in ranked if _game_key(puzzle) not in used_games]
        need = targets[family]
        if len(available) < need:
            raise ValueError(
                f"band {band} family {family} has {len(available)} source games; need {need}"
            )
        selected = available[:need]
        chosen.extend(selected)
        used_games.update(_game_key(puzzle) for puzzle in selected)
    return chosen, targets


def refresh_selection(source: Path) -> dict[str, object]:
    if _file_sha256(source) != SOURCE_SHA256:
        raise ValueError(f"source snapshot hash does not match {SOURCE_SHA256}")
    blocked_ids, blocked_games, releases = _blocked_sources()
    candidates: dict[tuple[int, int], list[Puzzle]] = defaultdict(list)
    eligible_counts: Counter[str] = Counter()
    for puzzle in iter_lichess_puzzles(source):
        if puzzle.id in blocked_ids or _game_key(puzzle) in blocked_games:
            continue
        if not (standard_candidate(puzzle) or standard_frontier_candidate(puzzle)):
            continue
        for band in RATING_BANDS:
            if band[0] <= puzzle.rating < band[1]:
                candidates[band].append(puzzle)
                eligible_counts[f"{band[0]}-{band[1] - 1}"] += 1
                break

    selected: list[Puzzle] = []
    family_counts: dict[str, dict[str, int]] = {}
    used_games: set[str] = set()
    for band in RATING_BANDS:
        available = [
            puzzle for puzzle in candidates[band] if _game_key(puzzle) not in used_games
        ]
        band_items, targets = _select_band(available, band)
        selected.extend(band_items)
        used_games.update(_game_key(puzzle) for puzzle in band_items)
        family_counts[f"{band[0]}-{band[1] - 1}"] = targets
    selected.sort(key=lambda puzzle: (puzzle.rating, puzzle.id))
    return {
        "schema": "chessbench.standard_v4_selection.v1",
        "snapshot": "2026-07-05",
        "source": source.name,
        "source_sha256": SOURCE_SHA256,
        "seed": SEED,
        "rating_bands": [list(band) for band in RATING_BANDS],
        "items_per_band": ITEMS_PER_BAND,
        "primary_family_precedence": list(FAMILY_ORDER),
        "base_family_targets": FAMILY_TARGETS,
        "family_counts": family_counts,
        "eligible_counts": dict(eligible_counts),
        "core_quality_gate": "plays>500;rd<100;popularity>=90;game_url",
        "frontier_quality_gate": "plays>500;rd<110;popularity>=85;game_url",
        "excluded_releases": releases,
        "one_puzzle_per_source_game": True,
        "items": [asdict(puzzle) for puzzle in selected],
    }


def _load_selection() -> tuple[list[Puzzle], dict[str, object]]:
    document = json.loads(SELECTION_RECEIPT.read_text(encoding="utf-8"))
    if document.get("schema") != "chessbench.standard_v4_selection.v1":
        raise ValueError("unexpected Standard v4 selection receipt schema")
    if document.get("source_sha256") != SOURCE_SHA256 or document.get("seed") != SEED:
        raise ValueError("Standard v4 selection provenance does not match the builder")
    puzzles = [Puzzle(**item) for item in document.get("items", [])]
    if len(puzzles) != 250 or len({puzzle.id for puzzle in puzzles}) != 250:
        raise ValueError("Standard v4 selection must contain 250 unique puzzles")
    if len({_game_key(puzzle) for puzzle in puzzles}) != 250:
        raise ValueError("Standard v4 selection must use one puzzle per source game")
    actual_families: dict[str, dict[str, int]] = {}
    for low, high in RATING_BANDS:
        band_items = [puzzle for puzzle in puzzles if low <= puzzle.rating < high]
        if len(band_items) != ITEMS_PER_BAND:
            raise ValueError(f"band {low}-{high - 1} must contain 25 puzzles")
        actual_families[f"{low}-{high - 1}"] = dict(
            sorted(Counter(puzzle_family(puzzle) for puzzle in band_items).items())
        )
    expected_families = {
        key: dict(sorted(value.items()))
        for key, value in document.get("family_counts", {}).items()
    }
    if actual_families != expected_families:
        raise ValueError("Standard v4 family counts do not match the selection receipt")
    return puzzles, document


def build() -> tuple[Corpus, Suite]:
    puzzles, receipt = _load_selection()
    parent_corpus = load_corpus(CORPUS_PARENT)
    corpus = Corpus(
        name="standard-lichess-v4",
        title="Standard tactics — ten-band balanced v4",
        version="4.0.0",
        track="standard",
        visibility="public",
        description=(
            "A 250-item rating-ordered Standard suite with 25 puzzles in each of "
            "ten bands and an explicit within-band mixture of puzzle families."
        ),
        item_type="puzzle",
        sources=parent_corpus.sources,
        selection={
            key: value
            for key, value in receipt.items()
            if key not in {"schema", "items"}
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
        description=(
            "A 250-position, rating-ordered Lichess tactical benchmark with exactly "
            "25 puzzles in each of ten difficulty bands. Each band targets a diverse "
            "mix of mating, defensive, quiet, pawn, endgame, and tactical ideas while "
            "retaining strict calibration and provenance gates."
        ),
        seed=20260716,
    )
    return corpus, suite


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
    parser.add_argument("--refresh-selection", action="store_true")
    args = parser.parse_args()
    if args.refresh_selection:
        receipt = refresh_selection(args.source)
        SELECTION_RECEIPT.write_text(
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
