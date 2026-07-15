from __future__ import annotations

import pathlib

from scripts.validate_historical_candidates import _validate_documents
from scripts.build_public_corpus_bundle import _historical_bundle

ROOT = pathlib.Path(__file__).resolve().parent.parent


def test_historical_candidate_banks_are_legal_unique_and_provenance_rich():
    paths = sorted((ROOT / "data" / "curated" / "candidates").glob("*.json"))
    assert paths
    report = _validate_documents(paths)
    assert report["valid"] is True, report["errors"]
    assert report["candidates"] >= 26
    assert report["unique_ids"] == report["candidates"]
    assert report["unique_positions"] == report["candidates"]
    assert set(report["difficulty"]) == {"easy", "medium", "hard"}


def test_public_historical_bundle_is_candidate_only_and_hides_solution_keys():
    bundle = _historical_bundle()
    assert bundle["status"] == "candidate_only_not_scored"
    assert bundle["candidate_count"] >= 26
    assert sum(bundle["difficulty"].values()) == bundle["candidate_count"]
    assert all(
        "moves" not in item and "fen" not in item and item["source_url"].startswith("https://")
        for item in bundle["items"]
    )
