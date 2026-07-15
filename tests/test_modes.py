"""The 4 puzzle protocols, from raw position through a full-line answer."""

from dataclasses import replace

import chess

from chessbench.conditions import (
    DEFAULT_MODE,
    Legality,
    PromptStyle,
    PuzzleProtocol,
    build_puzzle_prompt,
    game_system_prompt,
    mode_condition,
)

B = chess.Board()


def test_mode1_is_raw_fen_and_pieces_no_legal_moves():
    p = build_puzzle_prompt(B, mode_condition(1))
    assert "FEN:" in p and "Pieces:" in p
    assert "Legal moves" not in p
    assert '{"move":"e2e4","rationale":' in p


def test_mode2_lists_only_unannotated_uci_legal_moves():
    p = build_puzzle_prompt(B, mode_condition(2))
    assert "Legal moves [UCI]" in p
    assert "g1f3" in p and "e2e4" in p
    assert "Nf3" not in p and "e4 (e2e4)" not in p


def test_uci_candidate_list_does_not_reveal_mate_in_one():
    board = chess.Board("7k/6pp/8/6Q1/8/8/8/7K w - - 0 1")
    p = build_puzzle_prompt(board, mode_condition(2))
    assert "g5d8" in p  # Qd8 is mate, but the candidate carries no '#'.
    legal_line = p.split("Legal moves [UCI]:", 1)[1].split("\n", 1)[0]
    assert "#" not in legal_line and "+" not in legal_line


def test_puzzle_history_is_rendered_in_uci_not_san():
    p = build_puzzle_prompt(B, mode_condition(2), history_uci=["e2e4", "e7e5"])
    assert "Moves already played in this puzzle [UCI]: e2e4 e7e5" in p
    assert "1.e4 e5" not in p


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


def test_move_only_is_explicit_for_minimal_coached_and_full_line_prompts():
    for mode in (1, 2, 3):
        condition = replace(mode_condition(mode), explain=False)
        puzzle = build_puzzle_prompt(B, condition)
        system = game_system_prompt(condition, chess.WHITE)
        for prompt in (puzzle, system):
            assert "ONLY your move" in prompt
            assert "no explanation or other text" in prompt
            assert '"rationale"' not in prompt

    woodpecker = build_puzzle_prompt(
        B, replace(mode_condition(4), explain=False)
    )
    assert "starting with `line:`" in woodpecker
    assert "no explanation or other text" in woodpecker
    assert '"rationale"' not in woodpecker


def test_mode_presets_and_default():
    assert DEFAULT_MODE == 2
    assert mode_condition(1).legality == Legality.FREE_FORM
    assert mode_condition(2).legality == Legality.LEGAL_LIST
    assert mode_condition(3).prompt_style == PromptStyle.COACHED
    assert "prompt-uci-candidates-v1" in mode_condition(2).slug()


def test_stateful_and_stateless_puzzle_contexts_have_distinct_ids():
    from dataclasses import replace
    from chessbench.conditions import ContextMode

    stateful = mode_condition(2)
    stateless = replace(stateful, context_mode=ContextMode.FRESH)
    assert stateful.slug() != stateless.slug()
    assert "pctx-hybrid" in stateful.slug()
