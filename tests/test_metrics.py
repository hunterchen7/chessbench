import math

from chessbench.core import metrics


def test_win_percent_symmetry():
    assert math.isclose(metrics.win_percent(0), 50.0, abs_tol=1e-6)
    assert metrics.win_percent(300) > 50 > metrics.win_percent(-300)
    # symmetric around 0
    assert math.isclose(
        metrics.win_percent(200) + metrics.win_percent(-200), 100.0, abs_tol=1e-6
    )


def test_move_accuracy_bounds():
    assert math.isclose(metrics.move_accuracy(60, 60), 100.0, abs_tol=0.2)  # no drop -> ~100
    assert metrics.move_accuracy(90, 10) < 5  # huge drop -> near 0
    assert 0.0 <= metrics.move_accuracy(50, 5) <= 100.0


def test_classify_move_thresholds():
    assert metrics.classify_move(60, 60) == "best"
    assert metrics.classify_move(60, 48) == "inaccuracy"  # drop 12
    assert metrics.classify_move(60, 38) == "mistake"     # drop 22
    assert metrics.classify_move(60, 20) == "blunder"     # drop 40


def test_wilson_interval_contains_p_and_narrows():
    lo, hi = metrics.wilson_interval(50, 100)
    assert lo < 0.5 < hi
    lo2, hi2 = metrics.wilson_interval(500, 1000)
    assert (hi2 - lo2) < (hi - lo)  # more samples -> tighter
    assert metrics.wilson_interval(0, 0) == (0.0, 0.0)


def test_implied_rating_downcrossing():
    rows = []
    # solve everything <=1400, nothing >=1600 -> crossing near 1500
    for r, acc in [(1300, 1.0), (1500, 0.5), (1700, 0.0)]:
        rows += [(r, True)] * int(acc * 10) + [(r, False)] * int((1 - acc) * 10)
    curve = metrics.bucketize(rows, width=200, lo=1200, hi=1800)
    ir = curve.implied_rating()
    assert ir is not None and 1400 <= ir <= 1600
