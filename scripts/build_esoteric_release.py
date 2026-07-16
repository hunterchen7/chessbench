#!/usr/bin/env python3
"""Build the current public Esoteric catalogue and its exact runnable suite.

The immutable v1 seed remains available for reproducing old results.  This
builder layers only records that pass the rich public curation gate onto that
base, preserving the distinction between public tasks and the private review
pool.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
from dataclasses import asdict

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from chessbench.corpus import (  # noqa: E402
    Corpus,
    corpus_index,
    load_corpus,
    save_corpus,
)
from chessbench.esoteric_curation import (  # noqa: E402
    load_curation_records,
    validate_curation_record,
)
from chessbench.suite import Suite, freeze_composed_suite, save_suite  # noqa: E402
from chessbench.tasks.composed import ComposedProblem  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
BASE_CORPUS = ROOT / "corpora" / "public" / "esoteric-seed-v1.json"
CURATION_INPUTS = (
    ROOT / "data" / "curated" / "esoteric" / "seed-selfmate-kopaev-1996.json",
)
CORPUS_OUT = ROOT / "corpora" / "public" / "esoteric-seed-v2.json"
SUITE_OUT = ROOT / "suites" / "public" / "esoteric-seed-v2.json"
SEED = 20260716

KIND_BY_GENRE = {
    "selfmate": "selfmate",
    "reflexmate": "reflexmate",
    "helpmate": "helpmate",
    "series_selfmate": "series_selfmate",
    "series_helpmate": "series_helpmate",
    "seriesmate": "series_directmate",
    "retro_proofgame": "proofgame",
    "artistic_directmate": "directmate",
}


def _problem(record: dict[str, object]) -> ComposedProblem:
    blockers = validate_curation_record(record, public_gate=True)
    if blockers:
        raise ValueError("; ".join(blockers))
    genre = str(record["genre"])
    raw_themes = record["themes"]
    raw_solution = record["solution"]
    solution_length = record["solution_length"]
    assert isinstance(raw_themes, list)
    assert isinstance(raw_solution, list)
    assert isinstance(solution_length, (int, float)) and not isinstance(
        solution_length, bool
    )
    themes = [str(value) for value in raw_themes]
    for tag in (genre, str(record["difficulty_band"])):
        if tag not in themes:
            themes.append(tag)
    database_ids = record["database_ids"]
    assert isinstance(database_ids, dict)
    source_id = next(iter(database_ids.values()), record["id"])
    return ComposedProblem(
        id=str(record["id"]),
        fen=str(record["fen"]),
        kind=KIND_BY_GENRE[genre],  # type: ignore[arg-type]
        n=int(solution_length),
        solution=[str(value) for value in raw_solution],
        themes=themes,
        source=f"yacpdb:{source_id}",
        provenance={
            "composer": record["composer"],
            "publication": record["publication"],
            "publication_date": record["publication_date"],
            "publication_identifier": record.get("publication_identifier", ""),
            "source_url": record["source_url"],
            "database_ids": database_ids,
            "stipulation": record["stipulation"],
            "difficulty_band": record["difficulty_band"],
            "central_idea": record["central_idea"],
            "selection_rationale": record["selection_rationale"],
            "complete_solution_tree": record["complete_solution_tree"],
            "variations": record["variations"],
            "rights_status": record["rights_status"],
            "rights_basis": record["rights_basis"],
        },
        certification={
            "validation_engine": record["validation_engine"],
            "validation_version": record["validation_version"],
            "validation_status": record["validation_status"],
            "validation_output": record["validation_output"],
            "independent_verification": record["independent_verification"],
        },
    )


def build(
    *,
    base_path: pathlib.Path = BASE_CORPUS,
    curation_inputs: tuple[pathlib.Path, ...] = CURATION_INPUTS,
    corpus_out: pathlib.Path = CORPUS_OUT,
    suite_out: pathlib.Path = SUITE_OUT,
) -> tuple[Corpus, Suite]:
    base = load_corpus(base_path)
    curated: list[ComposedProblem] = []
    for path in curation_inputs:
        for record in load_curation_records(path):
            if not validate_curation_record(record, public_gate=True):
                curated.append(_problem(record))

    base_problems = base.composed_problems()
    ids = {problem.id for problem in base_problems}
    additions = sorted(
        (problem for problem in curated if problem.id not in ids),
        key=lambda problem: problem.id,
    )
    corpus = Corpus(
        name="esoteric-seed-v2",
        title="Esoteric stipulations — seed v2",
        version="2.0.0",
        track="esoteric",
        visibility="public",
        description=(
            "A development catalogue of native-verifier-checked compositions, "
            "now including a fully sourced, independently certified historical "
            "selfmate admitted through the v2 curation gate. The balanced "
            "benchmark-quality corpus remains under active review."
        ),
        item_type="composed",
        sources=[
            *base.sources,
            {
                "id": "yacpdb-owner-approved-seed",
                "title": "YACPDB record 438993 — Kopaev, Suomen Shakki 2899",
                "url": "https://www.yacpdb.org/#438993",
                "license": "Project-owner-approved public benchmark inclusion with attribution",
                "license_url": "https://www.yacpdb.org/#438993",
                "snapshot": "record recovered and independently verified 2026-07-16",
                "notes": "Only records passing ChessBench's public curation gate are promoted.",
            },
        ],
        selection={
            "algorithm": "immutable-v1-base-plus-public-gate-passing-curation-records",
            "base_corpus": f"{base.name}@{base.content_hash}",
            "curation_inputs": [
                str(path.relative_to(ROOT)) for path in curation_inputs
            ],
            "public_admission_gate": "chessbench.esoteric_curation.v1",
            "accepted_curation_records": [problem.id for problem in additions],
            "excluded_kinds": ["study"],
            "reason": "interactive study adjudication is not yet frozen",
        },
        items=[asdict(problem) for problem in [*base_problems, *additions]],
    )
    save_corpus(corpus, corpus_out)
    suite = freeze_composed_suite(
        corpus.composed_problems(),
        name=corpus.name,
        version=corpus.version,
        source_label=f"corpus:{corpus.name}@{corpus.content_hash}",
        seed=SEED,
    )
    save_suite(suite, suite_out)

    corpus_dir = corpus_out.parent
    indexed = [load_corpus(path) for path in sorted(corpus_dir.glob("*.json"))]
    (corpus_dir.parent / "index.json").write_text(
        json.dumps(corpus_index(indexed), indent=1) + "\n", encoding="utf-8"
    )
    return corpus, suite


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=pathlib.Path, default=BASE_CORPUS)
    parser.add_argument("--corpus-out", type=pathlib.Path, default=CORPUS_OUT)
    parser.add_argument("--suite-out", type=pathlib.Path, default=SUITE_OUT)
    args = parser.parse_args()
    corpus, suite = build(
        base_path=args.base,
        corpus_out=args.corpus_out,
        suite_out=args.suite_out,
    )
    print(
        f"{corpus.name}: {len(corpus.items)} items, {corpus.content_hash}; "
        f"suite={suite.content_hash}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
