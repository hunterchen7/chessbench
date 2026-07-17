"""Exact resume boundaries for paid move-by-move puzzle turns."""

from __future__ import annotations

import json
import sqlite3
from dataclasses import replace

import chess
import pytest

from chessbench.__main__ import _turn_usage_totals
from chessbench.agents import LLMAgent
from chessbench.conditions import HEADLINE, Legality
from chessbench.database import BenchmarkStore, RunSpec
from chessbench.models import ModelError
from chessbench.models.base import ScriptedModel
from chessbench.tasks.puzzles import Puzzle, PuzzleCheckpoint, grade_puzzle
from chessbench.tasks.runner import run_puzzles
from chessbench.variants import ModelVariant


TWO_MOVE = Puzzle(
    id="two-checkpoint",
    fen=chess.STARTING_FEN,
    moves=["e2e4", "e7e5", "g1f3", "b8c6"],
    rating=1500,
)
ONE_MOVE = Puzzle(
    id="one-checkpoint",
    fen="6k1/5ppp/8/8/8/7q/8/R5K1 b - - 0 1",
    moves=["h3h6", "a1a8"],
    rating=1200,
)


class UsageScriptedModel(ScriptedModel):
    def __init__(self, actions: list[tuple[str, int, int, int, float] | Exception]):
        self.actions = list(actions)
        self.calls: list[list[dict[str, str]]] = []
        self.last_usage: dict[str, object] = {}
        self.last_cost = 0.0
        super().__init__(self._respond, name="usage-scripted")

    def _respond(self, messages):
        self.calls.append([dict(message) for message in messages])
        # Match real provider adapters: a new call never inherits the preceding
        # call's usage when it fails before returning a response.
        self.last_usage = {}
        self.last_cost = 0.0
        action = self.actions.pop(0)
        if isinstance(action, Exception):
            raise action
        raw, prompt, completion, reasoning, cost = action
        self.last_usage = {
            "prompt_tokens": prompt,
            "completion_tokens": completion,
            "completion_tokens_details": {"reasoning_tokens": reasoning},
        }
        self.last_cost = cost
        return raw


def _answer(move: str, rationale: str) -> str:
    return json.dumps({"move": move, "rationale": rationale})


def _spec() -> RunSpec:
    return RunSpec(
        "puzzle",
        ModelVariant(
            "checkpoint-model",
            "Checkpoint model",
            "openrouter",
            "test/checkpoint",
        ),
        HEADLINE,
        1,
        suite_name="checkpoint-suite",
        suite_hash="checkpoint-v1",
    )


def test_resume_continues_at_next_solver_move_with_restored_conversation():
    first_model = UsageScriptedModel(
        [
            (_answer("e7e5", "FIRST-PRIVATE"), 10, 4, 2, 0.01),
            ModelError("credits exhausted"),
        ]
    )
    checkpoints: list[PuzzleCheckpoint] = []
    with pytest.raises(ModelError):
        grade_puzzle(
            LLMAgent(first_model),
            TWO_MOVE,
            HEADLINE,
            on_checkpoint=checkpoints.append,
        )

    checkpoint = checkpoints[-1]
    assert checkpoint.solver_ply == 1
    assert checkpoint.moves_played == ["e7e5"]
    assert len(checkpoint.turns) == 2
    assert checkpoint.turns[-1]["model_error"] == "credits exhausted"
    assert checkpoint.conversation[-1]["role"] == "assistant"
    assert len(first_model.calls) == 2

    resumed_model = UsageScriptedModel(
        [
            (_answer("b8c6", "SECOND-PRIVATE"), 12, 5, 3, 0.02),
            (_answer("a1a8", "NEW-PUZZLE"), 8, 3, 1, 0.005),
        ]
    )
    resumed_agent = LLMAgent(resumed_model)
    result = grade_puzzle(resumed_agent, TWO_MOVE, HEADLINE, checkpoint=checkpoint)

    assert result.solved
    assert result.moves_played == ["e7e5", "b8c6"]
    assert len(result.turns) == 3
    assert len(resumed_model.calls) == 1
    restored_call = resumed_model.calls[0]
    assert [message["role"] for message in restored_call] == [
        "system",
        "user",
        "assistant",
        "user",
    ]
    assert "FIRST-PRIVATE" in restored_call[2]["content"]

    new_result = grade_puzzle(resumed_agent, ONE_MOVE, HEADLINE)
    assert new_result.solved
    assert len(resumed_model.calls[1]) == 2
    assert "FIRST-PRIVATE" not in json.dumps(resumed_model.calls[1])
    assert "SECOND-PRIVATE" not in json.dumps(resumed_model.calls[1])


