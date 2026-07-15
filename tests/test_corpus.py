"""Corpus provenance, deterministic selection, and checked-in release QA."""

from __future__ import annotations

import json
import pathlib

import pytest

from chessbench.corpus import load_corpus, select_stratified_puzzles
from chessbench.suite import load_suite
from chessbench.tasks.puzzles import load_puzzles

ROOT = pathlib.Path(__file__).resolve().parent.parent
SAMPLE = ROOT / "data" / "sample_puzzles.csv"
CORPORA = ROOT / "corpora" / "public"


def test_stratified_selection_is_stable_and_exact():
    source = load_puzzles(SAMPLE)
    kwargs = {
        "bands": [(600, 1000), (1000, 1400), (1400, 1800)],
        "per_band": 5,
        "seed": 17,
        "namespace": "test",
    }
    first = select_stratified_puzzles(source, **kwargs)
    second = select_stratified_puzzles(list(reversed(source)), **kwargs)
    assert [p.id for p in first] == [p.id for p in second]
    assert len(first) == 15


def test_exclusion_makes_collections_disjoint():
    source = load_puzzles(SAMPLE)
    bands = [(600, 1000), (1000, 1400), (1400, 1800)]
    woodpecker = select_stratified_puzzles(
        source,
        bands=bands,
        per_band=4,
        seed=7,
        namespace="wood",
        min_solver_plies=2,
    )
    standard = select_stratified_puzzles(
        source,
        bands=bands,
        per_band=4,
        seed=7,
        namespace="standard",
        exclude_ids={p.id for p in woodpecker},
    )
    assert {p.id for p in standard}.isdisjoint({p.id for p in woodpecker})
    assert all(p.num_solver_plies() >= 2 for p in woodpecker)


def test_checked_in_corpora_are_valid_and_content_addressed():
    paths = sorted(CORPORA.glob("*.json"))
    corpora = {corpus.name: corpus for corpus in map(load_corpus, paths)}
    assert {
        "standard-seed-v1",
        "woodpecker-seed-v1",
        "standard-public-v1",
        "woodpecker-public-v1",
        "standard-lichess-v2",
        "woodpecker-masters-v1",
        "esoteric-seed-v1",
    } <= set(corpora)
    assert all(corpus.validation["valid"] is True for corpus in corpora.values())
    assert all(corpus.content_hash.startswith("sha256:") for corpus in corpora.values())

    for release in ("seed-v1", "public-v1"):
        standard_ids = {p.id for p in corpora[f"standard-{release}"].puzzles()}
        woodpecker = corpora[f"woodpecker-{release}"].puzzles()
        assert standard_ids.isdisjoint({p.id for p in woodpecker})
        assert all(p.num_solver_plies() >= 2 for p in woodpecker)

    kinds = {problem.kind for problem in corpora["esoteric-seed-v1"].composed_problems()}
    assert {"selfmate", "reflexmate", "helpmate", "proofgame"} <= kinds


def test_public_v1_has_six_exact_rating_strata():
    for track, per_band in (("standard", 40), ("woodpecker", 20)):
        corpus = load_corpus(CORPORA / f"{track}-public-v1.json")
        ratings = [p.rating for p in corpus.puzzles()]
        for lo in range(600, 3000, 400):
            assert sum(lo <= rating < lo + 400 for rating in ratings) == per_band
        assert corpus.sources[0]["snapshot"] == "2026-07-05"
        assert corpus.selection["source_pool_sha256"] == (
            "c6f202da8b801cc091f4b4e070e9e2528883584b2db33a86f34cea081f0097ed"
        )


