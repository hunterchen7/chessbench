#!/usr/bin/env python3
"""Build the initial Standard, Woodpecker, and Esoteric public corpora.

The command is deterministic: the same input files and arguments produce the
same corpus membership and content hashes.  Woodpecker is selected first and
requires at least two solver moves; Standard then excludes those IDs so the two
headline collections do not double-count positions.

For the checked-in seed release:

    python3 scripts/build_corpora.py

For a larger pool sampled from the official Lichess dump:

    python3 scripts/download_puzzles.py --per-bucket 5000 --out data/lichess_pool.csv
    python3 scripts/build_corpora.py --tactical-source data/lichess_pool.csv
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import sys
from dataclasses import asdict

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from chessbench.corpus import (  # noqa: E402
    Corpus,
    CorpusSource,
    corpus_index,
    save_corpus,
    select_stratified_puzzles,
)
from chessbench.suite import freeze_composed_suite, freeze_puzzle_suite, save_suite  # noqa: E402
from chessbench.tasks.composed import load_composed  # noqa: E402
from chessbench.tasks.puzzles import load_puzzles  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_BANDS = [(600, 1000), (1000, 1400), (1400, 1800), (1800, 2200), (2200, 2600)]


def _lichess_source(snapshot: str) -> CorpusSource:
    return CorpusSource(
        id="lichess-puzzles",
        title="Lichess open puzzle database",
        url="https://database.lichess.org/#puzzles",
        license="CC0-1.0",
        license_url="https://creativecommons.org/publicdomain/zero/1.0/",
        snapshot=snapshot,
        notes="FEN before the setup move; UCI solution begins after applying moves[0].",
    )


def _chessbench_source() -> CorpusSource:
    return CorpusSource(
        id="chessbench-original",
        title="ChessBench constructed and search-discovered compositions",
        url="https://chessbench.hunterchen.workers.dev",
        license="MIT",
        license_url="https://opensource.org/license/mit",
        snapshot="repository source_composed.py at corpus build time",
        notes="Every included solution is rechecked by the native stipulation verifier.",
    )


def _selection(
    *,
    bands: list[tuple[int, int]],
    per_band: int,
    seed: int,
    min_solver_plies: int,
    source_pool_sha256: str,
    excluded_from: str | None = None,
) -> dict[str, object]:
    value: dict[str, object] = {
        "algorithm": "stable-sha256-priority-within-rating-bands",
        "seed": seed,
        "rating_bands": [list(band) for band in bands],
        "per_band": per_band,
        "minimum_popularity": 80,
        "minimum_plays": 50,
        "minimum_solver_plies": min_solver_plies,
        "source_pool_sha256": source_pool_sha256,
    }
    if excluded_from:
        value["excluded_ids_from"] = excluded_from
    return value


def build(args: argparse.Namespace) -> list[Corpus]:
    puzzles = load_puzzles(args.tactical_source)
    source_pool_sha256 = hashlib.sha256(
        pathlib.Path(args.tactical_source).read_bytes()
    ).hexdigest()
    bands = (
        [*DEFAULT_BANDS, (2600, 3000)] if args.include_master else list(DEFAULT_BANDS)
    )
    standard_name = f"standard-{args.release}"
    woodpecker_name = f"woodpecker-{args.release}"
    candidate_problems = [
        problem
        for problem in load_composed(args.composed_source)
        if problem.kind != "study"
    ]
    # One source position appears as ser-h#2, ser-h#3, and ser-h#4.  Keep the
    # shortest stipulation so no two corpus items begin from the same state.
    problems = []
    seen_composed_positions: set[str] = set()
    for problem in sorted(candidate_problems, key=lambda item: (item.n, item.id)):
        position = " ".join(problem.fen.split()[:4])
        if position in seen_composed_positions:
            continue
        seen_composed_positions.add(position)
        problems.append(problem)
    source = asdict(_lichess_source(args.lichess_snapshot))

    woodpecker_puzzles = select_stratified_puzzles(
        puzzles,
        bands=bands,
        per_band=args.woodpecker_per_band,
        seed=args.seed,
        namespace=woodpecker_name,
        min_solver_plies=2,
    )
    woodpecker_ids = {puzzle.id for puzzle in woodpecker_puzzles}
    standard_puzzles = select_stratified_puzzles(
        puzzles,
        bands=bands,
        per_band=args.standard_per_band,
        seed=args.seed,
        namespace=standard_name,
        exclude_ids=woodpecker_ids,
    )

    standard = Corpus(
        name=standard_name,
        title=f"Standard tactics — {args.release}",
        version="1.0.0",
        track="standard",
        visibility="public",
        description=(
            "Rating-stratified orthodox tactics for move-by-move solving. "
            f"Release {args.release} is frozen from the pinned source pool recorded in its selection metadata."
        ),
        item_type="puzzle",
        sources=[source],
        selection=_selection(
            bands=bands,
            per_band=args.standard_per_band,
            seed=args.seed,
            min_solver_plies=1,
            source_pool_sha256=source_pool_sha256,
            excluded_from=woodpecker_name,
        ),
        items=[asdict(puzzle) for puzzle in standard_puzzles],
    )
    woodpecker = Corpus(
        name=woodpecker_name,
        title=f"Woodpecker full lines — {args.release}",
        version="1.0.0",
        track="woodpecker",
        visibility="public",
        description=(
            "Longer orthodox tactics requiring the entire main line in one response, including forced replies."
        ),
        item_type="puzzle",
        sources=[source],
        selection=_selection(
            bands=bands,
            per_band=args.woodpecker_per_band,
            seed=args.seed,
            min_solver_plies=2,
            source_pool_sha256=source_pool_sha256,
        ),
        items=[asdict(puzzle) for puzzle in woodpecker_puzzles],
    )
    corpora = [standard, woodpecker]
    if not args.skip_esoteric:
        esoteric_sources = [asdict(_chessbench_source()), source]
        esoteric = Corpus(
            name="esoteric-seed-v1",
            title="Esoteric stipulations — seed v1",
            version="1.0.0",
            track="esoteric",
            visibility="public",
            description=(
                "Native-solver-validated directmates, selfmates, reflexmates, helpmates, "
                "series movers, and proof games. Studies are withheld until their adjudication protocol is frozen."
            ),
            item_type="composed",
            sources=esoteric_sources,
            selection={
                "algorithm": "all-native-verifier-passing-non-study-items",
                "excluded_kinds": ["study"],
                "reason": "interactive study adjudication is not yet frozen",
                "position_deduplication": "first lowest-n item per first-four-field FEN",
                "tactical_source_pool_sha256": source_pool_sha256,
            },
            items=[
                asdict(problem)
                for problem in sorted(problems, key=lambda problem: problem.id)
            ],
        )
        corpora.append(esoteric)
    corpus_dir = pathlib.Path(args.corpus_dir)
    suite_dir = pathlib.Path(args.suite_dir)
    for corpus in corpora:
        save_corpus(corpus, corpus_dir / f"{corpus.name}.json")

    suites = [
        freeze_puzzle_suite(
            standard.puzzles(),
            name=standard.name,
            version=standard.version,
            source_label=f"corpus:{standard.name}@{standard.content_hash}",
            description=standard.description,
            seed=args.seed,
        ),
        freeze_puzzle_suite(
            woodpecker.puzzles(),
            name=woodpecker.name,
            version=woodpecker.version,
            source_label=f"corpus:{woodpecker.name}@{woodpecker.content_hash}",
            description=woodpecker.description,
            seed=args.seed,
        ),
    ]
    if not args.skip_esoteric:
        suites.append(
            freeze_composed_suite(
                esoteric.composed_problems(),
                name=esoteric.name,
                version=esoteric.version,
                source_label=f"corpus:{esoteric.name}@{esoteric.content_hash}",
                description=esoteric.description,
                seed=args.seed,
            )
        )
    for suite in suites:
        save_suite(suite, suite_dir / f"{suite.name}.json")

    # Index every release already present, not only the subset built this run.
    from chessbench.corpus import load_corpus

    indexed = [load_corpus(path) for path in sorted(corpus_dir.glob("*.json"))]
    index = corpus_index(indexed)
    (corpus_dir.parent / "index.json").write_text(
        json.dumps(index, indent=1) + "\n", encoding="utf-8"
    )
    return corpora


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--tactical-source", default=str(ROOT / "data" / "sample_puzzles.csv")
    )
    parser.add_argument(
        "--composed-source", default=str(ROOT / "data" / "composed_problems.json")
    )
    parser.add_argument("--corpus-dir", default=str(ROOT / "corpora" / "public"))
    parser.add_argument("--suite-dir", default=str(ROOT / "suites" / "public"))
    parser.add_argument(
        "--lichess-snapshot",
        default="local 500-row seed fixture; upstream date unknown",
    )
    parser.add_argument(
        "--release",
        default="seed-v1",
        help="suffix for Standard/Woodpecker corpus names, e.g. public-v1",
    )
    parser.add_argument(
        "--include-master",
        action="store_true",
        help="add a sixth 2600-2999 rating band (requires a large source pool)",
    )
    parser.add_argument(
        "--skip-esoteric",
        action="store_true",
        help="build only Standard and Woodpecker, preserving the existing Esoteric release",
    )
    parser.add_argument("--standard-per-band", type=int, default=20)
    parser.add_argument("--woodpecker-per-band", type=int, default=12)
    parser.add_argument("--seed", type=int, default=20260714)
    args = parser.parse_args()

    corpora = build(args)
    for corpus in corpora:
        print(
            f"{corpus.name}: {len(corpus.items)} items, {corpus.content_hash}, "
            f"valid={corpus.validation.get('valid')}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
