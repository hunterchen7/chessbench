#!/usr/bin/env python3
"""Audit a pinned rated pool for alternate final-ply checkmates.

This audit is engine-free and reproducible. At the final solver position for
each puzzle, it enumerates every legal move with python-chess and records the
puzzles where a mating move exists in addition to the frozen source move.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import chess

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from chessbench.rated_pool import iter_rated_pool, load_rated_pool_manifest  # noqa: E402
from chessbench.tasks.puzzles import Puzzle  # noqa: E402


DEFAULT_MANIFEST = ROOT / "corpora/pools/rated-lichess-v1.manifest.json"
DEFAULT_OUTPUT = ROOT / "corpora/pools/rated-lichess-v1.alternate-mates.json"


def _is_mate(board: chess.Board, move: chess.Move) -> bool:
    board.push(move)
    try:
        return board.is_checkmate()
    finally:
        board.pop()


def alternate_final_mates(puzzle: Puzzle) -> dict[str, object] | None:
    """Describe alternate legal mates on the puzzle's final solver ply."""
    if len(puzzle.moves) < 2 or len(puzzle.moves) % 2:
        raise ValueError(f"{puzzle.id}: solution does not end on a solver ply")

    board = chess.Board(puzzle.fen)
    for uci in puzzle.moves[:-1]:
        move = chess.Move.from_uci(uci)
        if move not in board.legal_moves:
            raise ValueError(f"{puzzle.id}: illegal source move {uci}")
        board.push(move)

    canonical = puzzle.moves[-1]
    canonical_move = chess.Move.from_uci(canonical)
    if canonical_move not in board.legal_moves:
        raise ValueError(f"{puzzle.id}: illegal final source move {canonical}")

    mating_moves = sorted(move.uci() for move in board.legal_moves if _is_mate(board, move))
    alternates = [move for move in mating_moves if move != canonical]
    if not alternates:
        return None
    return {
        "puzzle_id": puzzle.id,
        "rating": puzzle.rating,
        "solver_ply": puzzle.num_solver_plies(),
        "canonical_move": canonical,
        "canonical_is_mate": canonical in mating_moves,
        "alternate_mating_moves": alternates,
    }


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def audit(manifest_path: Path) -> dict[str, object]:
    manifest = load_rated_pool_manifest(manifest_path)
    findings: list[dict[str, object]] = []
    scanned = 0
    for puzzle in iter_rated_pool(manifest_path, verify_artifact=False):
        scanned += 1
        finding = alternate_final_mates(puzzle)
        if finding is not None:
            findings.append(finding)
    findings.sort(key=lambda item: str(item["puzzle_id"]))
    return {
        "schema": "chessbench.rated_puzzle_alternate_mates.v1",
        "pool": {
            "name": manifest["name"],
            "version": manifest["version"],
            "content_hash": manifest["content_hash"],
            "items": manifest["items"],
        },
        "policy": {
            "rule": "accept any legal checkmate on the final solver ply",
            "engine": "none",
            "implementation": "python-chess legal move enumeration",
        },
        "summary": {
            "puzzles_scanned": scanned,
            "puzzles_with_alternate_final_mates": len(findings),
            "alternate_final_mating_moves": sum(
                len(item["alternate_mating_moves"]) for item in findings
            ),
        },
        "puzzles": findings,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--check", action="store_true", help="verify --out is current")
    args = parser.parse_args()

    document = audit(args.manifest)
    rendered = json.dumps(document, indent=1) + "\n"
    if args.check:
        if not args.out.is_file() or args.out.read_text(encoding="utf-8") != rendered:
            print(f"stale alternate-mate audit: {args.out}", file=sys.stderr)
            return 1
    else:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(rendered, encoding="utf-8")

    summary = document["summary"]
    assert isinstance(summary, dict)
    print(
        f"{summary['puzzles_scanned']:,} puzzles; "
        f"{summary['puzzles_with_alternate_final_mates']:,} have alternate final mates; "
        f"sha256:{_sha256(args.out)[:20]}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
