#!/usr/bin/env python3
"""Validate provenance-rich historical Woodpecker candidate banks.

This is deliberately a staging validator, not a uniqueness certificate. A
legal played continuation can enter the candidate bank while remaining
ineligible for the scored suite until its best-move/defense claims are reviewed.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
from collections import Counter
from typing import Iterable

import chess

ROOT = pathlib.Path(__file__).resolve().parents[1]
DIFFICULTIES = {"easy", "medium", "hard"}
COLORS = {"white": chess.WHITE, "black": chess.BLACK}


def _validate_documents(paths: Iterable[pathlib.Path]) -> dict[str, object]:
    errors: list[str] = []
    ids: set[str] = set()
    positions: dict[str, str] = {}
    difficulty: Counter[str] = Counter()
    line_status: Counter[str] = Counter()
    files = 0
    candidates = 0

    for path in paths:
        files += 1
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            errors.append(f"{path}: cannot read JSON: {exc}")
            continue
        if document.get("schema_version") != "chessbench.historical_candidates.v1":
            errors.append(f"{path}: unexpected schema_version")
        items = document.get("candidates")
        if not isinstance(items, list):
            errors.append(f"{path}: candidates must be an array")
            continue
        if document.get("candidate_count") != len(items):
            errors.append(f"{path}: candidate_count does not match array length")

        for item in items:
            candidates += 1
            if not isinstance(item, dict):
                errors.append(f"{path}: candidate {candidates} is not an object")
                continue
            candidate_id = str(item.get("id", ""))
            label = f"{path}:{candidate_id or candidates}"
            if not candidate_id:
                errors.append(f"{label}: missing id")
            elif candidate_id in ids:
                errors.append(f"{label}: duplicate id")
            ids.add(candidate_id)

            band = str(item.get("difficulty_band", ""))
            if band not in DIFFICULTIES:
                errors.append(f"{label}: difficulty_band must be easy, medium, or hard")
            difficulty.update([band])
            if not str(item.get("source_url", "")).startswith("https://"):
                errors.append(f"{label}: source_url must be HTTPS")
            confidence = str(item.get("provenance_confidence", ""))
            if confidence not in {"high", "medium", "contested"}:
                errors.append(f"{label}: invalid provenance_confidence")
            if not isinstance(item.get("forced"), bool) or not isinstance(
                item.get("engine_derived"), bool
            ):
                errors.append(f"{label}: forced and engine_derived must be booleans")
            line_status.update([str(item.get("line_provenance", "missing"))])

            try:
                board = chess.Board(str(item["fen"]))
                setup = chess.Move.from_uci(str(item["setup_uci"]))
            except (KeyError, ValueError) as exc:
                errors.append(f"{label}: invalid FEN or setup UCI: {exc}")
                continue
            if not board.is_valid():
                errors.append(f"{label}: invalid orthodox position")
            if setup not in board.legal_moves:
                errors.append(f"{label}: setup move is illegal")
                continue
            board.push(setup)
            position_key = " ".join(board.fen(en_passant="fen").split()[:4])
            if position_key in positions:
                errors.append(f"{label}: duplicate shown position from {positions[position_key]}")
            positions[position_key] = candidate_id

            solver_color = str(item.get("solver_color", ""))
            if solver_color not in COLORS or board.turn != COLORS.get(solver_color):
                errors.append(f"{label}: solver_color does not match the shown position")

            line = item.get("moves")
            if not isinstance(line, list) or not all(isinstance(move, str) for move in line):
                errors.append(f"{label}: moves must be a UCI string array")
                continue
            if len(line) < 5 or len(line) % 2 != 1:
                errors.append(f"{label}: line must end on solver move with at least 3 solver plies")
            expected_solver_plies = (len(line) + 1) // 2
            if item.get("solver_plies") != expected_solver_plies:
                errors.append(f"{label}: solver_plies does not match line length")

            computed_san: list[str] = []
            for ply, token in enumerate(line, 1):
                try:
                    move = chess.Move.from_uci(token)
                except ValueError:
                    errors.append(f"{label}: line ply {ply} is not UCI: {token}")
                    break
                if move not in board.legal_moves:
                    errors.append(f"{label}: line ply {ply} is illegal: {token}")
                    break
                computed_san.append(board.san(move))
                board.push(move)
            audit = item.get("san_audit_only")
            if audit is not None and audit != computed_san:
                errors.append(f"{label}: SAN audit does not match legal UCI replay")

    return {
        "valid": not errors,
        "files": files,
        "candidates": candidates,
        "unique_ids": len(ids),
        "unique_positions": len(positions),
        "difficulty": dict(sorted(difficulty.items())),
        "line_provenance": dict(sorted(line_status.items())),
        "errors": errors,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "paths",
        nargs="*",
        type=pathlib.Path,
        default=sorted((ROOT / "data/curated/candidates").glob("*.json")),
    )
    args = parser.parse_args()
    if not args.paths:
        parser.error("no candidate JSON files found")
    report = _validate_documents(args.paths)
    print(json.dumps(report, indent=2))
    return 0 if report["valid"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
