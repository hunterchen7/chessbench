#!/usr/bin/env python3
"""Convert an existing runnable corpus into pending rich curation records.

This is intentionally a bootstrap, not an auto-curator.  Missing themes,
complete trees, source rights, central ideas, and scores remain visible review
work instead of being guessed from solver success.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

import chess

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from chessbench.corpus import load_corpus  # noqa: E402

GENRE = {
    "directmate": "artistic_directmate",
    "selfmate": "selfmate",
    "reflexmate": "reflexmate",
    "helpmate": "helpmate",
    "series_selfmate": "series_selfmate",
    "series_helpmate": "series_helpmate",
    "series_directmate": "seriesmate",
    "proofgame": "retro_proofgame",
}


def _publication(raw: object) -> tuple[str, str, int]:
    source = raw if isinstance(raw, dict) else {}
    name = str(source.get("name") or "Unknown publication — recovery required")
    date_value = source.get("date")
    raw_date = date_value if isinstance(date_value, dict) else {}
    year_match = re.search(r"\d{4}", str(raw_date.get("year", "")))
    year = int(year_match.group(0)) if year_match else 1000
    month = raw_date.get("month")
    published = f"{year:04d}" + (f"-{int(month):02d}" if month else "")
    return name, published, year


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("corpus", type=pathlib.Path)
    parser.add_argument(
        "--out",
        type=pathlib.Path,
        default=pathlib.Path("data/private/esoteric/candidate-pool.json"),
    )
    args = parser.parse_args()
    if "private" not in {part.lower() for part in args.out.parts}:
        parser.error(
            "source-derived candidate pools must stay beneath a private directory"
        )

    corpus = load_corpus(args.corpus)
    records: list[dict[str, object]] = []
    skipped: list[str] = []
    for problem in corpus.composed_problems():
        genre = GENRE.get(problem.kind)
        if genre is None:
            skipped.append(problem.id)
            continue
        provenance = problem.provenance
        publication, publication_date, publication_year = _publication(
            provenance.get("publication")
        )
        authors = provenance.get("authors", [])
        composer = (
            [str(value) for value in authors] if isinstance(authors, list) else []
        )
        certification = problem.certification
        popeye = certification.get("popeye")
        popeye_data = popeye if isinstance(popeye, dict) else {}
        version = str(popeye_data.get("version") or "not recorded")
        board = chess.Board(problem.fen)
        native_verified = bool(
            certification.get("native_verifier")
            or certification.get("native_exact_replay")
        )
        records.append(
            {
                "schema": "chessbench.esoteric_curation_record.v1",
                "id": problem.id,
                "genre": genre,
                "subtype": problem.kind,
                "fen": problem.fen,
                "side_to_move": "white" if board.turn else "black",
                "stipulation": provenance.get("stipulation") or problem.label,
                "solution": problem.solution,
                "complete_solution_tree": {
                    "notation": "uci",
                    "completeness": "pending",
                    "terminal_lines": [],
                },
                "variations": [],
                "twins": [],
                "intended_duals": [],
                "solution_length": problem.n,
                "difficulty_band": "pending",
                "themes": problem.themes,
                "central_idea": "Pending specialist annotation.",
                "selection_rationale": "Pending quality and benchmark-value review.",
                "composer": composer,
                "publication": publication,
                "publication_date": publication_date,
                "publication_year": publication_year,
                "tourney": "",
                "award": "",
                "judge": "",
                "source_url": provenance.get("upstream_url")
                or "unknown://recovery-required",
                "database_ids": {
                    str(provenance.get("upstream", "source")): provenance.get(
                        "upstream_id"
                    )
                },
                "provenance_notes": "Bootstrapped from the runnable corpus; original-source cross-check pending.",
                "generation_method": "source import",
                "validation_engine": "Popeye"
                if popeye_data
                else "ChessBench native verifier",
                "validation_version": version,
                "validation_status": "verified",
                "validation_output": certification,
                "independent_verification": {
                    "status": "verified" if native_verified else "pending",
                    "engine": "ChessBench native verifier",
                },
                "visibility": "private",
                "curator_notes": "Bootstrap defaults are not editorial judgments. Difficulty must be reassigned from solving complexity.",
                "scores": {
                    name: 0
                    for name in ("quality", "originality", "clarity", "benchmark_value")
                },
                "review_status": "pending",
                "rejection_reasons": [],
                "rights_status": provenance.get("rights_status", "pending-review"),
                "rights_basis": "Source rights require review before redistribution.",
            }
        )

    payload = {
        "schema": "chessbench.esoteric_candidate_pool.v1",
        "source_corpus": f"{corpus.name}@{corpus.content_hash}",
        "records": records,
        "skipped_non_target_ids": skipped,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(payload, indent=1, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"candidate pool: {len(records)} records; skipped non-target={len(skipped)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
