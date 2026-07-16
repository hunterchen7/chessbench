"""Run-record store: json_safe, self-contained export, roundtrip, indexing."""

import json
from dataclasses import replace
from types import SimpleNamespace

import chess

from chessbench.conditions import HEADLINE, mode_condition
from chessbench.report import build_report
from chessbench.response_protocols import ResponseProtocol
from chessbench.store import (
    RunRecord,
    json_safe,
    list_composed_runs,
    list_runs,
    load_run,
    save_run,
)
from chessbench.tasks.puzzles import Puzzle, PuzzleResult
from chessbench.variants import ModelVariant, ReasoningConfig


def test_json_safe_replaces_non_finite():
    out = json_safe(
        {"a": float("inf"), "b": [float("-inf"), float("nan"), 1.5], "c": "x"}
    )
    assert out == {"a": None, "b": [None, None, 1.5], "c": "x"}


def _results():
    return [
        PuzzleResult(
            "p1",
            1200,
            ["fork"],
            solved=True,
            score=1.0,
            first_move_legal=True,
            all_moves_legal=True,
            illegal_attempts=0,
            failure_reason=None,
            solver_plies=1,
            plies_correct=1,
            answer_move="a1a8",
            answer_explanation="back-rank mate",
            answer_raw="Ra8#",
        ),
        PuzzleResult(
            "p2",
            1600,
            ["pin"],
            solved=False,
            score=0.0,
            first_move_legal=False,
            all_moves_legal=False,
            illegal_attempts=1,
            failure_reason="illegal",
            solver_plies=1,
            plies_correct=0,
        ),
    ]


def _puzzles():
    return {
        "p1": Puzzle(
            "p1",
            "6k1/5ppp/8/8/8/7q/8/R5K1 b - - 0 1",
            ["h3h6", "a1a8"],
            1200,
            themes=["fork"],
        ),
        "p2": Puzzle("p2", chess.STARTING_FEN, ["e2e4", "e7e5"], 1600, themes=["pin"]),
    }


def test_run_record_export_is_self_contained_and_valid(tmp_path):
    results = _results()
    report = build_report("m", HEADLINE.slug(), results)
    record = RunRecord(
        model="m",
        provider="openrouter",
        condition=HEADLINE,
        report=report,
        results=results,
        puzzles=_puzzles(),
        cost_usd=0.001,
    )
    path = tmp_path / "run.json"
    save_run(record, path)

    assert "Infinity" not in path.read_text()  # strict-valid JSON (no non-finite)
    run = load_run(path)
    assert run["schema"] == "chessbench.run.v1"
    assert run["summary"]["n"] == 2
    assert run["summary"]["points"] == 1.0
    assert run["summary"]["max_points"] == 2
    assert run["status"] == "completed"
    assert run["progress"] == {"completed": 2, "total": 2}
    items = run["items"]
    assert len(items) == 2
    assert items[0]["rating"] == 1200  # ordered easy -> hard
    assert items[0]["fen"] and "solution" in items[0]  # board + solution embedded
    assert run["summary"]["puzzle_performance_rating"]["n"] == 2
    assert "turns" in items[0] and "categories" in items[0]
    assert items[0]["answer_explanation"] == "back-rank mate"


def test_list_runs_indexes_directory(tmp_path):
    report = build_report("m", HEADLINE.slug(), _results())
    save_run(
        RunRecord("m", "openrouter", HEADLINE, report, _results(), _puzzles()),
        tmp_path / "r.json",
    )
    (tmp_path / "not-a-run.json").write_text('{"schema": "other"}')
    index = list_runs(tmp_path)
    assert len(index) == 1 and index[0]["model"] == "m"
    assert index[0]["provider"] == "openrouter"
    assert index[0]["model_variant"]["provider"] == "openrouter"
    assert index[0]["condition"] == HEADLINE.to_dict()
    assert index[0]["condition_slug"] == HEADLINE.slug()
    assert index[0]["status"] == "completed"
    assert index[0]["progress"] == {"completed": 2, "total": 2}


