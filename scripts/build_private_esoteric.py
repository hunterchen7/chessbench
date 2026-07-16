#!/usr/bin/env python3
"""Normalize and certify a runnable private esoteric MVP from source records."""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
from dataclasses import asdict
from subprocess import TimeoutExpired

import chess

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from chessbench.corpus import Corpus, CorpusSource, save_corpus, save_corpus_manifest  # noqa: E402
from chessbench.solvers import proofgame, series, stipulations  # noqa: E402
from chessbench.solvers.popeye import (  # noqa: E402
    certify,
    long_algebraic_to_uci,
    long_algebraic_tokens,
)
from chessbench.sources.yacpdb import algebraic_board, stipulation_length  # noqa: E402
from chessbench.suite import freeze_composed_suite, save_suite, save_suite_manifest  # noqa: E402
from chessbench.tasks.composed import ComposedProblem  # noqa: E402
from chessbench.types import StipulationKind  # noqa: E402

KINDS: tuple[StipulationKind, ...] = (
    "directmate",
    "selfmate",
    "reflexmate",
    "helpmate",
    "series_selfmate",
    "series_helpmate",
    "series_directmate",
    "proofgame",
    "study",
)


def _provenance(entry: dict[str, object]) -> dict[str, object]:
    record_id = int(str(entry["id"]))
    return {
        "upstream": "yacpdb",
        "upstream_id": record_id,
        "upstream_url": f"https://www.yacpdb.org/#/home/{record_id}",
        "authors": entry.get("authors", []),
        "publication": entry.get("source", {}),
        "stipulation": entry.get("stipulation"),
        "ash": entry.get("ash"),
        "rights_status": "private-research-pending-review",
    }


def _themes(entry: dict[str, object]) -> list[str]:
    raw = entry.get("keywords", [])
    return sorted({str(value) for value in raw}) if isinstance(raw, list) else []


def _first_key(entry: dict[str, object], board: chess.Board) -> chess.Move | None:
    solution = entry.get("solution")
    if not isinstance(solution, str):
        return None
    for token in long_algebraic_tokens(solution):
        uci = long_algebraic_to_uci(token, turn=board.turn)
        if uci is None:
            continue
        move = chess.Move.from_uci(uci)
        return move if move in board.legal_moves else None
    return None


def _series_line(
    entry: dict[str, object], board: chess.Board, expected: int
) -> list[chess.Move]:
    solution = entry.get("solution")
    if not isinstance(solution, str):
        return []
    moves: list[chess.Move] = []
    for token in long_algebraic_tokens(solution.split("{", 1)[0]):
        uci = long_algebraic_to_uci(token, turn=board.turn)
        if uci is not None:
            moves.append(chess.Move.from_uci(uci))
        if len(moves) == expected:
            break
    return moves


def _proofgame(entry: dict[str, object], n: int) -> tuple[str, list[str]] | None:
    solution = entry.get("solution")
    if not isinstance(solution, str):
        return None
    board = chess.Board()
    line: list[str] = []
    for token in long_algebraic_tokens(solution.split("{dia}", 1)[0]):
        uci = long_algebraic_to_uci(token, turn=board.turn)
        if uci is None:
            continue
        move = chess.Move.from_uci(uci)
        if move not in board.legal_moves:
            return None
        board.push(move)
        line.append(uci)
        if len(line) == n:
            break
    if len(line) != n:
        return None
    fen = board.fen(en_passant="fen")
    return (fen, line) if proofgame.verify_proofgame(fen, line, n_plies=n) else None


