#!/usr/bin/env python3
"""Freeze disjoint public and held-out suites from a full Lichess snapshot."""

from __future__ import annotations

import argparse
import hashlib
import heapq
import json
import pathlib
import secrets
import sys
from dataclasses import asdict

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from chessbench.corpus import (  # noqa: E402
    Corpus,
    CorpusSource,
    corpus_index,
    load_corpus,
    save_corpus,
    save_corpus_manifest,
)
from chessbench.sources.lichess import (  # noqa: E402
    iter_lichess_puzzles,
    standard_candidate,
    woodpecker_candidate,
)
from chessbench.suite import freeze_puzzle_suite, save_suite, save_suite_manifest  # noqa: E402
from chessbench.tasks.puzzles import Puzzle  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
STANDARD_BANDS = [(lo, lo + 400) for lo in range(600, 3000, 400)]
WOODPECKER_BANDS = [(lo, lo + 400) for lo in range(1000, 3000, 400)]


class BoundedCandidates:
    def __init__(self, bands: list[tuple[int, int]], capacity: int, *, namespace: str, seed: str):
        self.bands = bands
        self.capacity = capacity
        self.namespace = namespace
        self.seed = seed
        self.heaps: dict[int, list[tuple[int, str, Puzzle]]] = {i: [] for i in range(len(bands))}

    def add(self, puzzle: Puzzle) -> None:
        band = next(
            (index for index, (lo, hi) in enumerate(self.bands) if lo <= puzzle.rating < hi),
            None,
        )
        if band is None:
            return
        digest = hashlib.sha256(
            f"{self.namespace}:{self.seed}:{puzzle.id}".encode("utf-8")
        ).digest()
        priority = int.from_bytes(digest, "big")
        heap = self.heaps[band]
        entry = (-priority, puzzle.id, puzzle)
        if len(heap) < self.capacity:
            heapq.heappush(heap, entry)
            return
        worst_priority = -heap[0][0]
        if (priority, puzzle.id) < (worst_priority, heap[0][1]):
            heapq.heapreplace(heap, entry)

    def select(self, per_band: int, *, forbidden: set[str]) -> list[Puzzle]:
        chosen: list[Puzzle] = []
        for index, (lo, hi) in enumerate(self.bands):
            ranked = sorted(
                ((-negative, puzzle_id, puzzle) for negative, puzzle_id, puzzle in self.heaps[index]),
                key=lambda item: (item[0], item[1]),
            )
            available = [puzzle for _, _, puzzle in ranked if puzzle.id not in forbidden]
            if len(available) < per_band:
                raise ValueError(
                    f"rating band {lo}-{hi - 1} has {len(available)} unclaimed candidates; "
                    f"need {per_band}"
                )
            chosen.extend(available[:per_band])
        return sorted(chosen, key=lambda puzzle: puzzle.id)


def _load_or_create_private_seed(path: pathlib.Path) -> str:
    if path.exists():
        seed = path.read_text(encoding="utf-8").strip()
        if len(seed) < 32:
            raise ValueError(f"private seed file {path} is unexpectedly short")
        return seed
    path.parent.mkdir(parents=True, exist_ok=True)
    seed = secrets.token_hex(32)
    path.write_text(seed + "\n", encoding="utf-8")
    path.chmod(0o600)
    return seed


def _existing_public_ids(corpus_dir: pathlib.Path) -> set[str]:
    ids: set[str] = set()
    for path in corpus_dir.glob("*.json"):
        corpus = load_corpus(path)
        if corpus.item_type == "puzzle":
            ids.update(str(item["id"]) for item in corpus.items)
    return ids


def _source(snapshot: str) -> dict[str, str]:
    return asdict(
        CorpusSource(
            id="lichess-puzzles",
            title="Lichess open puzzle database",
            url="https://database.lichess.org/#puzzles",
            license="CC0-1.0",
            license_url="https://creativecommons.org/publicdomain/zero/1.0/",
            snapshot=snapshot,
            notes="Every retained Woodpecker item links to its originating titled-player game.",
        )
    )


