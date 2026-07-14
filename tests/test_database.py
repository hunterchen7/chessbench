from chessbench.conditions import mode_condition
from chessbench.database import BenchmarkStore, RunSpec
from chessbench.report import build_report
from chessbench.tasks.puzzles import Puzzle, PuzzleResult
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


def test_item_commit_is_idempotent_and_run_resumes(tmp_path):
    puzzle = Puzzle("p1", "6k1/8/8/8/8/8/8/6K1 w - - 0 1", ["g1f2", "g8f7"], 1200)
    with BenchmarkStore(tmp_path / "bench.db") as store:
        first = store.start_run(_spec())
        assert not first.resumed
        assert store.save_puzzle_result(first.run_id, 0, puzzle, _result("p1"), cost_usd=0.01)
        assert not store.save_puzzle_result(first.run_id, 0, puzzle, _result("p1"), cost_usd=0.01)

        resumed = store.start_run(_spec())
        assert resumed.resumed and resumed.run_id == first.run_id
        assert resumed.completed_items == 1
        assert list(store.load_puzzle_results(first.run_id)) == ["p1"]
        assert store.run_row(first.run_id)["cost_usd"] == 0.01


def test_run_only_completes_after_all_items_are_persisted(tmp_path):
    p1 = Puzzle("p1", "6k1/8/8/8/8/8/8/6K1 w - - 0 1", ["g1f2", "g8f7"], 1200)
    p2 = Puzzle("p2", "6k1/8/8/8/8/8/8/6K1 w - - 0 1", ["g1f2", "g8f7"], 1200)
    with BenchmarkStore(tmp_path / "bench.db") as store:
        run = store.start_run(_spec())
        store.save_puzzle_result(run.run_id, 0, p1, _result("p1"))
        store.save_puzzle_result(run.run_id, 1, p2, _result("p2", solved=False))
        results = list(store.load_puzzle_results(run.run_id).values())
        store.finalize_puzzle_run(run.run_id, build_report("test", "condition", results))
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
