"""The public reproduction command stays pinned to the canonical selector."""

from __future__ import annotations

import json
import pathlib
import subprocess
import sys


ROOT = pathlib.Path(__file__).resolve().parent.parent


def test_reproduction_cli_selects_the_canonical_seed_zero_opener() -> None:
    result = subprocess.run(
        [
            sys.executable,
            "scripts/reproduce_rated_selection.py",
            "--seed", "0",
            "--sequence", "0",
            "--rating", "1500",
        ],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    document = json.loads(result.stdout)
    assert document["pool"]["content_hash"] == "sha256:c0f866e19b180bf5169c"
    assert document["selection"] == {
        "puzzle_id": "9ptkW",
        "sequence": 0,
        "target_rating": 1500,
        "minimum_rating": 1400,
        "maximum_rating": 1600,
        "radius": 100,
        "eligible_count": 9548,
        "seed": 0,
        "selector_version": "deterministic_rating_band_v1",
    }
    assert document["puzzle"] == {
        "puzzle_id": "9ptkW",
        "rating": 1437,
        "rating_deviation": 77,
    }
