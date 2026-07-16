"""Normalize a one-time PGN export of Arthurit's CBH problem database."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

import chess.pgn

from ..types import StipulationKind

_STIPULATIONS: tuple[tuple[re.Pattern[str], StipulationKind], ...] = (
    (re.compile(r"ser\s*-\s*s#\s*(\d+)", re.IGNORECASE), "series_selfmate"),
    (re.compile(r"ser\s*-\s*h#\s*(\d+)", re.IGNORECASE), "series_helpmate"),
    (re.compile(r"ser\s*-\s*#\s*(\d+)", re.IGNORECASE), "series_directmate"),
    (re.compile(r"(?<![a-z])s#\s*(\d+)", re.IGNORECASE), "selfmate"),
    (re.compile(r"(?<![a-z])r#\s*(\d+)", re.IGNORECASE), "reflexmate"),
    (re.compile(r"(?<![a-z])h#\s*(\d+)", re.IGNORECASE), "helpmate"),
    (re.compile(r"(?<![a-z])#\s*(\d+)", re.IGNORECASE), "directmate"),
)


@dataclass(frozen=True)
class ArthuritRecord:
    id: str
    fen: str
    kind: StipulationKind
    n: int
    headers: dict[str, str]


def parse_stipulation(value: str) -> tuple[StipulationKind, int] | None:
    for pattern, kind in _STIPULATIONS:
        match = pattern.search(value)
        if match:
            return kind, int(match.group(1))
    return None


def iter_arthurit_pgn(path: str | Path) -> Iterator[ArthuritRecord]:
    with Path(path).open(encoding="utf-8-sig", errors="replace") as handle:
        index = 0
        while game := chess.pgn.read_game(handle):
            index += 1
            headers = {str(key): str(value) for key, value in game.headers.items()}
            fen = headers.get("FEN")
            if not fen:
                continue
            parsed = next(
                (
                    result
                    for key in ("Stipulation", "Stip", "Problem", "Event", "Round")
                    if (result := parse_stipulation(headers.get(key, ""))) is not None
                ),
                None,
            )
            if parsed is None:
                continue
            try:
                board = chess.Board(fen)
            except ValueError:
                continue
            if not board.is_valid():
                continue
            kind, n = parsed
            digest = hashlib.sha256(
                f"{index}:{fen}:{kind}:{n}".encode("utf-8")
            ).hexdigest()[:16]
            record_id = headers.get("ProblemId") or headers.get("SourceID") or digest
            yield ArthuritRecord(
                id=f"arthurit-{record_id}", fen=fen, kind=kind, n=n, headers=headers
            )
