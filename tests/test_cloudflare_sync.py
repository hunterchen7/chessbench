import base64
import json

from chessbench.cloudflare_sync import (
    RUN_ITEM_PAYLOAD_CHUNK_BYTES,
    run_item_delivery_documents,
    sync_run,
)
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


def _large_item() -> dict[str, object]:
    return {
        "run_id": "large-run",
        "item_id": "wwxHC",
        "sequence": 0,
        "points": 1.0,
        "solved": True,
        "payload": {
            "puzzle_id": "wwxHC",
            "turns": [
                {
                    "prompt": "position",
                    "provider_response": {
                        # Reproduce the >2.3 MB wwxHC failure class.
                        "reasoning": "x" * 2_400_000
                    },
                }
            ],
        },
    }


def test_large_run_item_is_chunked_without_truncating_payload():
    item = _large_item()
    deliveries = run_item_delivery_documents(item)

    assert len(deliveries) > 2
    assert all(path == "ingest/run/item/chunk" for path, _ in deliveries[:-1])
    assert deliveries[-1][0] == "ingest/run/item"
    final = deliveries[-1][1]
    assert "payload" not in final
    descriptor = final["payload_chunks"]
    assert isinstance(descriptor, dict)
    assert descriptor["chunk_count"] == len(deliveries) - 1

    raw_chunks = [
        base64.b64decode(str(document["payload_chunk"]))
        for _, document in deliveries[:-1]
    ]
    assert all(len(chunk) <= RUN_ITEM_PAYLOAD_CHUNK_BYTES for chunk in raw_chunks)
    reconstructed = json.loads(b"".join(raw_chunks))
    assert reconstructed == item["payload"]


def test_chunk_failure_keeps_item_unsynced_and_retry_replays_idempotently():
    class FakeStore:
        def __init__(self) -> None:
            self.item = _large_item()
            self.synced: list[str] = []

        def run_start_document(self, run_id: str) -> dict[str, object]:
            return {"run_id": run_id}

        def unsynced_item_documents(
            self, run_id: str
        ) -> list[dict[str, object]]:
            return [] if self.synced else [self.item]

        def mark_item_synced(self, run_id: str, item_id: str) -> None:
            self.synced.append(item_id)

        def run_finish_document(self, run_id: str) -> dict[str, object]:
            return {"run_id": run_id, "status": "completed"}

    store = FakeStore()
    first_calls: list[str] = []

    def fail_second_chunk(
        api: str, token: str, path: str, document: dict[str, object]
    ) -> dict[str, object]:
        first_calls.append(path)
        if path == "ingest/run/item/chunk" and first_calls.count(path) == 2:
            raise OSError("temporary D1 failure")
        return {"ok": True}

    assert sync_run(  # type: ignore[arg-type]
        store,
        "https://example.test",
        "secret",
        "large-run",
        post_document=fail_second_chunk,
    ) == (0, 1)
    assert store.synced == []
    assert "ingest/run/item" not in first_calls
    assert "ingest/run/finish" not in first_calls

    retry_calls: list[str] = []

    def succeed(
        api: str, token: str, path: str, document: dict[str, object]
    ) -> dict[str, object]:
        retry_calls.append(path)
        return {"ok": True}

    assert sync_run(  # type: ignore[arg-type]
        store,
        "https://example.test",
        "secret",
        "large-run",
        post_document=succeed,
    ) == (1, 0)
    assert retry_calls.count("ingest/run/item/chunk") == len(
        run_item_delivery_documents(store.item)
    ) - 1
    assert retry_calls[-2:] == ["ingest/run/item", "ingest/run/finish"]
    assert store.synced == ["wwxHC"]
