"""Run-record store: json_safe, self-contained export, roundtrip, indexing."""

import chess

from chessbench.conditions import HEADLINE
from chessbench.report import build_report
from chessbench.store import RunRecord, json_safe, list_runs, load_run, save_run
from chessbench.tasks.puzzles import Puzzle, PuzzleResult


def test_json_safe_replaces_non_finite():
    out = json_safe({"a": float("inf"), "b": [float("-inf"), float("nan"), 1.5], "c": "x"})
    assert out == {"a": None, "b": [None, None, 1.5], "c": "x"}


def _results():
    return [
        PuzzleResult("p1", 1200, ["fork"], solved=True, score=1.0, first_move_legal=True,
                     all_moves_legal=True, illegal_attempts=0, failure_reason=None,
                     solver_plies=1, plies_correct=1, answer_move="a1a8",
                     answer_explanation="back-rank mate", answer_raw="Ra8#"),
        PuzzleResult("p2", 1600, ["pin"], solved=False, score=0.0, first_move_legal=False,
                     all_moves_legal=False, illegal_attempts=1, failure_reason="illegal",
                     solver_plies=1, plies_correct=0),
    ]


def _puzzles():
    return {
        "p1": Puzzle("p1", "6k1/5ppp/8/8/8/7q/8/R5K1 b - - 0 1", ["h3h6", "a1a8"], 1200, themes=["fork"]),
        "p2": Puzzle("p2", chess.STARTING_FEN, ["e2e4", "e7e5"], 1600, themes=["pin"]),
    }


def test_run_record_export_is_self_contained_and_valid(tmp_path):
    results = _results()
    report = build_report("m", HEADLINE.slug(), results)
    record = RunRecord(model="m", provider="openrouter", condition=HEADLINE,
                       report=report, results=results, puzzles=_puzzles(), cost_usd=0.001)
    path = tmp_path / "run.json"
    save_run(record, path)

    assert "Infinity" not in path.read_text()          # strict-valid JSON (no non-finite)
    run = load_run(path)
    assert run["schema"] == "chessbench.run.v1"
    assert run["summary"]["n"] == 2
    items = run["items"]
    assert len(items) == 2
    assert items[0]["rating"] == 1200                  # ordered easy -> hard
    assert items[0]["fen"] and "solution" in items[0]  # board + solution embedded
    assert "seq_elo" in items[0] and "categories" in items[0]
    assert items[0]["answer_explanation"] == "back-rank mate"


def test_list_runs_indexes_directory(tmp_path):
    report = build_report("m", HEADLINE.slug(), _results())
    save_run(RunRecord("m", "openrouter", HEADLINE, report, _results(), _puzzles()), tmp_path / "r.json")
    (tmp_path / "not-a-run.json").write_text('{"schema": "other"}')
    index = list_runs(tmp_path)
    assert len(index) == 1 and index[0]["model"] == "m"
