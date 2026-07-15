from __future__ import annotations

import chess

from chessbench.sources.yacpdb import (
    algebraic_board,
    orthodox_single_diagram,
    query_url,
    stipulation_length,
)


def _record() -> dict[str, object]:
    return {
        "id": 1,
        "stipulation": "s#1",
        "algebraic": {
            "white": ["Kh1", "Qb7", "Re5"],
            "black": ["Kf1", "Qb2", "Pd4"],
        },
        "solution": "1.Qb7-g2+ Qb2*g2#",
    }


def test_query_url_encodes_gateway_language():
    url = query_url('Stip("^s#1$") AND NOT Fairy', 2)
    assert url.startswith("https://www.yacpdb.org/gateway/ql?")
    assert "p=2" in url
    assert "%23" in url


def test_orthodox_position_conversion_uses_black_turn_for_helpmates():
    record = _record()
    record["stipulation"] = "h#2"
    assert orthodox_single_diagram(record, "helpmate")
    board = algebraic_board(record, "helpmate")
    assert board.turn == chess.BLACK
    assert board.piece_at(chess.B7) == chess.Piece(chess.QUEEN, chess.WHITE)
    assert board.piece_at(chess.B2) == chess.Piece(chess.QUEEN, chess.BLACK)


def test_filter_rejects_twins_cooks_and_fairy_tokens():
    twin = _record()
    twin["twins"] = {"b": "move a1 a2"}
    assert not orthodox_single_diagram(twin, "selfmate")
    cooked = _record()
    cooked["comments"] = ["Cooked"]
    assert not orthodox_single_diagram(cooked, "selfmate")
    fairy = _record()
    fairy["algebraic"] = {"white": ["Kh1", "Gg2"], "black": ["Kf1"]}
    assert not orthodox_single_diagram(fairy, "selfmate")


def test_stipulation_lengths_include_half_move_proof_games():
    assert stipulation_length("selfmate", "s#3") == 3
    assert stipulation_length("proofgame", "PG 5.5") == 11
    assert stipulation_length("study", "+") == 0
