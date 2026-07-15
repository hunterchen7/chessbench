#!/usr/bin/env python3
"""Build result-free dashboard fixtures from the canonical public corpora.

Run artifacts are deliberately excluded. The dashboard can therefore browse and
play the benchmark bank before any model has been evaluated, and clearing results
never destroys the task definitions.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import chess

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from chessbench.categories import categorize_puzzle
from chessbench.tasks.composed import ComposedProblem

DEFAULT_OUT = ROOT / "web" / "public" / "data" / "corpora"

RELEASES = {
    "standard": ROOT / "corpora" / "public" / "standard-public-v1.json",
    "woodpecker": ROOT / "corpora" / "public" / "woodpecker-public-v1.json",
    "esoteric": ROOT / "corpora" / "public" / "esoteric-seed-v1.json",
}


def _read(path: Path) -> dict[str, object]:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def _puzzle(item: dict[str, object]) -> dict[str, object]:
    moves = [str(move) for move in item["moves"]]  # type: ignore[index]
    board = chess.Board(str(item["fen"]))
    setup = chess.Move.from_uci(moves[0])
    setup_san = board.san(setup)
    board.push(setup)
    rating = int(item["rating"])
    themes = [str(theme) for theme in item.get("themes", [])]
    return {
        "puzzle_id": str(item["id"]),
        "rating": rating,
        "rating_deviation": int(item.get("rating_deviation", 0)),
        "popularity": int(item.get("popularity", 0)),
        "plays": int(item.get("nb_plays", 0)),
        "themes": themes,
        "categories": categorize_puzzle(themes, rating),
        "fen": board.fen(),
        "setup_san": setup_san,
        "solver_is_white": board.turn == chess.WHITE,
        "solution": moves[1:],
        "solution_first": moves[1] if len(moves) > 1 else None,
        "game_url": str(item.get("game_url", "")),
        "source": str(item.get("source", "lichess")),
    }


def _composed(item: dict[str, object]) -> dict[str, object]:
    problem = ComposedProblem(**item)  # type: ignore[arg-type]
    return {
        "id": problem.id,
        "kind": problem.kind,
        "label": problem.label,
        "n": problem.n,
        "fen": problem.fen,
        "goal": problem.goal,
        "solution": problem.solution,
        "themes": problem.themes,
        "answer_shape": problem.answer_shape,
        "source": problem.source,
        "provenance": problem.provenance,
        "certification": problem.certification,
    }


def _bundle(track: str, release: dict[str, object]) -> dict[str, object]:
    raw_items = release.get("items", [])
    items = (
        [_composed(item) for item in raw_items]  # type: ignore[arg-type]
        if track == "esoteric"
        else [_puzzle(item) for item in raw_items]  # type: ignore[arg-type]
    )
    return {
        "schema": "chessbench.public_corpus.v1",
        "name": release["name"],
        "title": release["title"],
        "version": release["version"],
        "track": track,
        "visibility": release["visibility"],
        "description": release["description"],
        "content_hash": release["content_hash"],
        "sources": release.get("sources", []),
        "validation": release.get("validation", {}),
        "items": items,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    index: list[dict[str, object]] = []
    for track, path in RELEASES.items():
        bundle = _bundle(track, _read(path))
        target = args.out / f"{track}.json"
        target.write_text(json.dumps(bundle, indent=1) + "\n", encoding="utf-8")
        index.append(
            {
                "track": track,
                "file": target.name,
                "name": bundle["name"],
                "title": bundle["title"],
                "items": len(bundle["items"]),  # type: ignore[arg-type]
                "content_hash": bundle["content_hash"],
            }
        )
        print(f"{track}: {len(bundle['items'])} items -> {target}")  # type: ignore[arg-type]

    (args.out / "index.json").write_text(
        json.dumps({"schema": "chessbench.public_corpus_index.v1", "corpora": index}, indent=1) + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
