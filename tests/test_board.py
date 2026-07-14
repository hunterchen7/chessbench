import chess

from chessbench.core.board import (
    extract_move,
    extract_move_and_explanation,
    parse_model_line_response,
    parse_model_move_response,
    parse_move,
)


def test_parse_uci_and_san():
    b = chess.Board()
    assert parse_move(b, "e2e4") == chess.Move.from_uci("e2e4")
    assert parse_move(b, "e4") == chess.Move.from_uci("e2e4")
    assert parse_move(b, "Nf3") == chess.Move.from_uci("g1f3")


def test_parse_rejects_illegal_and_garbage():
    b = chess.Board()
    assert parse_move(b, "e2e5") is None       # illegal UCI
    assert parse_move(b, "Ke2") is None        # illegal SAN (king can't move yet)
    assert parse_move(b, "banana") is None
    assert parse_move(b, "") is None


def test_castling_notation_variants():
    b = chess.Board("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1")
    assert parse_move(b, "O-O") == chess.Move.from_uci("e1g1")
    assert parse_move(b, "0-0-0") == chess.Move.from_uci("e1c1")


def test_promotion():
    b = chess.Board("8/P7/8/8/8/8/8/k6K w - - 0 1")
    assert parse_move(b, "a8=Q") == chess.Move.from_uci("a7a8q")
    assert parse_move(b, "a7a8q") == chess.Move.from_uci("a7a8q")


def test_extract_from_free_form_prefers_tagged_answer():
    b = chess.Board()
    mv, tok = extract_move(b, "I would consider d4 or c4, but answer: e4")
    assert mv == chess.Move.from_uci("e2e4")


def test_extract_first_legal_token_when_untagged():
    b = chess.Board()
    mv, tok = extract_move(b, "The move zzz9 is nonsense; Nf3 develops.")
    assert mv == chess.Move.from_uci("g1f3")


def test_extract_returns_none_when_no_legal_move():
    b = chess.Board()
    mv, tok = extract_move(b, "I resign, this is hopeless.")
    assert mv is None


def test_extract_move_and_explanation_tagged():
    b = chess.Board()
    mv, tok, why = extract_move_and_explanation(b, "e4\nwhy: grabs the center and opens lines")
    assert mv == chess.Move.from_uci("e2e4")
    assert why is not None and "center" in why


def test_extract_move_and_explanation_no_why_marker():
    b = chess.Board()
    mv, tok, why = extract_move_and_explanation(b, "Nf3 develops the knight and eyes e5")
    assert mv == chess.Move.from_uci("g1f3")
    assert why is not None and "develops" in why


def test_extract_move_and_explanation_bare_move_has_no_explanation():
    b = chess.Board()
    mv, tok, why = extract_move_and_explanation(b, "e4")
    assert mv == chess.Move.from_uci("e2e4") and why is None


def test_structured_move_response_extracts_move_and_rationale():
    b = chess.Board()
    parsed = parse_model_move_response(
        b,
        '{"move":"e2e4","rationale":"Claims the center and opens both diagonals."}',
    )
    assert parsed.move == chess.Move.from_uci("e2e4")
    assert parsed.rationale and "center" in parsed.rationale
    assert parsed.format_valid and parsed.format_error is None


def test_structured_move_field_is_authoritative_even_if_illegal():
    b = chess.Board()
    parsed = parse_model_move_response(
        b,
        '{"move":"e2e5","rationale":"I also considered the legal move e2e4."}',
    )
    assert parsed.move is None
    assert parsed.format_valid  # valid schema/notation is independent from chess legality


def test_malformed_json_recovers_move_but_records_format_failure():
    b = chess.Board()
    parsed = parse_model_move_response(b, "move: e2e4 because it claims the center")
    assert parsed.move == chess.Move.from_uci("e2e4")
    assert not parsed.format_valid and parsed.format_error


def test_structured_full_line_does_not_parse_moves_from_rationale():
    b = chess.Board()
    parsed = parse_model_line_response(
        b,
        '{"moves":["e2e4","e7e5","g1f3"],"rationale":"A line such as d2d4 is less forcing."}',
    )
    assert [move.uci() for move in parsed.moves] == ["e2e4", "e7e5", "g1f3"]
    assert parsed.format_valid


def test_parse_move_is_generous():
    """Sloppy but unambiguous notations should still parse (Rd1 for Rd1+, markdown,
    annotations, mixed-case UCI, stray spaces)."""
    import chess

    from chessbench.core.board import parse_move

    b = chess.Board("3k4/8/8/8/8/8/8/R5K1 w - - 0 1")  # a1d1 is Rd1+
    for text in ("Rd1", "Rd1+", "Rd1#", "Rd1!", "Rd1?!", "**Rd1**", "`Rd1`", "A1D1", "a1d1 ", "R d1", "Rd1."):
        mv = parse_move(b, text)
        assert mv is not None and mv.uci() == "a1d1", f"failed to parse {text!r}"
    assert parse_move(b, "Qh8") is None  # still rejects illegal/nonsense
