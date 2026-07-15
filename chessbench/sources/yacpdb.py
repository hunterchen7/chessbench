"""Private-MVP reader for YACPDB's structured query gateway.

The upstream record is preserved verbatim in ignored local storage.  This
module only handles transport and orthodox single-diagram filtering; admission
to a runnable corpus happens later through native and Popeye verification.
"""

from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Iterator

import chess

from ..types import StipulationKind

GATEWAY = "https://www.yacpdb.org/gateway/ql"
QUERIES: dict[StipulationKind, str] = {
    "directmate": 'Stip("^#2$") AND NOT Fairy',
    "selfmate": 'Stip("^s#[1-3]$") AND NOT Fairy',
    "reflexmate": 'Stip("^r#[1-4]$") AND NOT Fairy',
    "helpmate": 'Stip("^h#2$") AND NOT Fairy',
    "series_helpmate": 'Stip("Ser-h#[2-6]") AND NOT Fairy',
    "series_directmate": 'Stip("Ser-#.*") AND NOT Fairy',
    "proofgame": 'Stip("^S?PG.*") AND NOT Fairy',
    "study": 'Stip("^[+=]$") AND NOT Fairy',
}

_PIECE = re.compile(r"^([KQRBSP])([a-h][1-8])$")
_STIPULATION = {
    "directmate": re.compile(r"^#(\d+)$", re.IGNORECASE),
    "selfmate": re.compile(r"^s#(\d+)$", re.IGNORECASE),
    "reflexmate": re.compile(r"^r#(\d+)$", re.IGNORECASE),
    "helpmate": re.compile(r"^h#(\d+)$", re.IGNORECASE),
    "series_helpmate": re.compile(r"^ser-h#(\d+)$", re.IGNORECASE),
    "series_directmate": re.compile(r"^ser-#(\d+)$", re.IGNORECASE),
}


@dataclass(frozen=True)
class QueryPage:
    query: str
    page: int
    total: int
    entries: list[dict[str, object]]


def query_url(query: str, page: int) -> str:
    return GATEWAY + "?" + urllib.parse.urlencode({"q": query, "p": page})


def fetch_page(query: str, page: int, *, timeout: float = 30.0) -> QueryPage:
    request = urllib.request.Request(
        query_url(query, page), headers={"User-Agent": "ChessBench-private-MVP/0.1"}
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = json.load(response)
    if payload.get("success") is not True:
        raise RuntimeError(f"YACPDB query failed: {payload!r}")
    result = payload.get("result")
    if not isinstance(result, dict):
        raise RuntimeError("YACPDB response omitted result")
    entries = result.get("entries", [])
    if not isinstance(entries, list):
        raise RuntimeError("YACPDB result entries are not a list")
    return QueryPage(
        query=query,
        page=page,
        total=int(result.get("count", 0)),
        entries=[entry for entry in entries if isinstance(entry, dict)],
    )


def stipulation_length(kind: StipulationKind, value: str) -> int | None:
    if kind == "proofgame":
        match = re.match(r"^(?:S?PG)\s+(\d+)\.(0|5)$", value, re.IGNORECASE)
        if match is None:
            return None
        return int(match.group(1)) * 2 + (1 if match.group(2) == "5" else 0)
    if kind == "study":
        return 0 if value in {"+", "="} else None
    pattern = _STIPULATION.get(kind)
    match = pattern.match(value) if pattern is not None else None
    return int(match.group(1)) if match else None


def _record_text(entry: dict[str, object]) -> str:
    values = [
        entry.get("solution", ""),
        entry.get("comments", ""),
        entry.get("keywords", ""),
    ]
    return json.dumps(values, ensure_ascii=False).lower()


def orthodox_single_diagram(entry: dict[str, object], kind: StipulationKind) -> bool:
    if any(entry.get(field) for field in ("conditions", "options", "twins")):
        return False
    if "cook" in _record_text(entry):
        return False
    stipulation = entry.get("stipulation")
    if (
        not isinstance(stipulation, str)
        or stipulation_length(kind, stipulation) is None
    ):
        return False
    algebraic = entry.get("algebraic")
    if not isinstance(algebraic, dict) or set(algebraic) - {"white", "black"}:
        return False
    for color in ("white", "black"):
        pieces = algebraic.get(color)
        if not isinstance(pieces, list) or any(
            not isinstance(piece, str) or _PIECE.fullmatch(piece) is None
            for piece in pieces
        ):
            return False
    return bool(entry.get("solution"))


def algebraic_board(entry: dict[str, object], kind: StipulationKind) -> chess.Board:
    algebraic = entry.get("algebraic")
    if not isinstance(algebraic, dict):
        raise ValueError("record has no algebraic position")
    board = chess.Board(None)
    piece_types = {
        "K": chess.KING,
        "Q": chess.QUEEN,
        "R": chess.ROOK,
        "B": chess.BISHOP,
        "S": chess.KNIGHT,
        "P": chess.PAWN,
    }
    for color_name, color in (("white", chess.WHITE), ("black", chess.BLACK)):
        pieces = algebraic.get(color_name, [])
        if not isinstance(pieces, list):
            raise ValueError(f"algebraic.{color_name} is not a list")
        for token in pieces:
            match = _PIECE.fullmatch(str(token))
            if match is None:
                raise ValueError(f"unsupported orthodox piece token: {token!r}")
            piece_name, square_name = match.groups()
            square = chess.parse_square(square_name)
            if board.piece_at(square) is not None:
                raise ValueError(f"multiple pieces occupy {square_name}")
            board.set_piece_at(
                square, chess.Piece(piece_types[piece_name], color), promoted=False
            )
    board.turn = chess.BLACK if kind in {"helpmate", "series_helpmate"} else chess.WHITE
    board.castling_rights = chess.BB_EMPTY
    board.ep_square = None
    board.halfmove_clock = 0
    board.fullmove_number = 1
    return board


def iter_candidates(
    kind: StipulationKind, *, maximum: int, max_pages: int = 50
) -> Iterator[tuple[dict[str, object], int, int]]:
    """Yield clean raw records plus page and upstream total."""
    query = QUERIES[kind]
    yielded = 0
    seen: set[int] = set()
    for page_number in range(1, max_pages + 1):
        page = fetch_page(query, page_number)
        if not page.entries:
            break
        for entry in page.entries:
            record_id = entry.get("id")
            if not isinstance(record_id, int) or record_id in seen:
                continue
            seen.add(record_id)
            if not orthodox_single_diagram(entry, kind):
                continue
            try:
                board = algebraic_board(entry, kind)
            except ValueError:
                continue
            if not board.is_valid():
                continue
            yield entry, page_number, page.total
            yielded += 1
            if yielded >= maximum:
                return
