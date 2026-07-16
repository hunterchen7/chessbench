import sqlite3
import subprocess
import sys

import pytest

from chessbench.conditions import mode_condition
from chessbench.database import BenchmarkStore, RunBusyError, RunSpec
from chessbench.report import build_report
from chessbench.tasks.games import GameRecord, MoveAttempt, MoveRecord
from chessbench.tasks.puzzles import Puzzle, PuzzleCheckpoint, PuzzleResult
from chessbench.variants import ModelVariant, ReasoningConfig


def _result(puzzle_id: str, solved: bool = True) -> PuzzleResult:
    return PuzzleResult(
        puzzle_id=puzzle_id,
        rating=1200,
        themes=["mate"],
        solved=solved,
        score=1.0 if solved else 0.0,
        first_move_legal=True,
        all_moves_legal=True,
        illegal_attempts=0,
        failure_reason=None if solved else "wrong_move",
        solver_plies=1,
        plies_correct=1 if solved else 0,
    )


def _spec() -> RunSpec:
    variant = ModelVariant(
        "test-model",
        "Test model",
        "openrouter",
        "test/model",
        ReasoningConfig(max_tokens=512),
    )
    return RunSpec(
        "puzzle",
        variant,
        mode_condition(2),
        2,
        suite_name="tiny",
        suite_hash="abc123",
        suite_visibility="public",
    )


def _generic_spec(track: str = "composed") -> RunSpec:
    variant = ModelVariant(
        "generic-model",
        "Generic model",
        "openrouter",
        "test/generic",
        ReasoningConfig(effort="low"),
    )
    return RunSpec(
        track,
        variant,
        mode_condition(3),
        1,
        suite_name="generic-tiny",
        suite_hash="generic123",
        suite_visibility="private",
    )


def test_item_commit_is_idempotent_and_run_resumes(tmp_path):
    puzzle = Puzzle("p1", "6k1/8/8/8/8/8/8/6K1 w - - 0 1", ["g1f2", "g8f7"], 1200)
    with BenchmarkStore(tmp_path / "bench.db") as store:
        first = store.start_run(_spec())
        assert not first.resumed
        assert store.save_puzzle_result(
            first.run_id, 0, puzzle, _result("p1"), cost_usd=0.01
        )
        assert not store.save_puzzle_result(
            first.run_id, 0, puzzle, _result("p1"), cost_usd=0.01
        )

        resumed = store.start_run(_spec())
        assert resumed.resumed and resumed.run_id == first.run_id
        assert resumed.completed_items == 1
        assert list(store.load_puzzle_results(first.run_id)) == ["p1"]
        assert store.run_row(first.run_id)["cost_usd"] == 0.01


def test_find_run_is_read_only_for_partial_exports(tmp_path):
    with BenchmarkStore(tmp_path / "bench.db") as store:
        run = store.start_run(_spec())
        store.mark_partial(run.run_id, "operator pause")

        found = store.find_run(_spec())

        assert found is not None
        assert found.run_id == run.run_id
        assert found.status == "partial"
        row = store.run_row(run.run_id)
        assert row["status"] == "partial"
        assert row["error"] == "operator pause"


def test_failed_run_is_retained_but_replaced_by_a_clean_run(tmp_path):
    with BenchmarkStore(tmp_path / "bench.db") as store:
        invalid = store.start_run(_spec())
        checkpoint = PuzzleCheckpoint(
            puzzle_id="failed-puzzle",
            board_fen="6k1/8/8/8/8/8/8/6K1 w - - 0 1",
            solver_ply=0,
            active_lines=[0],
            history_san=[],
            moves_played=[],
            plies_correct=0,
            illegal_attempts=0,
            first_move_legal=None,
            all_moves_legal=True,
            answer={},
            turns=[
                {
                    "prompt_tokens": 147,
                    "completion_tokens": 3979,
                    "reasoning_tokens": 2851,
                    "uncached_prompt_tokens": 147,
                    "cost_usd": 0.0154220913,
                }
            ],
            attempts_used=0,
            illegal_feedback=None,
            conversation=[],
        )
        store.save_puzzle_checkpoint(
            invalid.run_id, 0, checkpoint.puzzle_id, checkpoint
        )
        store.mark_failed(invalid.run_id, "provider null was misparsed as a move")
        failed = store.run_row(invalid.run_id)
        assert failed["status"] == "failed"
        assert "misparsed" in str(failed["error"])
        assert failed["prompt_tokens"] == 147
        assert failed["completion_tokens"] == 3979
        assert failed["reasoning_tokens"] == 2851
        assert failed["cost_usd"] == pytest.approx(0.0154220913)

        replacement = store.start_run(_spec())
        assert replacement.run_id != invalid.run_id
        assert replacement.status == "running"
        assert len(store.list_runs()) == 2