def test_illegal_retry_resumes_with_feedback_without_reissuing_attempt():
    condition = replace(HEADLINE, legality=Legality.RETRY, retry_attempts=2)
    first_model = UsageScriptedModel(
        [
            (_answer("banana", "ILLEGAL-PRIVATE"), 7, 3, 1, 0.004),
            ModelError("temporary outage"),
        ]
    )
    checkpoints: list[PuzzleCheckpoint] = []
    with pytest.raises(ModelError):
        grade_puzzle(
            LLMAgent(first_model),
            ONE_MOVE,
            condition,
            on_checkpoint=checkpoints.append,
        )

    checkpoint = checkpoints[-1]
    assert checkpoint.attempts_used == 1
    assert checkpoint.illegal_attempts == 1
    assert checkpoint.illegal_feedback and "banana" in checkpoint.illegal_feedback

    resumed_model = UsageScriptedModel([(_answer("a1a8", "RECOVERED"), 9, 4, 2, 0.006)])
    result = grade_puzzle(
        LLMAgent(resumed_model), ONE_MOVE, condition, checkpoint=checkpoint
    )

    assert result.solved and result.illegal_attempts == 1
    assert len(result.turns) == 3
    assert len(resumed_model.calls) == 1
    assert (
        "previous answer was illegal" in resumed_model.calls[0][-1]["content"].lower()
    )


def test_terminal_checkpoint_finishes_without_another_provider_call(tmp_path):
    path = tmp_path / "terminal.db"
    original_model = UsageScriptedModel(
        [(_answer("a1a8", "FINAL-PRIVATE"), 8, 3, 1, 0.005)]
    )
    with BenchmarkStore(path) as store:
        run = store.start_run(_spec())

        def save_then_crash(checkpoint: PuzzleCheckpoint) -> None:
            store.save_puzzle_checkpoint(run.run_id, 0, ONE_MOVE.id, checkpoint)
            if checkpoint.terminal_result is not None:
                raise RuntimeError("process died before item commit")

        with pytest.raises(RuntimeError, match="before item commit"):
            grade_puzzle(
                LLMAgent(original_model),
                ONE_MOVE,
                HEADLINE,
                on_checkpoint=save_then_crash,
            )

    with BenchmarkStore(path) as store:
        terminal = store.load_puzzle_checkpoints(run.run_id)[ONE_MOVE.id]
        assert terminal.terminal_result is not None
        no_call_model = UsageScriptedModel([AssertionError("provider was called")])
        result = grade_puzzle(
            LLMAgent(no_call_model), ONE_MOVE, HEADLINE, checkpoint=terminal
        )
        assert result.solved
        assert no_call_model.calls == []
        store.save_puzzle_result(run.run_id, 0, ONE_MOVE, result)
        assert store.load_puzzle_checkpoints(run.run_id) == {}