def _selection(
    *,
    bands: list[tuple[int, int]],
    per_band: int,
    source_sha256: str,
    private_seed: str | None,
    public_seed: str,
    gate: str,
) -> dict[str, object]:
    result: dict[str, object] = {
        "algorithm": "lowest-stable-sha256-priority-within-rating-bands",
        "rating_bands": [list(band) for band in bands],
        "per_band": per_band,
        "quality_gate": gate,
        "source_sha256": source_sha256,
        "disjoint_from_all_earlier_public_and_sibling_release_items": True,
    }
    if private_seed is None:
        result["seed"] = public_seed
    else:
        result["seed_commitment"] = hashlib.sha256(private_seed.encode("utf-8")).hexdigest()
    return result


def _make_corpus(
    *,
    name: str,
    title: str,
    track: str,
    visibility: str,
    description: str,
    source: dict[str, str],
    selection: dict[str, object],
    puzzles: list[Puzzle],
) -> Corpus:
    return Corpus(
        name=name,
        title=title,
        version="1.0.0",
        track=track,  # type: ignore[arg-type]
        visibility=visibility,  # type: ignore[arg-type]
        description=description,
        item_type="puzzle",
        sources=[source],
        selection=selection,
        items=[asdict(puzzle) for puzzle in puzzles],
    )


