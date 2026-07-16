"""Composed/esoteric track: solver correctness on discovered examples, plus the
grader accepting correct answers and rejecting wrong ones across answer shapes."""

import pathlib
from dataclasses import replace

import chess
import pytest

from chessbench.conditions import HEADLINE, Condition, mode_condition
from chessbench.core.engine import EngineConfig, find_stockfish
from chessbench.solvers import stipulations
from chessbench.solvers.proofgame import verify_proofgame
from chessbench.tasks.composed import (
    ComposedProblem,
    ComposedSolver,
    LLMComposedSolver,
    OracleComposedSolver,
    grade_composed,
    load_composed,
)

FIXTURE = (
    pathlib.Path(__file__).resolve().parent.parent / "data" / "composed_problems.json"
)


# --- solver unit tests on independently-discovered examples ---


def test_directmate_1_unique_key():
    board = chess.Board("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1")
    keys = [m.uci() for m in stipulations.directmate_keys(board, 1)]
    assert keys == ["a1a8"]


def test_selfmate_1_verified_and_wrong_key_rejected():
    board = chess.Board("8/1Q6/8/4R3/3p4/8/1q6/5k1K w - - 0 1")
    assert stipulations.verify_selfmate(board, 1, chess.Move.from_uci("b7g2"))
    assert not stipulations.verify_selfmate(board, 1, chess.Move.from_uci("b7b1"))


def test_helpmate_2_line_and_wrong_line():
    board = chess.Board("8/3K4/8/8/8/8/3k4/2Q4N b - - 0 1")
    good = [chess.Move.from_uci(u) for u in ["d2e2", "c1c5", "e2f1", "c5f2"]]
    assert stipulations.verify_helpmate_line(board, 2, good)
    bad = [chess.Move.from_uci(u) for u in ["d2d3", "c1c5", "d3d4", "c5c4"]]
    assert not stipulations.verify_helpmate_line(board, 2, bad)


def test_series_directmate_helpmate_and_selfmate():
    from chessbench.solvers.series import (
        verify_series_directmate,
        verify_series_helpmate,
        verify_series_selfmate,
    )

    dm = chess.Board("7k/5ppp/8/8/8/8/8/R5K1 w - - 0 1")
    assert verify_series_directmate(
        dm, 2, [chess.Move.from_uci(u) for u in ["a1a7", "a7a8"]]
    )
    # a check on the first (non-final) series move is illegal
    assert not verify_series_directmate(
        dm, 2, [chess.Move.from_uci(u) for u in ["a1a8", "a8a7"]]
    )

    hm = chess.Board("7k/p7/5KQ1/8/8/8/8/8 b - - 0 1")
    assert verify_series_helpmate(
        hm, 2, [chess.Move.from_uci(u) for u in ["a7a6", "a6a5", "g6g7"]]
    )
    assert not verify_series_helpmate(
        hm, 2, [chess.Move.from_uci(u) for u in ["a7a6", "a6a5", "f6f7"]]
    )

    # Extracted from the final thematic variation of the owner-supplied s#2:
    # 1.Rd7+ forces the sole reply 1...Nd3#, which mates White.
    sm = chess.Board("4q3/6P1/B7/5P1p/4p3/2RR3Q/3pkPpP/3rn1Kb w - - 2 2")
    assert verify_series_selfmate(
        sm,
        1,
        [chess.Move.from_uci("d3d7"), chess.Move.from_uci("e1d3")],
    )
    assert not verify_series_selfmate(
        sm,
        1,
        [chess.Move.from_uci("d3d7"), chess.Move.from_uci("e1f3")],
    )


def test_proofgame_target():
    line = ["e2e4", "e7e5", "g1f3"]
    board = chess.Board()
    for u in line:
        board.push(chess.Move.from_uci(u))
    assert verify_proofgame(board.fen(), line, n_plies=3)
    assert not verify_proofgame(board.fen(), ["e2e4", "e7e5", "b1c3"], n_plies=3)


# --- grader across answer shapes ---


class WrongSolver:
    """Returns a legal move that is NOT the stored solution's first move."""

    name = "wrong"

    def solve(self, problem: ComposedProblem, condition: Condition) -> str:
        board = chess.Board(problem.fen)
        sol0 = problem.solution[0] if problem.solution else None
        for move in board.legal_moves:
            if move.uci() != sol0:
                return move.uci()
        return "0000"


def _oneshot_problems() -> list[ComposedProblem]:
    return [p for p in load_composed(FIXTURE) if p.answer_shape in ("key", "line")]


def test_oracle_solves_all_oneshot():
    oracle: ComposedSolver = OracleComposedSolver()
    problems = _oneshot_problems()
    assert problems, "fixture should contain key/line problems"
    for p in problems:
        res = grade_composed(oracle, p, HEADLINE)
        assert res.solved, f"oracle failed {p.id} ({p.label}): {res.detail}"
        assert res.score == 1.0


def test_wrong_answers_rejected():
    for p in _oneshot_problems():
        res = grade_composed(WrongSolver(), p, HEADLINE)
        assert not res.solved, f"{p.id} wrongly accepted a non-solution"


