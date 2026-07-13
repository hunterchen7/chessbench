"""Board utilities: strict move parsing, legality, and board rendering.

This is the ground-truth layer. Every move an agent produces is validated here
with python-chess so that legality is never decided by a lenient string match --
that strictness is the whole point of measuring an LLM's illegal-move rate.
"""

from __future__ import annotations

import re

import chess

# A loose token that could be a UCI move (e2e4, e7e8q) or SAN (Nf3, exd8=Q+, O-O).
_MOVE_TOKEN = re.compile(
    r"""
    (?:
        [a-h][1-8][a-h][1-8][qrbn]?     # UCI, optional promotion suffix
      | O-O-O | O-O | 0-0-0 | 0-0       # castling
      | (?:[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBNqrbn])?[+#]?)  # SAN
    )
    """,
    re.VERBOSE,
)


def render_ascii(board: chess.Board) -> str:
    """8x8 grid with rank/file labels. Cheap hedge against FEN tokenization issues."""
    rows = []
    for rank in range(7, -1, -1):
        cells = []
        for file in range(8):
            piece = board.piece_at(chess.square(file, rank))
            cells.append(piece.symbol() if piece else ".")
        rows.append(f"{rank + 1} " + " ".join(cells))
    rows.append("  a b c d e f g h")
    return "\n".join(rows)


def render_unicode(board: chess.Board) -> str:
    """Same grid but with figurine glyphs (some models read these better)."""
    return board.unicode(borders=False, empty_square=".")


_PIECE_ORDER = [chess.KING, chess.QUEEN, chess.ROOK, chess.BISHOP, chess.KNIGHT, chess.PAWN]


def render_piece_list(board: chess.Board) -> str:
    """Explicit per-side piece listing, e.g. 'White: Ke1, Qd1, Ra1, ...'."""

    def side(color: bool) -> str:
        items: list[str] = []
        for ptype in _PIECE_ORDER:
            squares = sorted(board.pieces(ptype, color))
            for sq in squares:
                letter = chess.piece_symbol(ptype).upper()
                items.append(f"{letter}{chess.square_name(sq)}")
        return ", ".join(items) if items else "(none)"

    return f"White: {side(chess.WHITE)}\nBlack: {side(chess.BLACK)}"


def parse_move(board: chess.Board, text: str) -> chess.Move | None:
    """Parse a single move string as SAN or UCI, returning it only if *legal*.

    Returns None for anything unparseable or illegal in `board`. Accepts a bare
    token; use `extract_move` first if the text may contain reasoning.
    """
    if not text:
        return None
    token = text.strip().strip(".").strip()

    # UCI first: unambiguous given the board.
    try:
        mv = chess.Move.from_uci(token.lower())
        if mv in board.legal_moves:
            return mv
    except (ValueError, chess.InvalidMoveError):
        pass

    # SAN: parse_san raises on illegal/ambiguous/unparseable moves.
    for candidate in (token, token.replace("0", "O")):  # tolerate 0-0 castling
        try:
            return board.parse_san(candidate)
        except (ValueError, chess.InvalidMoveError, chess.IllegalMoveError, chess.AmbiguousMoveError):
            continue
    return None


def extract_move(board: chess.Board, text: str) -> tuple[chess.Move | None, str | None]:
    """Pull the model's intended move out of a free-form response.

    Strategy: prefer an explicitly tagged answer (``move: e4`` / ``final: Nf3`` /
    fenced ``\\boxed{...}``); otherwise scan tokens and return the FIRST that is a
    legal move. Returns (move, matched_token). move is None if nothing legal found.
    """
    if not text:
        return None, None

    # 1) Explicit answer markers win, if present and legal.
    for pat in (
        r"(?:final answer|final move|answer|move|play|best move)\s*[:=]\s*([^\s,.;]+)",
        r"\\boxed\{([^}]+)\}",
        r"<answer>\s*([^<]+?)\s*</answer>",
    ):
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            mv = parse_move(board, m.group(1))
            if mv is not None:
                return mv, m.group(1).strip()

    # 2) Otherwise, first legal-looking token that actually validates.
    for m in _MOVE_TOKEN.finditer(text):
        tok = m.group(0)
        mv = parse_move(board, tok)
        if mv is not None:
            return mv, tok
    return None, None


def extract_move_sequence(start_board: chess.Board, text: str) -> list[chess.Move]:
    """Replay the longest legal prefix of move tokens found in `text`.

    Used for composed problems whose answer is a whole line (helpmate, series,
    proof game). Tolerates move numbers and SAN/UCI mixing; stops at the first
    token that is not a legal continuation.
    """
    board = start_board.copy()
    out: list[chess.Move] = []
    for match in _MOVE_TOKEN.finditer(text):
        move = parse_move(board, match.group(0))
        if move is None:
            continue
        board.push(move)
        out.append(move)
    return out


def move_tokens(text: str) -> list[str]:
    """All move-like tokens (SAN/UCI/castling) in order. For callers that must do
    their own replay (e.g. series-movers, where the opponent passes)."""
    return [m.group(0) for m in _MOVE_TOKEN.finditer(text)]


def legal_moves_san(board: chess.Board) -> list[str]:
    return [board.san(m) for m in board.legal_moves]


def legal_moves_uci(board: chess.Board) -> list[str]:
    return [m.uci() for m in board.legal_moves]