def normalize(
    entry: dict[str, object], kind: StipulationKind, *, popeye_bin: pathlib.Path
) -> ComposedProblem | None:
    stipulation = entry.get("stipulation")
    if not isinstance(stipulation, str):
        return None
    n = stipulation_length(kind, stipulation)
    if n is None:
        return None
    provenance = _provenance(entry)
    themes = _themes(entry)
    record_id = int(str(entry["id"]))

    if kind == "study":
        board = algebraic_board(entry, kind)
        return ComposedProblem(
            id=f"yacpdb-{record_id}",
            fen=board.fen(en_passant="fen"),
            kind=kind,
            n=0,
            goal="win" if stipulation == "+" else "draw",
            themes=themes,
            source="yacpdb-private",
            provenance=provenance,
            certification={
                "status": "source-claimed; interactive adjudication pending"
            },
        )

    if kind == "proofgame":
        result = _proofgame(entry, n)
        if result is None:
            return None
        fen, line = result
        return ComposedProblem(
            id=f"yacpdb-{record_id}",
            fen=fen,
            kind=kind,
            n=n,
            solution=line,
            themes=themes,
            source="yacpdb-private",
            provenance=provenance,
            certification={
                "native_exact_replay": True,
                "target_derived_from_upstream_solution": True,
            },
        )

    board = algebraic_board(entry, kind)
    try:
        certificate = certify(
            board.fen(en_passant="fen"),
            kind,
            n,
            executable=popeye_bin,
            timeout_seconds=15,
        )
    except (RuntimeError, TimeoutExpired):
        return None
    if not certificate.solved:
        return None

    solution: list[str]
    if kind in {"directmate", "selfmate", "reflexmate"}:
        key = _first_key(entry, board)
        if (
            key is None
            or key.uci() not in certificate.keys
            or not certificate.unique_key
        ):
            return None
        if kind == "directmate":
            valid = stipulations.verify_directmate(board, n, key)
        elif kind == "selfmate":
            valid = stipulations.verify_selfmate(board, n, key)
        else:
            valid = stipulations.verify_reflexmate(board, n, key)
        if not valid:
            return None
        solution = [key.uci()]
    elif kind == "helpmate":
        solution = next(
            (
                line
                for line in certificate.solutions
                if stipulations.verify_helpmate_line(
                    board, n, [chess.Move.from_uci(token) for token in line]
                )
            ),
            [],
        )
        if not solution:
            return None
    elif kind in {"series_helpmate", "series_selfmate"}:
        expected = n + 1
        intended = _series_line(entry, board, expected)
        candidates = [intended] + [
            [chess.Move.from_uci(token) for token in line]
            for line in certificate.solutions
        ]
        verifier = (
            series.verify_series_selfmate
            if kind == "series_selfmate"
            else series.verify_series_helpmate
        )
        moves = next((line for line in candidates if verifier(board, n, line)), [])
        if not moves:
            return None
        solution = [move.uci() for move in moves]
    elif kind == "series_directmate":
        intended = _series_line(entry, board, n)
        candidates = [intended] + [
            [chess.Move.from_uci(token) for token in line]
            for line in certificate.solutions
        ]
        moves = next(
            (
                line
                for line in candidates
                if series.verify_series_directmate(board, n, line)
            ),
            [],
        )
        if not moves:
            return None
        solution = [move.uci() for move in moves]
    else:  # pragma: no cover - exhaustive above
        return None

    return ComposedProblem(
        id=f"yacpdb-{record_id}",
        fen=board.fen(en_passant="fen"),
        kind=kind,
        n=n,
        solution=solution,
        themes=themes,
        source="yacpdb-private",
        provenance=provenance,
        certification={"popeye": certificate.as_dict(), "native_verifier": True},
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--catalog",
        type=pathlib.Path,
        default=pathlib.Path("data/private/yacpdb/catalog.json"),
    )
    parser.add_argument("--popeye", type=pathlib.Path, required=True)
    parser.add_argument("--per-kind", type=int, default=50)
    parser.add_argument(
        "--corpus-out",
        type=pathlib.Path,
        default=pathlib.Path("corpora/private/esoteric-yacpdb-mvp-v1.json"),
    )
    parser.add_argument(
        "--suite-out",
        type=pathlib.Path,
        default=pathlib.Path("suites/private/esoteric-yacpdb-mvp-v1.json"),
    )
    parser.add_argument(
        "--manifest-dir", type=pathlib.Path, default=pathlib.Path("corpora/manifests")
    )
    args = parser.parse_args()
    catalog = json.loads(args.catalog.read_text(encoding="utf-8"))
    categories = catalog["categories"]
    problems: list[ComposedProblem] = []
    rejected: dict[str, int] = {}
    for kind in KINDS:
        records = categories[kind]["records"]
        ordered = sorted(
            records,
            key=lambda entry: (
                stipulation_length(kind, str(entry.get("stipulation", ""))) or 0,
                int(entry["id"]),
            ),
        )
        accepted: list[ComposedProblem] = []
        for entry in ordered:
            problem = normalize(entry, kind, popeye_bin=args.popeye)
            if problem is not None:
                accepted.append(problem)
            if len(accepted) >= args.per_kind:
                break
        problems.extend(accepted)
        rejected[kind] = len(ordered) - len(accepted)
        print(f"{kind}: accepted {len(accepted)} / inspected {len(ordered)}")
        if len(accepted) < args.per_kind:
            raise RuntimeError(
                f"{kind} produced {len(accepted)} verified problems; need {args.per_kind}. "
                "Fetch a larger candidate catalog and retry."
            )

    source = asdict(
        CorpusSource(
            id="yacpdb-private-mvp",
            title="Yet Another Chess Problem Database private research import",
            url="https://www.yacpdb.org/",
            license="private-research-pending-review",
            license_url="https://www.yacpdb.org/",
            snapshot=str(catalog.get("fetched", "unknown")),
            notes="Unpublished private MVP; each record retains its upstream ID and publication metadata.",
        )
    )
    corpus = Corpus(
        name="esoteric-yacpdb-mvp-v1",
        title="Esoteric private MVP — YACPDB",
        version="1.0.0",
        track="esoteric",
        visibility="private",
        description="Fifty private research problems per supported esoteric category.",
        item_type="composed",
        sources=[source],
        selection={
            "algorithm": "lowest-stipulation-length-then-upstream-id passing native/Popeye gates",
            "per_kind": args.per_kind,
            "rights_status": "private-research-pending-review",
            "rejected_by_kind": rejected,
        },
        items=[
            asdict(problem)
            for problem in sorted(problems, key=lambda problem: problem.id)
        ],
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
    print(f"private corpus: {len(corpus.items)} items; {corpus.content_hash}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
