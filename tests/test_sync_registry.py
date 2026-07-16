from __future__ import annotations

from scripts.sync_registry import ACTIVE_SUITE_FILES, suite_track


def test_live_registry_defaults_exclude_superseded_suites():
    assert ACTIVE_SUITE_FILES == (
        "standard-lichess-v3.json",
        "woodpecker-masters-v1.json",
        "esoteric-seed-v2.json",
        "standard-smoke-v1.json",
        "woodpecker-smoke-v1.json",
        "esoteric-smoke-v2.json",
    )
    assert not any("public-v1" in name or "seed-v1" in name and not name.startswith("esoteric") for name in ACTIVE_SUITE_FILES)


def test_registry_track_mapping_keeps_woodpecker_separate():
    assert suite_track("woodpecker-masters-v1", "puzzle") == "woodpecker"
    assert suite_track("standard-lichess-v3", "puzzle") == "puzzle"
    assert suite_track("esoteric-seed-v2", "composed") == "esoteric"
