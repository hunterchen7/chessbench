from chessbench.cloudflare_sync import sync_run
from chessbench.conditions import mode_condition
from chessbench.database import BenchmarkStore, RunSpec
from chessbench.report import build_report
from chessbench.tasks.puzzles import Puzzle, PuzzleResult
from chessbench.variants import ModelVariant, ReasoningConfig


def _completed_run(store: BenchmarkStore) -> str:
    variant = ModelVariant(
        "sync-model",
        "Sync model",
        "openrouter",
        "test/sync-model",
        ReasoningConfig(effort="low"),
    )
    spec = RunSpec(
        "puzzle",
        variant,
        mode_condition(1),
        1,
        suite_name="sync-tiny",
        suite_hash="sync-hash",
        suite_visibility="public",
    )
    puzzle = Puzzle(
        "p1",
        "6k1/8/8/8/8/8/8/6K1 w - - 0 1",
        ["g1f2", "g8f7"],
        1200,
    )
    result = PuzzleResult(
        puzzle_id="p1",
        rating=1200,
        themes=["endgame"],
        solved=True,
        score=1.0,
        first_move_legal=True,
        all_moves_legal=True,
        illegal_attempts=0,
        failure_reason=None,
        solver_plies=1,
        plies_correct=1,
    )
    run = store.start_run(spec)
    store.save_puzzle_result(run.run_id, 0, puzzle, result)
    store.finalize_puzzle_run(
        run.run_id, build_report("test/sync-model", spec.condition.slug(), [result])
    )
    return run.run_id


def test_sync_run_marks_items_only_after_remote_acknowledgement(tmp_path):
    calls: list[str] = []

    def fake_post(
        api: str, token: str, path: str, document: dict[str, object]
    ) -> dict[str, object]:
        assert api == "https://example.test"
        assert token == "secret"
        assert document
        calls.append(path)
        return {"ok": True}

    with BenchmarkStore(tmp_path / "bench.db") as store:
        run_id = _completed_run(store)
        assert sync_run(
            store,
            "https://example.test",
            "secret",
            run_id,
            post_document=fake_post,
        ) == (1, 0)
        assert calls == ["ingest/run/start", "ingest/run/item", "ingest/run/finish"]
        assert store.unsynced_item_documents(run_id) == []


def test_sync_run_keeps_failed_items_in_local_outbox(tmp_path):
    calls: list[str] = []

    def failing_post(
        api: str, token: str, path: str, document: dict[str, object]
    ) -> dict[str, object]:
        calls.append(path)
        if path == "ingest/run/item":
            raise OSError("offline")
        return {"ok": True}

    with BenchmarkStore(tmp_path / "bench.db") as store:
        run_id = _completed_run(store)
        assert sync_run(
            store,
            "https://example.test",
            "secret",
            run_id,
            post_document=failing_post,
        ) == (0, 1)
        assert calls == ["ingest/run/start", "ingest/run/item"]
        assert len(store.unsynced_item_documents(run_id)) == 1
