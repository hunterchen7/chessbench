"""The 4 puzzle protocols, from raw position through a full-line answer."""

import chess

from chessbench.conditions import (
    DEFAULT_MODE, Legality, PromptStyle, PuzzleProtocol, build_puzzle_prompt, mode_condition,
)

B = chess.Board()


def test_mode1_is_raw_fen_and_pieces_no_legal_moves():
    p = build_puzzle_prompt(B, mode_condition(1))
    assert "FEN:" in p and "Pieces:" in p
    assert "Legal moves" not in p
    assert '{"move":"e2e4","rationale":' in p


def test_mode2_lists_legal_moves_in_both_san_and_uci():
    p = build_puzzle_prompt(B, mode_condition(2))
    assert "Legal moves" in p
    assert "Nf3 (g1f3)" in p            # SAN with UCI in parentheses
    assert "e4 (e2e4)" in p


def test_mode3_adds_coaching_tips():
    p = build_puzzle_prompt(B, mode_condition(3))
    assert "Legal moves" in p
    assert "not a mandatory sequence" in p.lower()
    assert "zugzwang" in p.lower() and "strongest defense" in p.lower()


def test_mode4_requests_the_complete_woodpecker_line():
    p = build_puzzle_prompt(B, mode_condition(4))
    assert "complete solution" in p.lower()
    assert "forced replies" in p.lower()
    assert '"moves"' in p and '"rationale"' in p
    assert mode_condition(4).puzzle_protocol == PuzzleProtocol.FULL_LINE


def test_mode_presets_and_default():
    assert DEFAULT_MODE == 2
    assert mode_condition(1).legality == Legality.FREE_FORM
    assert mode_condition(2).legality == Legality.LEGAL_LIST
    assert mode_condition(3).prompt_style == PromptStyle.COACHED


def test_stateful_and_stateless_puzzle_contexts_have_distinct_ids():
    from dataclasses import replace
    from chessbench.conditions import ContextMode

    stateful = mode_condition(2)
    stateless = replace(stateful, context_mode=ContextMode.FRESH)
    assert stateful.slug() != stateless.slug()
    assert "pctx-hybrid" in stateful.slug()
