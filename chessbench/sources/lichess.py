"""Streaming access and quality gates for the Lichess puzzle database."""

from __future__ import annotations

import csv
import io
import subprocess
from contextlib import contextmanager
from pathlib import Path
from typing import IO, Iterator

from ..tasks.puzzles import Puzzle

MASTER_THEMES = frozenset({"master", "masterVsMaster", "superGM"})


@contextmanager
def lichess_rows(path: str | Path) -> Iterator[Iterator[dict[str, str]]]:
    """Yield CSV rows from a plain or zstd-compressed Lichess snapshot."""
    source = Path(path)
    process: subprocess.Popen[bytes] | None = None
    binary: IO[bytes]
    if source.suffix == ".zst":
        process = subprocess.Popen(["zstd", "-dc", str(source)], stdout=subprocess.PIPE)
        if process.stdout is None:  # pragma: no cover - subprocess contract
            raise RuntimeError("zstd did not expose stdout")
        binary = process.stdout
    else:
        binary = source.open("rb")
    text = io.TextIOWrapper(binary, encoding="utf-8", newline="")
    try:
        yield csv.DictReader(text)
    finally:
        text.close()
        if process is not None:
            return_code = process.wait()
            if return_code != 0:
                raise RuntimeError(f"zstd exited with status {return_code}")


def puzzle_from_row(row: dict[str, str]) -> Puzzle:
    return Puzzle(
        id=row["PuzzleId"],
        fen=row["FEN"],
        moves=row["Moves"].split(),
        rating=int(row["Rating"]),
        rating_deviation=int(row.get("RatingDeviation") or 0),
        popularity=int(row.get("Popularity") or 0),
        nb_plays=int(row.get("NbPlays") or 0),
        themes=(row.get("Themes") or "").split(),
        game_url=row.get("GameUrl", ""),
        opening_tags=row.get("OpeningTags", ""),
        source="lichess",
    )


def iter_lichess_puzzles(path: str | Path) -> Iterator[Puzzle]:
    with lichess_rows(path) as rows:
        for row in rows:
            try:
                yield puzzle_from_row(row)
            except (KeyError, TypeError, ValueError):
                continue


def standard_candidate(puzzle: Puzzle) -> bool:
    return (
        600 <= puzzle.rating < 3000
        and puzzle.rating_deviation <= 100
        and puzzle.popularity >= 90
        and puzzle.nb_plays >= 100
        and puzzle.num_solver_plies() >= 1
        and bool(puzzle.game_url)
    )


def woodpecker_candidate(puzzle: Puzzle) -> bool:
    themes = set(puzzle.themes)
    return (
        1000 <= puzzle.rating < 3000
        and puzzle.rating_deviation <= 100
        and puzzle.popularity >= 85
        and puzzle.nb_plays >= 50
        and puzzle.num_solver_plies() >= 3
        and bool(themes & MASTER_THEMES)
        and bool(puzzle.game_url)
    )
