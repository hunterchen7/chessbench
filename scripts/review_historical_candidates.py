#!/usr/bin/env python3
"""Create a reproducible engine-review receipt for staged historical lines.

This script is for offline corpus curation only. The evaluated language model is
never given an engine or any other tool. Engine agreement at a fixed node budget
is evidence for editorial review, not proof that a variation is uniquely forced.
"""

from __future__ import annotations

import argparse
import json
import pathlib
from datetime import datetime, timezone

import chess
import chess.engine

ROOT = pathlib.Path(__file__).resolve().parents[1]


def _score(info: dict[str, object], turn: chess.Color) -> int | None:
    score = info.get("score")
    if not isinstance(score, chess.engine.PovScore):
        return None
    return score.pov(turn).score(mate_score=100_000)


def review(
    paths: list[pathlib.Path],
    *,
    engine_path: pathlib.Path,
    nodes: int,
    multipv: int,
) -> dict[str, object]:
    reviews: list[dict[str, object]] = []
    with chess.engine.SimpleEngine.popen_uci(str(engine_path)) as engine:
        engine_name = dict(engine.id)
        for path in paths:
            document = json.loads(path.read_text(encoding="utf-8"))
            for candidate in document["candidates"]:
                board = chess.Board(candidate["fen"])
                board.push(chess.Move.from_uci(candidate["setup_uci"]))
                plies: list[dict[str, object]] = []
                solver_first_choice = True
                for index, token in enumerate(candidate["moves"]):
                    expected = chess.Move.from_uci(token)
                    infos = engine.analyse(
                        board,
                        chess.engine.Limit(nodes=nodes),
                        multipv=multipv,
                    )
                    ranked = infos if isinstance(infos, list) else [infos]
                    choices = [
                        info["pv"][0]
                        for info in ranked
                        if isinstance(info.get("pv"), list) and info["pv"]
                    ]
                    rank = choices.index(expected) + 1 if expected in choices else None
                    is_solver = index % 2 == 0
                    if is_solver and rank != 1:
                        solver_first_choice = False
                    plies.append(
                        {
                            "ply": index + 1,
                            "side": "white" if board.turn == chess.WHITE else "black",
                            "role": "solver" if is_solver else "defense",
                            "expected_uci": token,
                            "expected_rank": rank,
                            "top_uci": choices[0].uci() if choices else None,
                            "top_score_cp_for_side_to_move": _score(ranked[0], board.turn)
                            if ranked
                            else None,
                        }
                    )
                    board.push(expected)
                reviews.append(
                    {
                        "id": candidate["id"],
                        "source_bank": path.name,
                        "solver_move_is_engine_first_choice_at_every_turn": solver_first_choice,
                        "plies": plies,
                    }
                )
    return {
        "schema": "chessbench.historical_engine_review.v1",
        "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "engine": engine_name,
        "engine_path": str(engine_path),
        "nodes_per_ply": nodes,
        "multipv": multipv,
        "scope": (
            "Offline curation receipt only; fixed-node agreement is not a uniqueness proof "
            "and the benchmarked model receives no tools."
        ),
        "reviews": reviews,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine", type=pathlib.Path, required=True)
    parser.add_argument("--nodes", type=int, default=100_000)
    parser.add_argument("--multipv", type=int, default=5)
    parser.add_argument("--out", type=pathlib.Path, required=True)
    parser.add_argument(
        "paths",
        nargs="*",
        type=pathlib.Path,
        default=sorted((ROOT / "data/curated/candidates").glob("*.json")),
    )
    args = parser.parse_args()
    if args.nodes <= 0 or args.multipv <= 0:
        parser.error("--nodes and --multipv must be positive")
    receipt = review(
        args.paths,
        engine_path=args.engine,
        nodes=args.nodes,
        multipv=args.multipv,
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(receipt, indent=1) + "\n", encoding="utf-8")
    print(f"reviewed {len(receipt['reviews'])} candidates -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