def test_full_snapshot_releases_have_exact_strata_and_master_game_lines():
    standard = load_corpus(CORPORA / "standard-lichess-v2.json")
    woodpecker = load_corpus(CORPORA / "woodpecker-masters-v1.json")
    assert len(standard.items) == 325
    assert len(woodpecker.items) == 136
    for lo in range(600, 3000, 400):
        band = [puzzle for puzzle in standard.puzzles() if lo <= puzzle.rating < lo + 400]
        assert len(band) == 50
        assert all(puzzle.nb_plays > 500 for puzzle in band)
        assert all(puzzle.rating_deviation < 100 for puzzle in band)
    for lo in range(1000, 3000, 400):
        band = [puzzle for puzzle in woodpecker.puzzles() if lo <= puzzle.rating < lo + 400]
        assert len(band) == 25
        assert all(puzzle.num_solver_plies() >= 3 for puzzle in band)
        assert all(puzzle.nb_plays > 500 for puzzle in band)
        assert all(puzzle.rating_deviation < 100 for puzzle in band)
        assert all({"master", "masterVsMaster", "superGM"} & set(puzzle.themes) for puzzle in band)
        assert all(puzzle.game_url.startswith("https://lichess.org/") for puzzle in band)

    standard_frontier = [puzzle for puzzle in standard.puzzles() if 3000 <= puzzle.rating < 3200]
    assert len(standard_frontier) == 25
    assert all(puzzle.nb_plays > 500 for puzzle in standard_frontier)
    assert all(puzzle.rating_deviation < 110 for puzzle in standard_frontier)
    assert all(puzzle.popularity >= 85 for puzzle in standard_frontier)

    wood_frontier = [puzzle for puzzle in woodpecker.puzzles() if 3000 <= puzzle.rating < 3200]
    assert len(wood_frontier) == 10
    assert all(puzzle.nb_plays > 500 for puzzle in wood_frontier)
    assert all(puzzle.rating_deviation < 120 for puzzle in wood_frontier)
    assert all(puzzle.popularity >= 80 for puzzle in wood_frontier)
    assert all(puzzle.num_solver_plies() >= 3 for puzzle in wood_frontier)

    sections = {name: [p for p in woodpecker.puzzles() if p.difficulty_band == name] for name in ("easy", "medium", "hard")}
    assert {name: len(items) for name, items in sections.items()} == {"easy": 50, "medium": 50, "hard": 36}
    historic = next(p for p in sections["hard"] if p.id == "historic-deep-blue-kasparov-1997-g2")
    assert historic.rating == 0
    assert historic.moves[1:] == ["b6e3", "c6d6", "b8e8", "h3h4", "h6h5"]
    assert historic.game_url == "https://www.kasparov.com/timeline-event/deep-blue/"


def test_private_manifests_do_not_reveal_membership_or_seed():
    for path in (ROOT / "corpora" / "manifests").glob("*.json"):
        manifest = json.loads(path.read_text(encoding="utf-8"))
        assert isinstance(manifest["items"], int)
        assert "seed" not in manifest
        assert "selection" not in manifest


def test_corpus_hash_detects_manual_edits(tmp_path):
    source = CORPORA / "standard-seed-v1.json"
    data = json.loads(source.read_text(encoding="utf-8"))
    data["items"][0]["rating"] += 1
    target = tmp_path / "tampered.json"
    target.write_text(json.dumps(data), encoding="utf-8")
    with pytest.raises(ValueError, match="hash mismatch"):
        load_corpus(target)


def test_every_source_has_license_and_snapshot():
    for path in CORPORA.glob("*.json"):
        corpus = load_corpus(path)
        for source in corpus.sources:
            assert source["license"]
            assert source["license_url"]
            assert source["snapshot"]


def test_every_corpus_has_a_matching_frozen_suite():
    suite_dir = ROOT / "suites" / "public"
    for path in CORPORA.glob("*.json"):
        corpus = load_corpus(path)
        suite = load_suite(suite_dir / path.name)
        assert suite.name == corpus.name
        assert suite.version == corpus.version
        assert corpus.content_hash in suite.source
        assert [item["id"] for item in suite.items] == [item["id"] for item in corpus.items]
