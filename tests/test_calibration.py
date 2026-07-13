"""Engine-ladder calibration (engine-gated): ratings land on the ladder."""

import pathlib

import pytest

from chessbench.core.engine import find_stockfish

GEN = pathlib.Path(__file__).resolve().parent.parent / "data" / "generated_puzzles.json"


@pytest.mark.skipif(find_stockfish() is None, reason="stockfish not installed")
def test_calibration_produces_ladder_ratings():
    from chessbench.calibration import DEFAULT_ELOS, calibrate_puzzles, default_ladder, recalibrate
    from chessbench.tasks.puzzles import load_puzzles

    puzzles = load_puzzles(GEN)[:3]
    ladder = default_ladder(nodes=60_000)
    ratings = calibrate_puzzles(puzzles, ladder)

    assert len(ratings) == 3
    valid = set(DEFAULT_ELOS) | {DEFAULT_ELOS[-1] + 200}
    assert all(r in valid for r in ratings)

    recal = recalibrate(puzzles, ladder)
    assert all("calibrated" in p.source for p in recal)
    # UCI_Elo-limited Stockfish is stochastic, so calibration is single-shot/noisy;
    # only assert the ratings are valid ladder values, not run-to-run equality.
    assert all(p.rating in valid for p in recal)