def test_export_preserves_rich_run_identity_and_is_filename_deterministic(tmp_path):
    from chessbench.__main__ import cmd_export

    data = tmp_path / "data"
    runs = data / "runs"
    runs.mkdir(parents=True)
    report = build_report("m", HEADLINE.slug(), _results())

    legacy = RunRecord(
        "legacy/model",
        "openrouter",
        HEADLINE,
        report,
        _results(),
        _puzzles(),
    ).to_dict()
    (runs / "a-legacy.json").write_text(json.dumps(legacy), encoding="utf-8")

    condition = replace(
        mode_condition(3),
        response_protocol=ResponseProtocol.PROMPT_JSON_V1,
        reasoning_effort="low",
        max_output_tokens=8192,
    )
    variant = ModelVariant(
        base_key="claude-haiku-4.5",
        display_name="Claude Haiku 4.5",
        provider="openrouter",
        model_id="anthropic/claude-haiku-4.5",
        reasoning=ReasoningConfig(effort="low"),
        max_output_tokens=8192,
    )
    rich = RunRecord(
        model="anthropic/claude-haiku-4.5",
        provider="openrouter",
        condition=condition,
        report=report,
        results=_results(),
        puzzles=_puzzles(),
        suite=None,
        run_id="run-rich",
        model_variant=variant.to_dict(),
        created="2026-07-15T12:00:00+00:00",
    ).to_dict()
    rich.update(
        {
            "track": "puzzle",
            "status": "completed",
            "progress": {"completed": 2, "total": 2},
            "usage": {
                "prompt_tokens": 100,
                "completion_tokens": 50,
                "reasoning_tokens": 25,
                "cost_usd": 0.01,
            },
            "updated_at": "2026-07-15T12:03:00+00:00",
            "completed_at": "2026-07-15T12:03:00+00:00",
            "error": None,
        }
    )
    (runs / "z-rich.json").write_text(json.dumps(rich), encoding="utf-8")

    args = SimpleNamespace(runs_dir=str(runs), out=str(data / "index.json"))
    assert cmd_export(args) == 0
    first = (data / "index.json").read_bytes()
    exported = json.loads(first)
    assert exported["schema"] == "chessbench.index.v2"
    assert first.endswith(b"\n")
    entries = exported["runs"]
    assert [entry["file"] for entry in entries] == ["a-legacy.json", "z-rich.json"]

    legacy_entry, rich_entry = entries
    assert legacy_entry["model_variant"]["provider"] == "openrouter"
    assert legacy_entry["model_variant"]["max_output_tokens"] == 2048
    assert rich_entry == {
        "run_id": "run-rich",
        "file": "z-rich.json",
        "track": "puzzle",
        "kind": "puzzle",
        "status": "completed",
        "model": "anthropic/claude-haiku-4.5",
        "model_variant": variant.to_dict(),
        "provider": "openrouter",
        "created": "2026-07-15T12:00:00+00:00",
        "condition": condition.to_dict(),
        "condition_slug": condition.slug(),
        "suite": None,
        "progress": {"completed": 2, "total": 2},
        "summary": rich["summary"],
        "updated_at": "2026-07-15T12:03:00+00:00",
        "completed_at": "2026-07-15T12:03:00+00:00",
        "usage": rich["usage"],
        "error": None,
    }
    assert rich_entry["model_variant"]["max_output_tokens"] == 8192
    assert rich_entry["condition"]["response_protocol"] == "prompt_json_v1"

    assert cmd_export(args) == 0
    assert (data / "index.json").read_bytes() == first


def _composed_run(model="openai/example", solve_rate=0.5):
    return {
        "schema": "chessbench.composed_run.v1",
        "created": "2026-07-15T12:00:00+00:00",
        "model": model,
        "solver": "openrouter",
        "suite": {"name": "esoteric-smoke-v1"},
        "condition": {"slug": "legal_list__fen_pieces__uci__coached"},
        "summary": {"n": 2, "solved": 1, "solve_rate": solve_rate},
        "items": [{"id": "one"}, {"id": "two"}],
    }


def test_list_composed_runs_is_sorted_and_excludes_malformed_files(tmp_path):
    (tmp_path / "zeta.json").write_text(
        json.dumps(_composed_run("anthropic/zeta", 0.25)), encoding="utf-8"
    )
    (tmp_path / "alpha.json").write_text(
        json.dumps(_composed_run("openai/alpha", 0.75)), encoding="utf-8"
    )
    (tmp_path / "index.json").write_text(
        json.dumps({"schema": "chessbench.composed_index.v1", "runs": []}),
        encoding="utf-8",
    )
    (tmp_path / "wrong-schema.json").write_text(
        json.dumps({"schema": "other"}), encoding="utf-8"
    )
    (tmp_path / "missing-model.json").write_text(
        json.dumps(_composed_run(model="")), encoding="utf-8"
    )
    (tmp_path / "bad-rate.json").write_text(
        json.dumps(_composed_run(solve_rate=float("nan"))), encoding="utf-8"
    )
    (tmp_path / "truncated.json").write_text("{", encoding="utf-8")

    assert list_composed_runs(tmp_path) == [
        {
            "file": "alpha.json",
            "model": "openai/alpha",
            "solver": "openrouter",
            "created": "2026-07-15T12:00:00+00:00",
            "suite": "esoteric-smoke-v1",
            "condition": "legal_list__fen_pieces__uci__coached",
            "solve_rate": 0.75,
        },
        {
            "file": "zeta.json",
            "model": "anthropic/zeta",
            "solver": "openrouter",
            "created": "2026-07-15T12:00:00+00:00",
            "suite": "esoteric-smoke-v1",
            "condition": "legal_list__fen_pieces__uci__coached",
            "solve_rate": 0.25,
        },
    ]


def test_export_rebuilds_composed_index_deterministically(tmp_path):
    from chessbench.__main__ import cmd_export

    data = tmp_path / "data"
    runs = data / "runs"
    composed = data / "composed"
    runs.mkdir(parents=True)
    composed.mkdir()
    (composed / "run.json").write_text(json.dumps(_composed_run()), encoding="utf-8")
    args = SimpleNamespace(runs_dir=str(runs), out=str(data / "index.json"))

    assert cmd_export(args) == 0
    first = (composed / "index.json").read_bytes()
    assert first.endswith(b"\n")
    assert json.loads(first) == {
        "schema": "chessbench.composed_index.v1",
        "runs": [
            {
                "file": "run.json",
                "model": "openai/example",
                "solver": "openrouter",
                "created": "2026-07-15T12:00:00+00:00",
                "suite": "esoteric-smoke-v1",
                "condition": "legal_list__fen_pieces__uci__coached",
                "solve_rate": 0.5,
            }
        ],
    }

    assert cmd_export(args) == 0
    assert (composed / "index.json").read_bytes() == first
