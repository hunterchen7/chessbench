"""Adapter around the external Popeye composition solver.

Popeye is intentionally not vendored. The generator/importer proposes a
problem, ChessBench checks its stored solution, and this module supplies an
independent solution/cook certificate when ``POPEYE_BIN`` points at Popeye.
"""

from __future__ import annotations

import hashlib
import os
import re
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path

import chess

from ..types import StipulationKind

_SUPPORTED: dict[StipulationKind, str] = {
    "directmate": "#{n}",
    "selfmate": "s#{n}",
    "reflexmate": "r#{n}",
    "helpmate": "h#{n}",
    "series_helpmate": "ser-h#{n}",
    "series_directmate": "ser-#{n}",
}

_MOVE = re.compile(
    r"(?:(?:[KQRBS])?([a-h][1-8])[-*x]?([a-h][1-8])(?:=([QRBS]))?|(?:(0-0-0)|(0-0)))"
)
_KEY = re.compile(r"^\s*1\.(?!\.)(.*)$", re.MULTILINE)


@dataclass(frozen=True)
class PopeyeCertificate:
    executable: str
    version: str
    stipulation: str
    solved: bool
    keys: list[str]
    key_count: int
    unique_key: bool
    output_sha256: str

    def as_dict(self) -> dict[str, object]:
        return asdict(self)


def find_popeye(explicit: str | Path | None = None) -> Path | None:
    candidate = str(explicit) if explicit is not None else os.environ.get("POPEYE_BIN", "")
    if not candidate:
        return None
    path = Path(candidate).expanduser()
    return path if path.is_file() and os.access(path, os.X_OK) else None


def _popeye_forsyth(fen: str) -> str:
    board = chess.Board(fen)
    return board.board_fen().replace("N", "S").replace("n", "s")


def build_input(fen: str, kind: StipulationKind, n: int) -> str:
    if kind not in _SUPPORTED:
        raise ValueError(f"Popeye adapter does not support {kind!r}")
    if n < 1:
        raise ValueError("stipulation length must be positive")
    stipulation = _SUPPORTED[kind].format(n=n)
    return "\n".join(
        [
            "BeginProblem",
            "Author ChessBench private MVP",
            f"Stipulation {stipulation}",
            f"Forsyth {_popeye_forsyth(fen)}",
            "Option Variations",
            "EndProblem",
            "",
        ]
    )


def _move_from_long_algebraic(token: str, board: chess.Board) -> chess.Move | None:
    match = _MOVE.search(token)
    if match is None:
        return None
    source, target, promotion, queenside, kingside = match.groups()
    if queenside or kingside:
        source = "e1" if board.turn == chess.WHITE else "e8"
        if queenside:
            target = "c1" if board.turn == chess.WHITE else "c8"
        else:
            target = "g1" if board.turn == chess.WHITE else "g8"
    if source is None or target is None:
        return None
    promotion_uci = {"Q": "q", "R": "r", "B": "b", "S": "n"}.get(promotion or "", "")
    try:
        move = chess.Move.from_uci(source + target + promotion_uci)
    except ValueError:
        return None
    return move if move in board.legal_moves else None


def extract_keys(output: str, fen: str) -> list[str]:
    """Extract distinct legal first moves from Popeye's solution listing."""
    board = chess.Board(fen)
    keys: set[str] = set()
    for match in _KEY.finditer(output):
        move = _move_from_long_algebraic(match.group(1), board)
        if move is not None:
            keys.add(move.uci())
    return sorted(keys)


def certify(
    fen: str,
    kind: StipulationKind,
    n: int,
    *,
    executable: str | Path | None = None,
    timeout_seconds: float = 60.0,
) -> PopeyeCertificate:
    path = find_popeye(executable)
    if path is None:
        raise FileNotFoundError("set POPEYE_BIN to an executable Popeye binary")
    stipulation = _SUPPORTED[kind].format(n=n)
    completed = subprocess.run(
        [str(path)],
        input=build_input(fen, kind, n),
        text=True,
        capture_output=True,
        timeout=timeout_seconds,
        check=False,
    )
    output = completed.stdout + completed.stderr
    if completed.returncode != 0:
        raise RuntimeError(f"Popeye exited {completed.returncode}: {output[-500:]}")
    first_line = output.splitlines()[0].strip() if output.splitlines() else "unknown"
    keys = extract_keys(output, fen)
    solved = "solution finished" in output.lower() and "no solution" not in output.lower()
    return PopeyeCertificate(
        executable=str(path),
        version=first_line,
        stipulation=stipulation,
        solved=solved,
        keys=keys,
        key_count=len(keys),
        unique_key=solved and len(keys) == 1,
        output_sha256=hashlib.sha256(output.encode("utf-8")).hexdigest(),
    )