def curate(args: argparse.Namespace) -> list[Corpus]:
    source_sha256 = hashlib.sha256(args.source.read_bytes()).hexdigest()
    private_seed = _load_or_create_private_seed(args.private_seed_file)
    existing = _existing_public_ids(args.public_corpus_dir)
    capacity_standard = max(args.public_standard_per_band, args.private_standard_per_band) * 8
    capacity_wood = max(args.public_woodpecker_per_band, args.private_woodpecker_per_band) * 8
    samplers = {
        "standard_public": BoundedCandidates(
            STANDARD_BANDS, capacity_standard, namespace="standard-lichess-v2", seed=args.public_seed
        ),
        "standard_private": BoundedCandidates(
            STANDARD_BANDS, capacity_standard, namespace="standard-heldout-v1", seed=private_seed
        ),
        "wood_public": BoundedCandidates(
            WOODPECKER_BANDS, capacity_wood, namespace="woodpecker-masters-v1", seed=args.public_seed
        ),
        "wood_private": BoundedCandidates(
            WOODPECKER_BANDS,
            capacity_wood,
            namespace="woodpecker-masters-heldout-v1",
            seed=private_seed,
        ),
    }
    scanned = 0
    for puzzle in iter_lichess_puzzles(args.source):
        scanned += 1
        if puzzle.id in existing:
            continue
        if standard_candidate(puzzle):
            samplers["standard_public"].add(puzzle)
            samplers["standard_private"].add(puzzle)
        if woodpecker_candidate(puzzle):
            samplers["wood_public"].add(puzzle)
            samplers["wood_private"].add(puzzle)
        if scanned % 500_000 == 0:
            print(f"scanned {scanned:,}", file=sys.stderr)

    claimed = set(existing)
    wood_public = samplers["wood_public"].select(args.public_woodpecker_per_band, forbidden=claimed)
    claimed.update(puzzle.id for puzzle in wood_public)
    wood_private = samplers["wood_private"].select(args.private_woodpecker_per_band, forbidden=claimed)
    claimed.update(puzzle.id for puzzle in wood_private)
    standard_public = samplers["standard_public"].select(args.public_standard_per_band, forbidden=claimed)
    claimed.update(puzzle.id for puzzle in standard_public)
    standard_private = samplers["standard_private"].select(args.private_standard_per_band, forbidden=claimed)

    source = _source(args.snapshot)
    corpora = [
        _make_corpus(
            name="standard-lichess-v2",
            title="Standard tactics — full Lichess v2",
            track="standard",
            visibility="public",
            description="High-confidence, rating-stratified orthodox tactics from the full Lichess snapshot.",
            source=source,
            selection=_selection(
                bands=STANDARD_BANDS,
                per_band=args.public_standard_per_band,
                source_sha256=source_sha256,
                private_seed=None,
                public_seed=args.public_seed,
                gate="standard_candidate_v1",
            ),
            puzzles=standard_public,
        ),
        _make_corpus(
            name="woodpecker-masters-v1",
            title="Woodpecker master-game lines — v1",
            track="woodpecker",
            visibility="public",
            description=(
                "Three-or-more-move full lines from titled-player games, with source game links "
                "and high-confidence Lichess solve statistics."
            ),
            source=source,
            selection=_selection(
                bands=WOODPECKER_BANDS,
                per_band=args.public_woodpecker_per_band,
                source_sha256=source_sha256,
                private_seed=None,
                public_seed=args.public_seed,
                gate="woodpecker_master_candidate_v1",
            ),
            puzzles=wood_public,
        ),
        _make_corpus(
            name="standard-heldout-v1",
            title="Standard tactics — held-out v1",
            track="standard",
            visibility="private",
            description="Held-out Standard membership; never export item-level data while active.",
            source=source,
            selection=_selection(
                bands=STANDARD_BANDS,
                per_band=args.private_standard_per_band,
                source_sha256=source_sha256,
                private_seed=private_seed,
                public_seed=args.public_seed,
                gate="standard_candidate_v1",
            ),
            puzzles=standard_private,
        ),
        _make_corpus(
            name="woodpecker-masters-heldout-v1",
            title="Woodpecker master-game lines — held-out v1",
            track="woodpecker",
            visibility="private",
            description="Held-out long lines from titled-player games; membership is evaluator-only.",
            source=source,
            selection=_selection(
                bands=WOODPECKER_BANDS,
                per_band=args.private_woodpecker_per_band,
                source_sha256=source_sha256,
                private_seed=private_seed,
                public_seed=args.public_seed,
                gate="woodpecker_master_candidate_v1",
            ),
            puzzles=wood_private,
        ),
    ]

    for corpus in corpora:
        corpus_dir = args.private_corpus_dir if corpus.visibility == "private" else args.public_corpus_dir
        suite_dir = args.private_suite_dir if corpus.visibility == "private" else args.public_suite_dir
        save_corpus(corpus, corpus_dir / f"{corpus.name}.json")
        suite = freeze_puzzle_suite(
            corpus.puzzles(),
            name=corpus.name,
            version=corpus.version,
            visibility=corpus.visibility,
            source_label=f"corpus:{corpus.name}@{corpus.content_hash}",
        )
        save_suite(suite, suite_dir / f"{suite.name}.json")
        if corpus.visibility == "private":
            save_corpus_manifest(corpus, args.manifest_dir / f"{corpus.name}.corpus.json")
            save_suite_manifest(suite, args.manifest_dir / f"{suite.name}.suite.json")

    public_corpora = [load_corpus(path) for path in sorted(args.public_corpus_dir.glob("*.json"))]
    (args.public_corpus_dir.parent / "index.json").write_text(
        json.dumps(corpus_index(public_corpora), indent=1) + "\n", encoding="utf-8"
    )
    return corpora


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=pathlib.Path, required=True)
    parser.add_argument("--snapshot", default="2026-07-05")
    parser.add_argument("--public-seed", default="20260714")
    parser.add_argument(
        "--private-seed-file", type=pathlib.Path, default=ROOT / "data/private/selection.seed"
    )
    parser.add_argument("--public-standard-per-band", type=int, default=50)
    parser.add_argument("--private-standard-per-band", type=int, default=50)
    parser.add_argument("--public-woodpecker-per-band", type=int, default=25)
    parser.add_argument("--private-woodpecker-per-band", type=int, default=25)
    parser.add_argument("--public-corpus-dir", type=pathlib.Path, default=ROOT / "corpora/public")
    parser.add_argument("--private-corpus-dir", type=pathlib.Path, default=ROOT / "corpora/private")
    parser.add_argument("--public-suite-dir", type=pathlib.Path, default=ROOT / "suites/public")
    parser.add_argument("--private-suite-dir", type=pathlib.Path, default=ROOT / "suites/private")
    parser.add_argument("--manifest-dir", type=pathlib.Path, default=ROOT / "corpora/manifests")
    args = parser.parse_args()
    corpora = curate(args)
    for corpus in corpora:
        print(
            f"{corpus.name}: {len(corpus.items)} items; {corpus.content_hash}; "
            f"visibility={corpus.visibility}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
