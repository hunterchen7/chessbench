"""Board utilities: strict move parsing, legality, and board rendering.

This is the ground-truth layer. Every move an agent produces is validated here
with python-chess so that legality is never decided by a lenient string match --
that strictness is the whole point of measuring an LLM's illegal-move rate.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass

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
_UCI_TOKEN = re.compile(r"^[a-h][1-8][a-h][1-8][qrbn]?$")


@dataclass(frozen=True)
class ParsedMoveResponse:
    """A recoverable move plus telemetry for the requested JSON contract."""

    move: chess.Move | None
    token: str | None
    rationale: str | None
    format_valid: bool
    format_error: str | None


@dataclass(frozen=True)
class ParsedLineResponse:
    """A recoverable variation plus telemetry for the requested JSON contract."""

    moves: list[chess.Move]
    rationale: str | None
    format_valid: bool
    format_error: str | None


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
    # Be generous: strip surrounding markdown/punctuation and trailing annotations
    # (check/mate/!/?), so "**Rd1!**", "Rd1+", and "Rd1" all reduce to one move.
    token = text.strip().strip("*`\"'.").strip()
    token = re.sub(r"[+#!?]+$", "", token).strip()

    # UCI first: unambiguous given the board (upper/mixed case tolerated via lower()).
    try:
        mv = chess.Move.from_uci(token.lower())
        if mv in board.legal_moves:
            return mv
    except (ValueError, chess.InvalidMoveError):
        pass

    # SAN: parse_san raises on illegal/ambiguous/unparseable moves. Tolerate 0-0
    # castling and a stray internal space ("R d1", "Q xd5").
    for candidate in (token, token.replace("0", "O"), token.replace(" ", "")):
        try:
            return board.parse_san(candidate)
        except (ValueError, chess.InvalidMoveError, chess.IllegalMoveError, chess.AmbiguousMoveError):
            continue
    return None


_WHY = re.compile(
    r"(?:why|because|reason(?:ing)?|explanation|idea|plan|threat)\s*[:\-]?\s*(.+)",
    re.IGNORECASE | re.DOTALL,
)


def _json_object(text: str) -> tuple[dict[str, object] | None, str | None]:
    """Decode one exact JSON object.

    Fenced JSON is decoded for move recovery but remains a format failure because
    the benchmark explicitly requests no Markdown or surrounding prose.
    """
    stripped = text.strip()
    candidate = stripped
    fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", stripped, re.IGNORECASE | re.DOTALL)
    wrapped = fenced is not None
    if fenced:
        candidate = fenced.group(1).strip()
    try:
        value = json.loads(candidate)
    except (json.JSONDecodeError, TypeError):
        return None, "response is not a JSON object"
    if not isinstance(value, dict):
        return None, "JSON response is not an object"
    return value, "response contains a Markdown fence" if wrapped else None


def parse_model_move_response(board: chess.Board, text: str) -> ParsedMoveResponse:
    """Parse the canonical ``{move, rationale}`` response without repairing it.

    A valid move is still recovered from malformed/legacy text so chess scoring
    stays independent from instruction-following. If a JSON object contains a
    ``move`` field, that field is authoritative: another move mentioned in the
    rationale can never replace an illegal selected move.
    """
    obj, wrapper_error = _json_object(text)
    if obj is not None:
        move_value = obj.get("move")
        rationale_value = obj.get("rationale")
        token = move_value.strip() if isinstance(move_value, str) else None
        move = parse_move(board, token) if token else None
        errors: list[str] = []
        if wrapper_error:
            errors.append(wrapper_error)
        if set(obj) != {"move", "rationale"}:
            errors.append("JSON object must contain exactly move and rationale")
        if not token or not _UCI_TOKEN.fullmatch(token.lower()):
            errors.append("move must be a UCI string")
        if not isinstance(rationale_value, str) or not rationale_value.strip():
            errors.append("rationale must be a non-empty string")
        rationale = rationale_value.strip() if isinstance(rationale_value, str) and rationale_value.strip() else None
        return ParsedMoveResponse(move, token, rationale, not errors, "; ".join(errors) or None)

    move, token = extract_move(board, text)
    rationale = None
    why = _WHY.search(text)
    if why:
        rationale = " ".join(why.group(1).split())[:2000] or None
    elif move is not None and token:
        rest = " ".join(text.replace(token, " ", 1).split())
        rationale = rest[:2000] if len(rest) >= 8 else None
    return ParsedMoveResponse(move, token, rationale, False, wrapper_error or "response is not valid JSON")


def parse_model_line_response(start_board: chess.Board, text: str) -> ParsedLineResponse:
    """Parse the canonical ``{moves, rationale}`` full-line response."""
    obj, wrapper_error = _json_object(text)
    if obj is not None:
        move_values = obj.get("moves")
        rationale_value = obj.get("rationale")
        errors: list[str] = []
        if wrapper_error:
            errors.append(wrapper_error)
        if set(obj) != {"moves", "rationale"}:
            errors.append("JSON object must contain exactly moves and rationale")
        if not isinstance(move_values, list) or not move_values or not all(isinstance(v, str) for v in move_values):
            errors.append("moves must be a non-empty array of UCI strings")
            tokens: list[str] = []
        else:
            tokens = [v.strip() for v in move_values]
            if not all(_UCI_TOKEN.fullmatch(v.lower()) for v in tokens):
                errors.append("moves must contain only UCI strings")
        if not isinstance(rationale_value, str) or not rationale_value.strip():
            errors.append("rationale must be a non-empty string")

        board = start_board.copy()
        moves: list[chess.Move] = []
        for token in tokens:
            move = parse_move(board, token)
            if move is None:
                break
            moves.append(move)
            board.push(move)
        rationale = rationale_value.strip() if isinstance(rationale_value, str) and rationale_value.strip() else None
        return ParsedLineResponse(moves, rationale, not errors, "; ".join(errors) or None)

    return ParsedLineResponse(
        extract_move_sequence(start_board, text),
        None,
        False,
        wrapper_error or "response is not valid JSON",
    )


def extract_move_and_explanation(
    board: chess.Board, text: str
) -> tuple[chess.Move | None, str | None, str | None]:
    """Like `extract_move`, but also pull out an optional natural-language
    explanation (text after a why/because/reasoning marker, else the leftover
    prose once the move token is removed). Returns (move, token, explanation)."""
    parsed = parse_model_move_response(board, text)
    return parsed.move, parsed.token, parsed.rationale


def extract_move(board: chess.Board, text: str) -> tuple[chess.Move | None, str | None]:
    """Pull the model's intended move out of a free-form response.

    Strategy: prefer an explicitly tagged answer (``move: e4`` / ``final: Nf3`` /
    fenced ``\\boxed{...}``); otherwise scan tokens and return the FIRST that is a
    legal move. Returns (move, matched_token). move is None if nothing legal found.
    """
    if not text:
        return None, None

    # Reasoning models sometimes leak their chain-of-thought into the content inside
    # <think>…</think>; drop it so the token scan doesn't grab a move it merely weighed.
    text = re.sub(r"<think>.*?</think>", " ", text, flags=re.DOTALL | re.IGNORECASE)

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
