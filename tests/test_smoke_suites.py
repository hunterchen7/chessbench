import json
import pathlib
from collections import Counter
from dataclasses import asdict

import chess

from chessbench.conditions import mode_condition
from chessbench.suite import load_suite
from chessbench.tasks.composed import OracleComposedSolver, grade_composed
from scripts.build_smoke_suites import SEED, build

ROOT = pathlib.Path(__file__).resolve().parent.parent

EXPECTED = {
    "standard-smoke-v1": {
        "path": "suites/public/standard-smoke-v1.json",
        "parent": "suites/public/standard-lichess-v2.json",
        "count": 14,
        "hash": "sha256:63ca1208b6c74ec6",
        "version": "1.0.0",
    },
    "standard-smoke-v2": {
        "path": "suites/public/standard-smoke-v2.json",
        "parent": "suites/public/standard-lichess-v3.json",
        "count": 14,
        "hash": "sha256:67c948d7899cfe43",
        "version": "2.0.0",
    },
    "standard-smoke-v3": {
        "path": "suites/public/standard-smoke-v3.json",
        "parent": "suites/public/standard-lichess-v4.json",
        "count": 20,
        "hash": "sha256:65463c83a64a0cfe",
        "version": "3.0.0",
    },
    "woodpecker-smoke-v1": {
        "path": "suites/public/woodpecker-smoke-v1.json",
        "parent": "suites/public/woodpecker-masters-v1.json",
        "count": 6,
        "hash": "sha256:486f9b5e854c299d",
        "version": "1.0.0",
    },
    "esoteric-smoke-v2": {
        "path": "suites/public/esoteric-smoke-v2.json",
        "parent": "suites/public/esoteric-seed-v2.json",
        "count": 7,
        "hash": "sha256:607064f731e3dba3",
        "version": "2.0.0",
    },
}


def test_smoke_suites_have_frozen_metadata_and_documented_hashes():
    catalog = (ROOT / "docs/SUITES.md").read_text(encoding="utf-8")
    for name, expected in EXPECTED.items():
        suite = load_suite(ROOT / expected["path"])
        parent = load_suite(ROOT / expected["parent"])
        assert suite.name == name
        assert suite.version == expected["version"]
        assert suite.visibility == "public"
        assert suite.seed == SEED
        assert len(suite.items) == expected["count"]
        assert suite.content_hash == expected["hash"]
        assert suite.source == f"suite:{parent.name}@{parent.content_hash}"
        assert (
            f"| `{expected['path']}` | {expected['count']} | `{expected['hash']}` |"
        ) in catalog


def test_smoke_suites_are_exact_ordered_subsets_of_canonical_parents():
    for expected in EXPECTED.values():
        suite = load_suite(ROOT / expected["path"])
        parent = load_suite(ROOT / expected["parent"])
        parent_items = (
            {str(item["id"]): item for item in parent.items}
            if suite.kind == "puzzle"
            else {problem.id: asdict(problem) for problem in parent.composed_problems()}
        )
        ids = [str(item["id"]) for item in suite.items]
        if suite.name in {
            "standard-smoke-v2",
            "standard-smoke-v3",
        }:
            assert [
                (int(item["rating"]), str(item["id"])) for item in suite.items
            ] == sorted((int(item["rating"]), str(item["id"])) for item in suite.items)
        elif suite.kind == "puzzle":
            assert ids == sorted(ids)
        else:
            assert [
                (str(item["kind"]), str(item["id"])) for item in suite.items
            ] == sorted((str(item["kind"]), str(item["id"])) for item in suite.items)
        assert len(ids) == len(set(ids))
        assert all(item == parent_items[str(item["id"])] for item in suite.items)


def test_builder_reproduces_committed_smoke_suites_byte_for_byte():
    for generated, path in build():
        committed = json.loads(path.read_text(encoding="utf-8"))
        assert asdict(generated) == committed


def test_every_smoke_puzzle_solution_line_is_legal():
    for path in (
        ROOT / "suites/public/standard-smoke-v1.json",
        ROOT / "suites/public/standard-smoke-v2.json",
        ROOT / "suites/public/standard-smoke-v3.json",
        ROOT / "suites/public/woodpecker-smoke-v1.json",
    ):
        for puzzle in load_suite(path).puzzles():
            start = chess.Board(puzzle.fen)
            setup = chess.Move.from_uci(puzzle.moves[0])
            assert setup in start.legal_moves
            start.push(setup)
            for line in puzzle.solution_lines():
                board = start.copy()
                for uci in line:
                    move = chess.Move.from_uci(uci)
                    assert move in board.legal_moves
                    board.push(move)


