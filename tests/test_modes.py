"""The 3 help modes: 1 raw, 2 +legal moves (SAN & UCI), 3 +coaching tips."""

import chess

from chessbench.conditions import (
    DEFAULT_MODE, Legality, PromptStyle, build_puzzle_prompt, mode_condition,
)

B = chess.Board()


def test_mode1_is_raw_fen_and_pieces_no_legal_moves():
    p = build_puzzle_prompt(B, mode_condition(1))
    assert "FEN:" in p and "Pieces:" in p
    assert "Legal moves" not in p


def test_mode2_lists_legal_moves_in_both_san_and_uci():
    p = build_puzzle_prompt(B, mode_condition(2))
    assert "Legal moves" in p
    assert "Nf3 (g1f3)" in p            # SAN with UCI in parentheses
    assert "e4 (e2e4)" in p


def test_mode3_adds_coaching_tips():
    p = build_puzzle_prompt(B, mode_condition(3))
    assert "Legal moves" in p
    assert "checklist" in p.lower() and "check" in p.lower()


def test_mode_presets_and_default():
    assert DEFAULT_MODE == 2
    assert mode_condition(1).legality == Legality.FREE_FORM
    assert mode_condition(2).legality == Legality.LEGAL_LIST
    assert mode_condition(3).prompt_style == PromptStyle.COACHED
