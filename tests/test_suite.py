"""Frozen suites: deterministic sampling, content hashing, and tamper detection —
so every model provably runs the identical item set."""

import json
import pathlib

import pytest

from chessbench.suite import build_puzzle_suite, load_suite, save_suite, save_suite_manifest
from chessbench.tasks.puzzles import load_puzzles

SAMPLE = pathlib.Path(__file__).resolve().parent.parent / "data" / "sample_puzzles.csv"


def _source():
    return load_puzzles(SAMPLE)


def test_same_seed_is_reproducible():
    a = build_puzzle_suite(_source(), name="t", per_bucket=5, seed=0)
    b = build_puzzle_suite(_source(), name="t", per_bucket=5, seed=0)
    assert a.content_hash == b.content_hash
    assert [it["id"] for it in a.items] == [it["id"] for it in b.items]


def test_different_seed_changes_selection():
    a = build_puzzle_suite(_source(), name="t", per_bucket=5, seed=0)
    b = build_puzzle_suite(_source(), name="t", per_bucket=5, seed=1)
    assert a.content_hash != b.content_hash


def test_roundtrip_and_tamper_guard(tmp_path):
    suite = build_puzzle_suite(_source(), name="t", per_bucket=3, seed=0)
    path = tmp_path / "suite.json"
    save_suite(suite, path)

    loaded = load_suite(path)
    assert loaded.content_hash == suite.content_hash
    assert len(loaded.puzzles()) == len(suite.items)

    # editing items after freezing must be detected on load
    data = json.loads(path.read_text())
    data["items"][0]["rating"] = 99999
    path.write_text(json.dumps(data))
    with pytest.raises(ValueError, match="hash mismatch"):
        load_suite(path)


def test_items_are_rating_stratified():
    suite = build_puzzle_suite(_source(), name="t", per_bucket=4, seed=0, lo=600, hi=2800, width=200)
    ratings = [int(it["rating"]) for it in suite.items]
    assert all(600 <= r < 2800 for r in ratings)
    assert len(set(it["id"] for it in suite.items)) == len(suite.items)  # no duplicates


def test_checked_in_composed_suite_loads_as_composed_problems():
    suite = load_suite(
        pathlib.Path(__file__).resolve().parent.parent / "suites" / "public" / "esoteric-seed-v1.json"
    )
    problems = suite.composed_problems()
    assert suite.kind == "composed"
    assert problems
    assert any(problem.kind == "selfmate" for problem in problems)
    with pytest.raises(ValueError, match="not puzzle"):
        suite.puzzles()


def test_private_suite_requires_private_directory_and_manifest_redacts(tmp_path):
    suite = build_puzzle_suite(
        _source(), name="held-out", per_bucket=2, seed=991, visibility="private"
    )
    with pytest.raises(ValueError, match="directory named 'private'"):
        save_suite(suite, tmp_path / "leaked.json")
    with pytest.raises(ValueError, match="directory named 'private'"):
        save_suite(suite, tmp_path / "public" / "leaked.json")

    private_path = tmp_path / "private" / "suite.json"
    save_suite(suite, private_path)
    assert load_suite(private_path).content_hash == suite.content_hash

    manifest_path = tmp_path / "dashboard" / "manifest.json"
    save_suite_manifest(suite, manifest_path)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["items"] == len(suite.items)
    assert "seed" not in manifest
    assert "items" in manifest and not isinstance(manifest["items"], list)