def test_executor_lock_rejects_concurrent_paid_runner_and_releases_on_close(tmp_path):
    path = tmp_path / "locked.db"
    first = BenchmarkStore(path)
    second = BenchmarkStore(path)
    try:
        run = first.start_run(_spec())
        acquired = first.acquire_run_lock(run.run_id)
        assert first.acquire_run_lock(run.run_id) is acquired

        resumed = second.start_run(_spec())
        assert resumed.run_id == run.run_id
        with pytest.raises(RunBusyError, match="already executing"):
            second.acquire_run_lock(run.run_id)

        first.close()
        takeover = second.acquire_run_lock(run.run_id)
        assert not takeover.closed
    finally:
        first.close()
        second.close()


def test_executor_lock_is_released_after_abrupt_process_death(tmp_path):
    path = tmp_path / "killed.db"
    with BenchmarkStore(path) as store:
        run = store.start_run(_spec())
        child = subprocess.Popen(
            [
                sys.executable,
                "-c",
                (
                    "import sys,time; "
                    "from chessbench.database import BenchmarkStore; "
                    "store=BenchmarkStore(sys.argv[1]); "
                    "store.acquire_run_lock(sys.argv[2]); "
                    "print('locked', flush=True); time.sleep(60)"
                ),
                str(path),
                run.run_id,
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        try:
            assert child.stdout is not None
            assert child.stdout.readline().strip() == "locked"
            with pytest.raises(RunBusyError):
                store.acquire_run_lock(run.run_id)
        finally:
            child.kill()
            child.wait(timeout=10)

        takeover = store.acquire_run_lock(run.run_id)
        assert not takeover.closed


def test_run_only_completes_after_all_items_are_persisted(tmp_path):
    p1 = Puzzle("p1", "6k1/8/8/8/8/8/8/6K1 w - - 0 1", ["g1f2", "g8f7"], 1200)
    p2 = Puzzle("p2", "6k1/8/8/8/8/8/8/6K1 w - - 0 1", ["g1f2", "g8f7"], 1200)
    with BenchmarkStore(tmp_path / "bench.db") as store:
        run = store.start_run(_spec())
        store.save_puzzle_result(run.run_id, 0, p1, _result("p1"))
        store.save_puzzle_result(run.run_id, 1, p2, _result("p2", solved=False))
        results = list(store.load_puzzle_results(run.run_id).values())
        store.finalize_puzzle_run(
            run.run_id, build_report("test", "condition", results)
        )
        row = store.run_row(run.run_id)
        assert row["status"] == "completed"
        assert '"points":1.0' in str(row["summary_json"])

        existing = store.start_run(_spec())
        assert existing.status == "completed" and not existing.resumed


def test_cloudflare_outbox_only_marks_explicit_deliveries(tmp_path):
    p1 = Puzzle("p1", "6k1/8/8/8/8/8/8/6K1 w - - 0 1", ["g1f2", "g8f7"], 1200)
    with BenchmarkStore(tmp_path / "bench.db") as store:
        spec = _spec()
        run = store.start_run(spec)
        store.save_puzzle_result(run.run_id, 0, p1, _result("p1"))
        start = store.run_start_document(run.run_id)
        assert start["model_variant"]["reasoning"]["max_tokens"] == 512
        assert len(store.unsynced_item_documents(run.run_id)) == 1
        store.mark_item_synced(run.run_id, "p1")
        assert store.unsynced_item_documents(run.run_id) == []


def test_generic_item_is_durable_resumable_and_keeps_exact_audit_payload(tmp_path):
    payload = {
        "id": "s1",
        "solved": True,
        "detail": "valid s#1",
        "turns": [
            {
                "system_prompt": None,
                "prompt": "exact composed prompt",
                "raw_response": '{"move":"b7g2","rationale":"idea"}',
                "usage": {
                    "prompt_tokens": 11,
                    "completion_tokens": 7,
                    "completion_tokens_details": {"reasoning_tokens": 3},
                },
            }
        ],
    }
    with BenchmarkStore(tmp_path / "bench.db") as store:
        run = store.start_run(_generic_spec())
        assert store.save_benchmark_item(
            run.run_id,
            0,
            "s1",
            payload,
            points=1.0,
            solved=True,
            first_move_legal=True,
            response_format_valid=True,
            cost_usd=0.002,
            prompt_tokens=11,
            completion_tokens=7,
            reasoning_tokens=3,
            cache_read_tokens=8,
            cache_write_tokens=2,
            uncached_prompt_tokens=1,
            cache_discount_usd=0.0004,
        )
        assert not store.save_benchmark_item(
            run.run_id,
            0,
            "s1",
            payload,
            points=1.0,
            solved=True,
        )
        assert store.load_benchmark_items(run.run_id) == {"s1": payload}
        resumed = store.start_run(_generic_spec())
        assert resumed.resumed and resumed.completed_items == 1
        [outbox] = store.unsynced_item_documents(run.run_id)
        assert outbox["payload"]["turns"][0]["prompt"] == "exact composed prompt"
        assert outbox["payload"]["turns"][0]["raw_response"].startswith("{")
        row = store.run_row(run.run_id)
        assert row["prompt_tokens"] == 11
        assert row["completion_tokens"] == 7
        assert row["reasoning_tokens"] == 3
        assert row["cache_read_tokens"] == 8
        assert row["cache_write_tokens"] == 2
        assert row["uncached_prompt_tokens"] == 1
        assert row["cache_discount_usd"] == pytest.approx(0.0004)
        assert outbox["cache_read_tokens"] == 8
        store.finalize_run(run.run_id, {"n": 1, "points": 1.0})


def test_game_is_durable_and_reconstructs_both_conversation_streams(tmp_path):
    white_attempt = MoveAttempt(
        "white system",
        "white prompt",
        '{"move":"e2e4","rationale":"white private"}',
        "e2e4",
        True,
        explanation="white private",
        reasoning="WHITE-PRIVATE-REASONING",
        reasoning_details=[
            {"type": "reasoning.text", "text": "WHITE-PRIVATE-REASONING"}
        ],
        prompt_tokens=10,
        completion_tokens=4,
        reasoning_tokens=2,
        cost_usd=0.001,
        cache_read_tokens=8,
        uncached_prompt_tokens=2,
        cache_discount_usd=0.0002,
    )
    black_attempt = MoveAttempt(
        "black system",
        "black prompt",
        '{"move":"e7e5","rationale":"black private"}',
        "e7e5",
        True,
        explanation="black private",
        prompt_tokens=12,
        completion_tokens=5,
        reasoning_tokens=3,
        cost_usd=0.002,
        cache_write_tokens=12,
        cache_discount_usd=0.0003,
    )
    record = GameRecord(
        "white-model",
        "black-model",
        "1/2-1/2",
        "move_cap",
        2,
        ["e4", "e5"],
        [
            MoveRecord(1, "white", "e4", "e2e4", True, 0, attempts=[white_attempt]),
            MoveRecord(2, "black", "e5", "e7e5", True, 0, attempts=[black_attempt]),
        ],
        '[Result "1/2-1/2"]\n\n1. e4 e5 1/2-1/2',
    )
    with BenchmarkStore(tmp_path / "games.db") as store:
        run = store.start_run(_generic_spec("tournament"))
        assert store.save_game_result(run.run_id, 0, record)
        assert not store.save_game_result(run.run_id, 0, record)
        restored = store.load_game_results(run.run_id)[0]
        assert restored == record
        assert restored.records[0].attempts[0].prompt == "white prompt"
        assert restored.records[0].attempts[0].reasoning == "WHITE-PRIVATE-REASONING"
        assert restored.records[0].attempts[0].reasoning_details == [
            {"type": "reasoning.text", "text": "WHITE-PRIVATE-REASONING"}
        ]
        assert restored.records[1].attempts[0].prompt == "black prompt"
        row = store.run_row(run.run_id)
        assert row["completed_items"] == 1
        assert row["prompt_tokens"] == 22
        assert row["completion_tokens"] == 9
        assert row["reasoning_tokens"] == 5
        assert row["cache_read_tokens"] == 8
        assert row["cache_write_tokens"] == 12
        assert row["uncached_prompt_tokens"] == 2
        assert row["cache_discount_usd"] == pytest.approx(0.0005)
        assert row["cost_usd"] == 0.003
        store.finalize_run(run.run_id, {"n_games": 1})
        existing = store.start_run(_generic_spec("tournament"))
        assert existing.status == "completed" and not existing.resumed


def test_running_game_upserts_attempts_then_completes_and_charges_once(tmp_path):
    first = MoveAttempt(
        "white system",
        "first prompt",
        "banana",
        None,
        False,
        prompt_tokens=5,
        completion_tokens=2,
        reasoning_tokens=1,
        cost_usd=0.01,
    )
    second = MoveAttempt(
        None,
        "retry prompt",
        '{"move":"e2e4","rationale":"center"}',
        "e2e4",
        True,
        prompt_tokens=7,
        completion_tokens=3,
        reasoning_tokens=2,
        cost_usd=0.02,
    )
    partial = MoveRecord(0, "white", None, None, False, 1, attempts=[first])
    completed_move = MoveRecord(
        1, "white", "e4", "e2e4", False, 1, attempts=[first, second]
    )
    with BenchmarkStore(tmp_path / "running.db") as store:
        run = store.start_run(_generic_spec("tournament"))
        assert store.start_game(run.run_id, 0, "white", "black", None)
        assert store.save_game_progress(
            run.run_id, 0, "white", "black", None, [partial]
        )
        running = store.load_in_progress_games(run.run_id)[0]
        assert running.records == [partial]
        assert store.run_row(run.run_id)["prompt_tokens"] == 0

        assert store.save_game_progress(
            run.run_id, 0, "white", "black", None, [completed_move]
        )
        running = store.load_in_progress_games(run.run_id)[0]
        assert running.records == [completed_move]

        record = GameRecord(
            "white",
            "black",
            "1/2-1/2",
            "move_cap",
            1,
            ["e4"],
            [completed_move],
            '[Result "1/2-1/2"]\n\n1. e4 1/2-1/2',
        )
        assert store.save_game_result(run.run_id, 0, record)
        assert not store.save_game_result(run.run_id, 0, record)
        assert store.load_in_progress_games(run.run_id) == {}
        assert store.load_game_results(run.run_id)[0] == record
        row = store.run_row(run.run_id)
        assert row["completed_items"] == 1
        assert row["prompt_tokens"] == 12
        assert row["completion_tokens"] == 5
        assert row["reasoning_tokens"] == 3
        assert row["cost_usd"] == pytest.approx(0.03)


def test_resumed_puzzle_finalize_keeps_cost_from_every_process(tmp_path):
    puzzles = [
        Puzzle(
            puzzle_id,
            "6k1/8/8/8/8/8/8/6K1 w - - 0 1",
            ["g1f2", "g8f7"],
            1200,
        )
        for puzzle_id in ("p1", "p2")
    ]
    results = [_result("p1"), _result("p2", solved=False)]
    with BenchmarkStore(tmp_path / "resume-cost.db") as store:
        run = store.start_run(_spec())
        assert store.save_puzzle_result(
            run.run_id, 0, puzzles[0], results[0], cost_usd=0.1
        )
        store.mark_partial(run.run_id, "interrupted")
        resumed = store.start_run(_spec())
        assert resumed.run_id == run.run_id and resumed.resumed
        assert store.save_puzzle_result(
            run.run_id, 1, puzzles[1], results[1], cost_usd=0.2
        )
        store.finalize_puzzle_run(
            run.run_id, build_report("m", mode_condition(2).slug(), results)
        )
        row = store.run_row(run.run_id)
        assert row["status"] == "completed"
        assert row["cost_usd"] == pytest.approx(0.3)


def test_v2_database_migrates_generic_item_table(tmp_path):
    path = tmp_path / "migrate.db"
    with BenchmarkStore(path):
        pass
    with sqlite3.connect(path) as db:
        db.execute("DROP TABLE benchmark_item")
        db.execute("PRAGMA user_version = 2")
    with BenchmarkStore(path) as store:
        run = store.start_run(_generic_spec())
        assert store.save_benchmark_item(
            run.run_id,
            0,
            "migrated",
            {"id": "migrated", "turns": []},
            points=0.0,
            solved=False,
        )
