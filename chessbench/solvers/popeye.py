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
    solutions: list[list[str]]
    solution_count: int
    output_sha256: str

    def as_dict(self) -> dict[str, object]:
        return asdict(self)


def find_popeye(explicit: str | Path | None = None) -> Path | None:
    candidate = (
        str(explicit) if explicit is not None else os.environ.get("POPEYE_BIN", "")
    )
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


def long_algebraic_to_uci(token: str, *, turn: chess.Color = chess.WHITE) -> str | None:
    match = _MOVE.search(token)
    if match is None:
        return None
    source, target, promotion, queenside, kingside = match.groups()
    if queenside or kingside:
        source = "e1" if turn == chess.WHITE else "e8"
        if queenside:
            target = "c1" if turn == chess.WHITE else "c8"
        else:
            target = "g1" if turn == chess.WHITE else "g8"
    if source is None or target is None:
        return None
    promotion_uci = {"Q": "q", "R": "r", "B": "b", "S": "n"}.get(promotion or "", "")
    try:
        move = chess.Move.from_uci(source + target + promotion_uci)
    except ValueError:
        return None
    return move.uci()


def long_algebraic_tokens(text: str) -> list[str]:
    """Return Popeye/YACPDB-style move tokens in textual order."""
    return [match.group(0) for match in _MOVE.finditer(text)]


def _move_from_long_algebraic(token: str, board: chess.Board) -> chess.Move | None:
    uci = long_algebraic_to_uci(token, turn=board.turn)
    if uci is None:
        return None
    move = chess.Move.from_uci(uci)
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


def extract_solution_lines(
    output: str, fen: str, kind: StipulationKind, n: int
) -> list[list[str]]:
    """Extract exact-length cooperative/series solutions from Popeye output."""
    expected = {
        "helpmate": 2 * n,
        "series_helpmate": n + 1,
        "series_directmate": n,
    }.get(kind)
    if expected is None:
        return []
    board = chess.Board(fen)
    solutions: set[tuple[str, ...]] = set()
    for raw_line in output.splitlines():
        if not re.match(r"^\s*1\.", raw_line) or "#" not in raw_line:
            continue
        tokens: list[str] = []
        turn = board.turn
        for match in _MOVE.finditer(raw_line):
            uci = long_algebraic_to_uci(match.group(0), turn=turn)
            if uci is None:
                continue
            tokens.append(uci)
            if kind == "helpmate":
                turn = not turn
            elif kind == "series_helpmate" and len(tokens) == n:
                turn = not turn
        if len(tokens) == expected:
            solutions.add(tuple(tokens))
    return [list(line) for line in sorted(solutions)]


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
    solved = (
        "solution finished" in output.lower() and "no solution" not in output.lower()
    )
    solutions = extract_solution_lines(output, fen, kind, n)
    return PopeyeCertificate(
        executable=str(path),
        version=first_line,
        stipulation=stipulation,
        solved=solved,
        keys=keys,
        key_count=len(keys),
        unique_key=solved and len(keys) == 1,
        solutions=solutions,
        solution_count=len(solutions),
        output_sha256=hashlib.sha256(output.encode("utf-8")).hexdigest(),
    )
