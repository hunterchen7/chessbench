import chess

from chessbench.core.board import extract_move, extract_move_and_explanation, parse_move


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