def test_runner_database_resume_counts_each_audited_turn_once(tmp_path):
    first_model = UsageScriptedModel(
        [
            (_answer("e7e5", "FIRST"), 10, 4, 2, 0.01),
            ModelError("credits exhausted"),
        ]
    )
    path = tmp_path / "checkpoint.db"
    with BenchmarkStore(path) as store:
        run = store.start_run(_spec())
        with pytest.raises(RuntimeError, match="provider calls failed"):
            run_puzzles(
                LLMAgent(first_model),
                [TWO_MOVE],
                HEADLINE,
                on_checkpoint=lambda seq, puzzle, state: store.save_puzzle_checkpoint(
                    run.run_id, seq, puzzle.id, state
                ),
            )
        store.mark_partial(run.run_id, "credits exhausted")
        [checkpoint] = store.load_puzzle_checkpoints(run.run_id).values()
        assert store.run_row(run.run_id)["cost_usd"] == 0

        resumed_model = UsageScriptedModel(
            [(_answer("b8c6", "SECOND"), 12, 5, 3, 0.02)]
        )

        def save_result(seq, puzzle, result):
            prompt, completion, reasoning, cost = _turn_usage_totals(result.turns)
            store.save_puzzle_result(
                run.run_id,
                seq,
                puzzle,
                result,
                cost_usd=cost,
                prompt_tokens=prompt,
                completion_tokens=completion,
                reasoning_tokens=reasoning,
            )

        _report, [result] = run_puzzles(
            LLMAgent(resumed_model),
            [TWO_MOVE],
            HEADLINE,
            checkpoints={TWO_MOVE.id: checkpoint},
            on_checkpoint=lambda seq, puzzle, state: store.save_puzzle_checkpoint(
                run.run_id, seq, puzzle.id, state
            ),
            on_result=save_result,
        )

        assert result.solved and len(result.turns) == 3
        assert store.load_puzzle_checkpoints(run.run_id) == {}
        row = store.run_row(run.run_id)
        assert row["completed_items"] == 1
        assert row["prompt_tokens"] == 22
        assert row["completion_tokens"] == 9
        assert row["reasoning_tokens"] == 5
        assert row["cost_usd"] == pytest.approx(0.03)
        # Idempotent finalization cannot charge the checkpointed turns twice.
        save_result(0, TWO_MOVE, result)
        assert store.run_row(run.run_id)["cost_usd"] == pytest.approx(0.03)


def test_runner_can_stop_before_issuing_more_paid_items():
    second = replace(ONE_MOVE, id="one-checkpoint-2")
    model = UsageScriptedModel(
        [
            (_answer("a1a8", "FIRST"), 8, 3, 1, 0.005),
            AssertionError("second provider call must not be issued"),
        ]
    )

    report, results = run_puzzles(
        LLMAgent(model),
        [ONE_MOVE, second],
        HEADLINE,
        max_new_items=1,
    )

    assert len(results) == 1
    assert report.n == 1
    assert len(model.calls) == 1


def test_runner_stops_after_consecutive_unsolved_and_restores_streak_on_resume():
    puzzles = [replace(ONE_MOVE, id=f"streak-{index}") for index in range(11)]
    misses = [(_answer("a1a2", "MISS"), 8, 3, 1, 0.005)] * 10
    model = UsageScriptedModel(
        [*misses, AssertionError("eleventh provider call must not be issued")]
    )

    report, results = run_puzzles(
        LLMAgent(model),
        puzzles,
        HEADLINE,
        max_consecutive_unsolved=10,
    )

    assert len(results) == 10
    assert report.n == 10
    assert not any(result.solved for result in results)
    assert len(model.calls) == 10

    resumed = UsageScriptedModel(
        [
            (_answer("a1a2", "TENTH MISS"), 8, 3, 1, 0.005),
            AssertionError("resume must stop before the next missing puzzle"),
        ]
    )
    resumed_report, resumed_results = run_puzzles(
        LLMAgent(resumed),
        puzzles,
        HEADLINE,
        completed={result.puzzle_id: result for result in results[:9]},
        max_consecutive_unsolved=10,
    )

    assert len(resumed_results) == 10
    assert resumed_report.n == 10
    assert len(resumed.calls) == 1


def test_runner_paid_boundary_counts_provider_failures():
    second = replace(ONE_MOVE, id="one-checkpoint-2")
    model = UsageScriptedModel(
        [
            ModelError("provider failed"),
            AssertionError("second provider call must not be issued"),
        ]
    )

    with pytest.raises(RuntimeError, match="provider calls failed"):
        run_puzzles(
            LLMAgent(model),
            [ONE_MOVE, second],
            HEADLINE,
            max_new_items=1,
        )

    assert len(model.calls) == 1