def test_standard_smoke_suite_is_small_and_rating_balanced():
    suite = load_suite(ROOT / "suites/public/standard-smoke-v3.json")
    puzzles = suite.puzzles()
    assert len(puzzles) == 20
    assert sum(puzzle.num_solver_plies() for puzzle in puzzles) == 69
    assert [
        sum(low <= puzzle.rating <= high for puzzle in puzzles)
        for low, high in (
            (600, 899),
            (900, 1199),
            (1200, 1499),
            (1500, 1799),
            (1800, 2099),
            (2100, 2399),
            (2400, 2599),
            (2600, 2799),
            (2800, 2999),
            (3000, 3199),
        )
    ] == [2] * 10


def test_woodpecker_smoke_suite_is_small_and_requires_long_lines():
    suite = load_suite(ROOT / "suites/public/woodpecker-smoke-v1.json")
    puzzles = suite.puzzles()
    assert len(puzzles) == 6
    assert Counter(puzzle.difficulty_band for puzzle in puzzles) == {
        "easy": 2,
        "medium": 2,
        "hard": 2,
    }
    assert all(len(puzzle.moves[1::2]) >= 3 for puzzle in puzzles)
    assert "historic-deep-blue-kasparov-1997-g2" not in {
        puzzle.id for puzzle in puzzles
    }
    assert all(puzzle.game_url.startswith("https://") for puzzle in puzzles)


def test_esoteric_smoke_suite_has_one_of_every_public_genre():
    suite = load_suite(ROOT / "suites/public/esoteric-smoke-v2.json")
    counts = Counter(problem.kind for problem in suite.composed_problems())
    assert len(suite.items) == 7
    assert counts == {
        "directmate": 1,
        "helpmate": 1,
        "proofgame": 1,
        "reflexmate": 1,
        "selfmate": 1,
        "series_directmate": 1,
        "series_helpmate": 1,
    }


def test_esoteric_smoke_known_solutions_pass_native_graders():
    suite = load_suite(ROOT / "suites/public/esoteric-smoke-v2.json")
    condition = mode_condition(3)
    results = [
        grade_composed(OracleComposedSolver(), problem, condition)
        for problem in suite.composed_problems()
    ]
    assert all(result.solved for result in results)


def test_smoke_model_registry_slugs_are_exact():
    registry = json.loads((ROOT / "registry/models.json").read_text(encoding="utf-8"))
    labels = [entry["label"] for entry in registry["models"]]
    assert len(labels) == len(set(labels))
    by_label = {entry["label"]: entry for entry in registry["models"]}
    assert by_label["gpt-5.6-luna"] == {
        "label": "gpt-5.6-luna",
        "provider": "openrouter",
        "model_id": "openai/gpt-5.6-luna",
        "family": "openai",
        "notes": "cheaper GPT-5.6 tier ($1/$6)",
        "enabled": True,
    }
    assert by_label["claude-haiku-4.5"] == {
        "label": "claude-haiku-4.5",
        "provider": "openrouter",
        "model_id": "anthropic/claude-haiku-4.5",
        "family": "anthropic",
        "notes": "Anthropic Claude Haiku 4.5 — low-cost reasoning model",
        "enabled": True,
    }
    assert by_label["qwen3.5-flash"] == {
        "label": "qwen3.5-flash",
        "provider": "openrouter",
        "model_id": "qwen/qwen3.5-flash-02-23",
        "family": "qwen",
        "notes": "Low-cost Qwen 3.5 Flash proof model",
        "enabled": True,
    }
    assert by_label["mistral-small-4"] == {
        "label": "mistral-small-4",
        "provider": "openrouter",
        "model_id": "mistralai/mistral-small-2603",
        "family": "mistral",
        "notes": "Low-cost Mistral Small 4 compatibility model",
        "enabled": True,
    }
    assert by_label["mercury-2"] == {
        "label": "mercury-2",
        "provider": "openrouter",
        "model_id": "inception/mercury-2",
        "family": "inception",
        "notes": "Fast low-cost Mercury 2 compatibility model",
        "enabled": True,
    }
