"""Rating estimators: verify puzzle-Elo and tournament-Elo recover known truth."""

import math
import random

from chessbench.rating import RatingEstimate, elo_trajectory, expected_score, puzzle_elo, tournament_elo


def test_expected_score():
    assert math.isclose(expected_score(1500, 1500), 0.5)
    assert math.isclose(expected_score(1900, 1500), 1 / 1.1, rel_tol=1e-9)  # +400 -> ~0.909
    assert expected_score(1200, 1600) < 0.5


def test_puzzle_elo_step_function_lands_at_crossover():
    # solves everything below 1600, nothing above -> performance rating ~1600
    items = [(float(r), r < 1600) for r in range(800, 2400, 20)]
    est = puzzle_elo(items)
    assert 1500 <= est.rating <= 1700
    assert est.bounded and est.stderr > 0


def test_puzzle_elo_monotonic():
    easy = [(1500.0, True), (1500.0, True), (1500.0, False)]
    hard = [(1500.0, True), (1500.0, False), (1500.0, False)]
    assert puzzle_elo(easy).rating > puzzle_elo(hard).rating


def test_puzzle_elo_recovers_synthetic_truth():
    rng = random.Random(0)
    true = 1500.0
    items = []
    for _ in range(4000):
        r = rng.uniform(800, 2200)
        items.append((r, rng.random() < expected_score(true, r)))
    est = puzzle_elo(items)
    assert abs(est.rating - true) < 120  # within noise of the truth
    lo, hi = est.ci95()
    assert lo < true < hi


def test_puzzle_elo_extremes_are_flagged():
    assert not puzzle_elo([(1500.0, True), (1500.0, True)]).bounded   # solved all
    assert not puzzle_elo([(1500.0, False), (1500.0, False)]).bounded  # solved none


def test_elo_trajectory_moves_the_right_way():
    traj = elo_trajectory([(1500.0, True)] * 20, start=1500.0)
    assert len(traj) == 20
    assert traj[-1] > 1500.0                 # solving 1500-rated puzzles raises the rating
    assert elo_trajectory([(1500.0, False)] * 20)[-1] < 1500.0  # failing lowers it
    # a solve raises and a miss lowers, step by step
    mixed = elo_trajectory([(1500.0, True), (1500.0, False)], start=1500.0)
    assert mixed[0] > 1500.0 and mixed[1] < mixed[0]


def _games(i: str, j: str, wins: int, draws: int, losses: int) -> list[tuple[str, str, float]]:
    return ([(i, j, 1.0)] * wins) + ([(i, j, 0.5)] * draws) + ([(i, j, 0.0)] * losses)


def test_tournament_orders_players():
    results = _games("A", "B", 16, 2, 2) + _games("A", "C", 18, 1, 1) + _games("B", "C", 14, 2, 4)
    r = tournament_elo(results)
    assert r["A"].rating > r["B"].rating > r["C"].rating


def test_tournament_all_draws_are_equal():
    results = _games("A", "B", 0, 10, 0) + _games("A", "C", 0, 10, 0) + _games("B", "C", 0, 10, 0)
    r = tournament_elo(results, anchor=1500.0)
    ratings = [r[p].rating for p in ("A", "B", "C")]
    assert max(ratings) - min(ratings) < 1.0
    assert all(abs(x - 1500.0) < 1.0 for x in ratings)


def test_tournament_fixed_anchor_sets_scale():
    # anchor a strong reference; a player who loses most to it lands well below.
    results = _games("weak", "SF2000", 1, 0, 9)
    r = tournament_elo(results, fixed={"SF2000": 2000.0})
    assert r["SF2000"].rating == 2000.0 and r["SF2000"].stderr == 0.0
    assert r["weak"].rating < 2000.0
