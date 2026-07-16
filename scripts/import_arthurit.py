#!/usr/bin/env python3
"""Import a ChessBase-exported Arthurit PGN into private certified storage."""

from __future__ import annotations

import argparse
import pathlib
import sys
from dataclasses import asdict

import chess

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from chessbench.corpus import Corpus, CorpusSource, save_corpus, save_corpus_manifest  # noqa: E402
from chessbench.solvers import series, stipulations  # noqa: E402
from chessbench.solvers.popeye import certify  # noqa: E402
from chessbench.sources.arthurit import ArthuritRecord, iter_arthurit_pgn  # noqa: E402
from chessbench.suite import freeze_composed_suite, save_suite, save_suite_manifest  # noqa: E402
from chessbench.tasks.composed import ComposedProblem  # noqa: E402


def normalize(
    record: ArthuritRecord, *, popeye_bin: pathlib.Path
) -> ComposedProblem | None:
    board = chess.Board(record.fen)
    certificate = certify(
        record.fen, record.kind, record.n, executable=popeye_bin, timeout_seconds=30
    )
    if not certificate.solved:
        return None
    solution: list[str] = []
    if record.kind in {"directmate", "selfmate", "reflexmate"}:
        if not certificate.unique_key:
            return None
        key = chess.Move.from_uci(certificate.keys[0])
        if record.kind == "directmate":
            valid = stipulations.verify_directmate(board, record.n, key)
        elif record.kind == "selfmate":
            valid = stipulations.verify_selfmate(board, record.n, key)
        else:
            valid = stipulations.verify_reflexmate(board, record.n, key)
        if valid:
            solution = [key.uci()]
    elif record.kind == "helpmate":
        solution = next(
            (
                line
                for line in certificate.solutions
                if stipulations.verify_helpmate_line(
                    board, record.n, [chess.Move.from_uci(token) for token in line]
                )
            ),
            [],
        )
    elif record.kind == "series_directmate":
        solution = next(
            (
                line
                for line in certificate.solutions
                if series.verify_series_directmate(
                    board, record.n, [chess.Move.from_uci(token) for token in line]
                )
            ),
            [],
        )
    elif record.kind == "series_helpmate":
        solution = next(
            (
                line
                for line in certificate.solutions
                if series.verify_series_helpmate(
                    board, record.n, [chess.Move.from_uci(token) for token in line]
                )
            ),
            [],
        )
    elif record.kind == "series_selfmate":
        solution = next(
            (
                line
                for line in certificate.solutions
                if series.verify_series_selfmate(
                    board, record.n, [chess.Move.from_uci(token) for token in line]
                )
            ),
            [],
        )
    if not solution:
        return None
    return ComposedProblem(
        id=record.id,
        fen=record.fen,
        kind=record.kind,
        n=record.n,
        solution=solution,
        themes=["arthurit", "newspaper-composition"],
        source="arthurit-private",
        provenance={
            "upstream": "arthurit",
            "headers": record.headers,
            "rights_status": "private-research-pending-review",
        },
        certification={"popeye": certificate.as_dict(), "native_verifier": True},
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "pgn", type=pathlib.Path, help="PGN exported once from the Arthurit CBH archive"
    )
    parser.add_argument("--popeye", type=pathlib.Path, required=True)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument(
        "--corpus-out",
        type=pathlib.Path,
        default=pathlib.Path("corpora/private/esoteric-arthurit-mvp-v1.json"),
    )
    parser.add_argument(
        "--suite-out",
        type=pathlib.Path,
        default=pathlib.Path("suites/private/esoteric-arthurit-mvp-v1.json"),
    )
    parser.add_argument(
        "--manifest-dir", type=pathlib.Path, default=pathlib.Path("corpora/manifests")
    )
    args = parser.parse_args()
    problems: list[ComposedProblem] = []
    rejected = 0
    for record in iter_arthurit_pgn(args.pgn):
        problem = normalize(record, popeye_bin=args.popeye)
        if problem is None:
            rejected += 1
            continue
        problems.append(problem)
        if args.limit and len(problems) >= args.limit:
            break
    if not problems:
        raise RuntimeError(
            "the PGN export produced no independently verified orthodox problems"
        )
    source = asdict(
        CorpusSource(
            id="arthurit-private-mvp",
            title="Arthurit chess problems database",
            url="https://genii.somee.com/software.html",
            license="MIT-on-download-page; archive review pending",
            license_url="https://genii.somee.com/software.html",
            snapshot="local CBH-to-PGN export",
            notes="Private MVP; source headers preserved and every item re-solved.",
        )
    )
    corpus = Corpus(
        name="esoteric-arthurit-mvp-v1",
        title="Arthurit private composition MVP",
        version="1.0.0",
        track="esoteric",
        visibility="private",
        description="Orthodox Arthurit problems independently solved after a one-time PGN export.",
        item_type="composed",
        sources=[source],
        selection={
            "algorithm": "all PGN records passing Popeye and native verification",
            "rejected": rejected,
        },
        items=[asdict(problem) for problem in problems],
    )
    save_corpus(corpus, args.corpus_out)
    suite = freeze_composed_suite(
        corpus.composed_problems(),
        name=corpus.name,
        version=corpus.version,
        visibility="private",
        source_label=f"corpus:{corpus.name}@{corpus.content_hash}",
    )
    save_suite(suite, args.suite_out)
    save_corpus_manifest(corpus, args.manifest_dir / f"{corpus.name}.corpus.json")
    save_suite_manifest(suite, args.manifest_dir / f"{suite.name}.suite.json")
    print(f"private Arthurit corpus: {len(corpus.items)} items; rejected={rejected}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
