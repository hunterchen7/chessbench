"""Proof games (a retrograde/construction genre).

A proof game asks for a legal sequence of moves from the initial position that
reaches a given target position in a specified number of plies. Unlike the
forward-search genres, this is trivial to *verify* (replay and compare) even
though finding the shortest one is hard -- which makes it a clean, cheap-to-grade
"retro" task for an LLM.
"""

from __future__ import annotations

import chess


def position_key(board: chess.Board) -> str:
    """Placement + turn + castling + en passant (ignores move counters)."""
    return " ".join(board.fen().split()[:4])


def verify_proofgame(target_fen: str, moves: list[str], n_plies: int | None = None) -> bool:
    """True if `moves` (UCI) is a legal line from the start reaching the target.

    If `n_plies` is given, the line must be exactly that length (proof games are
    "in exactly N moves").
    """
    if n_plies is not None and len(moves) != n_plies:
        return False
    board = chess.Board()
    for uci in moves:
        try:
            move = chess.Move.from_uci(uci)
        except ValueError:
            return False
        if move not in board.legal_moves:
            return False
        board.push(move)
    return position_key(board) == position_key(chess.Board(target_fen))
