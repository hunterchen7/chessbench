"""A small opening book of balanced starting positions.

LLM games at temperature 0 are deterministic, so every game from the standard
start is identical. Seeding each pairing from a different balanced opening (and
playing it from both colors) diversifies the games without raising temperature --
the computer-chess approach to fair, varied testing.
"""

from __future__ import annotations

import chess

# Short, roughly balanced book lines in UCI (each pairing plays one from both sides).
_LINES: list[list[str]] = [
    [],                                              # standard start
    ["e2e4", "e7e5"],                                # Open game
    ["e2e4", "c7c5"],                                # Sicilian
    ["e2e4", "e7e6"],                                # French
    ["e2e4", "c7c6"],                                # Caro-Kann
    ["d2d4", "d7d5"],                                # Closed
    ["d2d4", "g8f6", "c2c4", "e7e6"],                # Indian
    ["c2c4", "e7e5"],                                # English
    ["g1f3", "d7d5"],                                # Reti
    ["e2e4", "e7e5", "g1f3", "b8c6"],                # Open, developed
]


def opening_book() -> list[tuple[str, str]]:
    """Return (name, FEN) for each book line (name is the SAN move list)."""
    out: list[tuple[str, str]] = []
    for line in _LINES:
        board = chess.Board()
        sans: list[str] = []
        for uci in line:
            move = chess.Move.from_uci(uci)
            sans.append(board.san(move))
            board.push(move)
        name = " ".join(sans) if sans else "start"
        out.append((name, board.fen()))
    return out


def opening_fens() -> list[str]:
    return [fen for _, fen in opening_book()]