def test_billed_provider_failure_is_checkpointed_without_becoming_a_chess_move():
    model = UsageScriptedModel([ModelError("choice ended in error")])
    model.last_provider_response = None
    model.last_response_id = None
    checkpoints: list[PuzzleCheckpoint] = []

    # Simulate the provider's audit state being populated before it raises.
    def failed_response(messages):
        model.calls.append([dict(message) for message in messages])
        model.last_usage = {
            "prompt_tokens": 147,
            "completion_tokens": 7610,
            "completion_tokens_details": {"reasoning_tokens": 5368},
            "cost": 0.0292616478,
        }
        model.last_cost = 0.0292616478
        model.last_provider_response = {
            "id": "gen-glm-failed",
            "choices": [
                {
                    "finish_reason": "error",
                    "message": {"content": None},
                    "error": {"message": "generation failed"},
                }
            ],
        }
        model.last_request_payload = {
            "model": "z-ai/glm-5.2",
            "messages": messages,
            "reasoning": {"effort": "high", "exclude": True},
        }
        model.last_provider_response_raw = json.dumps(model.last_provider_response)
        model.last_http_status = 200
        model.last_response_headers = {
            "x-generation-id": "gen-glm-failed",
            "cf-ray": "example-ray",
        }
        model.last_response_id = "gen-glm-failed"
        model.last_response_model = "z-ai/glm-5.2"
        model.last_response_provider = "Example Inference"
        model.last_finish_reason = "error"
        model.last_native_finish_reason = "server_error"
        model.last_provider_error = {"message": "generation failed"}
        raise ModelError("choice ended in error")

    model._responder = failed_response
    with pytest.raises(ModelError, match="choice ended in error"):
        grade_puzzle(
            LLMAgent(model), ONE_MOVE, HEADLINE, on_checkpoint=checkpoints.append
        )

    checkpoint = checkpoints[-1]
    assert checkpoint.solver_ply == 0
    assert checkpoint.attempts_used == 0
    assert checkpoint.illegal_attempts == 0
    assert [message["role"] for message in checkpoint.conversation] == ["system"]
    [turn] = checkpoint.turns
    assert turn["model_error"] == "choice ended in error"
    assert turn["parsed_move"] is None
    assert turn["response_id"] == "gen-glm-failed"
    assert turn["finish_reason"] == "error"
    assert turn["provider_error"] == {"message": "generation failed"}
    assert turn["request_payload"]["reasoning"] == {
        "effort": "high",
        "exclude": True,
    }
    assert turn["provider_response_raw"] == json.dumps(
        model.last_provider_response
    )
    assert turn["http_status"] == 200
    assert turn["response_headers"] == {
        "x-generation-id": "gen-glm-failed",
        "cf-ray": "example-ray",
    }
    assert turn["cost_usd"] == pytest.approx(0.0292616478)

    resumed = UsageScriptedModel(
        [(_answer("a1a8", "valid retry"), 8, 3, 1, 0.005)]
    )
    result = grade_puzzle(
        LLMAgent(resumed), ONE_MOVE, HEADLINE, checkpoint=checkpoint
    )
    assert result.solved
    assert result.illegal_attempts == 0
    assert len(result.turns) == 2
    assert [message["role"] for message in resumed.calls[0]] == ["system", "user"]
    prompt, completion, reasoning, cost = _turn_usage_totals(result.turns)
    assert (prompt, completion, reasoning) == (155, 7613, 5369)
    assert cost == pytest.approx(0.0342616478)


def test_v3_database_migrates_puzzle_checkpoint_table(tmp_path):
    path = tmp_path / "migrate-v3.db"
    with BenchmarkStore(path):
        pass
    with sqlite3.connect(path) as database:
        database.execute("DROP TABLE puzzle_checkpoint")
        database.execute("PRAGMA user_version = 3")

    with BenchmarkStore(path) as store:
        run = store.start_run(_spec(), force=True)
        checkpoint = PuzzleCheckpoint(
            puzzle_id=ONE_MOVE.id,
            board_fen=ONE_MOVE.fen,
            solver_ply=0,
            active_lines=[0],
            history_san=[],
            moves_played=[],
            plies_correct=0,
            illegal_attempts=0,
            first_move_legal=None,
            all_moves_legal=True,
            answer={},
            turns=[],
            attempts_used=0,
            illegal_feedback=None,
            conversation=[],
        )
        assert store.save_puzzle_checkpoint(run.run_id, 0, ONE_MOVE.id, checkpoint)
        assert store.load_puzzle_checkpoints(run.run_id) == {ONE_MOVE.id: checkpoint}