def test_llm_composed_turn_keeps_exact_prompt_response_usage_and_modes():
    class AuditedModel:
        name = "audited"
        last_usage = {
            "prompt_tokens": 21,
            "completion_tokens": 8,
            "completion_tokens_details": {"reasoning_tokens": 5},
        }
        last_cost = 0.004
        last_reasoning = "The back rank is weak."
        last_reasoning_details = [
            {
                "type": "reasoning.text",
                "text": "The back rank is weak.",
                "signature": {"opaque": "signed-provider-state"},
            }
        ]

        def __init__(self):
            self.prompt = ""
            self.max_tokens = 0
            self.response_format = None

        def generate(self, prompt, *, temperature=0.0, max_tokens=2048):
            self.prompt = prompt
            self.max_tokens = max_tokens
            return '{"move":"a1a8","rationale":"The rook mates on the back rank."}'

        def generate_structured(
            self,
            prompt,
            *,
            response_format,
            temperature=0.0,
            max_tokens=2048,
        ):
            self.response_format = response_format
            return self.generate(prompt, temperature=temperature, max_tokens=max_tokens)

        def chat_structured(
            self,
            messages,
            *,
            response_format,
            temperature=0.0,
            max_tokens=2048,
        ):
            self.response_format = response_format
            return self.generate(
                messages[-1]["content"],
                temperature=temperature,
                max_tokens=max_tokens,
            )

    problem = ComposedProblem(
        "audit",
        "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1",
        "directmate",
        1,
    )
    condition = replace(mode_condition(3), max_output_tokens=77)
    model = AuditedModel()
    result = grade_composed(LLMComposedSolver(model), problem, condition)

    assert result.solved
    assert model.max_tokens == 77
    assert "Legal moves [UCI]" in model.prompt
    assert "opponent's strongest defense" in model.prompt
    assert result.turns == [
        {
            "system_prompt": None,
            "prompt": model.prompt,
            "raw_response": '{"move":"a1a8","rationale":"The rook mates on the back rank."}',
            "response_format": model.response_format,
            "reasoning": "The back rank is weak.",
            "reasoning_details": model.last_reasoning_details,
                "usage": model.last_usage,
                "prompt_tokens": 21,
                "completion_tokens": 8,
                "reasoning_tokens": 5,
                "cache_read_tokens": 0,
                "cache_write_tokens": 0,
                "uncached_prompt_tokens": 21,
                "cost_usd": 0.004,
                "cache_discount_usd": 0.0,
                "cache_policy": "provider_default",
                "cache_session_id": None,
            "rationale": "The rook mates on the back rank.",
            "response_format_valid": True,
            "response_format_error": None,
        }
    ]


def test_composed_reasoning_usage_is_not_double_counted():
    from chessbench.__main__ import _turn_usage_totals

    turns = [
        {
            "usage": {
                "prompt_tokens": 10,
                "completion_tokens": 7,
                "completion_tokens_details": {"reasoning_tokens": 3},
            },
            "reasoning_tokens": 3,
            "cost_usd": 0.01,
        },
        {
            "usage": {"prompt_tokens": 12, "completion_tokens": 8},
            "reasoning_tokens": 4,
            "cost_usd": 0.02,
        },
    ]
    assert _turn_usage_totals(turns) == (22, 15, 7, pytest.approx(0.03))


def test_study_keeps_every_attempt_audit_envelope():
    from chessbench.solvers import grade_study

    class AuditedIllegalAgent:
        name = "audited-illegal"

        def choose(self, _board, ctx):
            ctx.last_system_prompt = "study system"
            ctx.last_prompt = "exact study prompt"
            ctx.last_raw_response = "banana"
            ctx.last_explanation = "private rationale"
            ctx.last_response_format_valid = False
            ctx.last_response_format_error = "not JSON"
            ctx.last_usage = {
                "prompt_tokens": 4,
                "completion_tokens": 2,
                "completion_tokens_details": {"reasoning_tokens": 1},
            }
            ctx.last_cost = 0.001
            return "banana"

    class EvalOnlyEngine:
        def evaluate(self, _board):
            return 0

    result = grade_study(
        AuditedIllegalAgent(),
        chess.Board().fen(),
        "win",
        EvalOnlyEngine(),
        HEADLINE,
    )
    assert result.outcome == "illegal"
    assert result.turns == [
        {
            "system_prompt": "study system",
            "prompt": "exact study prompt",
            "raw_response": "banana",
            "parsed_move": None,
            "legal": False,
            "rationale": "private rationale",
            "response_format_valid": False,
            "response_format_error": "not JSON",
            "response_format": None,
            "usage": {
                "prompt_tokens": 4,
                "completion_tokens": 2,
                "completion_tokens_details": {"reasoning_tokens": 1},
            },
                "reasoning_tokens": 1,
                "prompt_tokens": 4,
                "completion_tokens": 2,
                "cache_read_tokens": 0,
                "cache_write_tokens": 0,
                "uncached_prompt_tokens": 4,
                "cost_usd": 0.001,
                "cache_discount_usd": 0.0,
                "cache_policy": "provider_default",
                "cache_session_id": None,
            }
    ]


@pytest.mark.skipif(find_stockfish() is None, reason="stockfish not installed")
def test_study_stockfish_converts_random_does_not():
    from chessbench.agents import RandomAgent, StockfishAgent
    from chessbench.core.engine import Engine
    from chessbench.solvers import grade_study

    study = next(p for p in load_composed(FIXTURE) if p.kind == "study")
    with Engine(EngineConfig(nodes=120_000)) as engine:
        with StockfishAgent(engine=engine) as sf:
            won = grade_study(sf, study.fen, "win", engine, HEADLINE)
        assert won.solved and won.outcome == "checkmate_win"

        rand = grade_study(RandomAgent(seed=1), study.fen, "win", engine, HEADLINE)
        assert not rand.solved  # random keeps the queen but never converts to mate
