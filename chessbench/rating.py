"""Elo/rating estimation.

Two estimators, both maximum-likelihood on the standard logistic (Elo) model:

* `puzzle_elo` -- a *performance rating* from puzzle results. Each puzzle of
  rating R is a rated game the model wins iff it solves the puzzle; the model's
  rating theta is the MLE under P(solve) = 1/(1 + 10^((R - theta)/400)). This is
  exactly the assumption behind Lichess puzzle ratings (a player rated R solves an
  R-rated puzzle ~50% of the time), so it yields a directly interpretable rating.

* `tournament_elo` -- ratings from head-to-head games (LLM vs LLM, optionally with
  fixed engine anchors), via MAP Bradley-Terry: a concave objective (logistic
  likelihood + a weak Gaussian prior for identifiability) solved by coordinate
  Newton. Draws count as half. Standard errors come from the observed information.

Both return a `RatingEstimate` with a 95% confidence interval so leaderboard
deltas are not over-read.
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass

LN10 = math.log(10.0)
SCALE = 400.0
_C = LN10 / SCALE  # derivative constant of the logistic wrt rating


@dataclass
class RatingEstimate:
    rating: float
    stderr: float
    n: int
    bounded: bool = True  # False if the estimate railed (solved all / none, or a shutout)

    def ci95(self) -> tuple[float, float]:
        if not math.isfinite(self.stderr):
            return (float("-inf"), float("inf"))
        return (self.rating - 1.96 * self.stderr, self.rating + 1.96 * self.stderr)

    def to_dict(self) -> dict[str, object]:
        """JSON-safe rating estimate for persisted reports and dashboards."""
        finite = math.isfinite(self.stderr)
        lo, hi = self.ci95()
        return {
            "rating": self.rating,
            "stderr": self.stderr if finite else None,
            "ci95": [lo, hi] if finite else None,
            "n": self.n,
            "bounded": self.bounded,
        }


def expected_score(rating: float, opponent: float) -> float:
    """Logistic expected score of `rating` against `opponent` (Elo)."""
    return 1.0 / (1.0 + 10.0 ** ((opponent - rating) / SCALE))


def puzzle_elo(items: list[tuple[float, bool]], *, lo: float = 0.0, hi: float = 4000.0) -> RatingEstimate:
    """MLE performance rating from (puzzle_rating, solved) pairs."""
    n = len(items)
    wins = sum(1 for _, solved in items if solved)
    if n == 0:
        return RatingEstimate(lo, float("inf"), 0, bounded=False)
    if wins == 0:
        return RatingEstimate(lo, float("inf"), n, bounded=False)  # solved none -> rating <= lo
    if wins == n:
        return RatingEstimate(hi, float("inf"), n, bounded=False)  # solved all -> rating >= hi

    def gradient(theta: float) -> float:  # d(log-lik)/d(theta), up to the positive constant _C
        return sum((1.0 if solved else 0.0) - expected_score(theta, r) for r, solved in items)

    a, b = lo, hi  # gradient is strictly decreasing in theta -> bisection
    for _ in range(200):
        mid = 0.5 * (a + b)
        if gradient(mid) > 0:
            a = mid
        else:
            b = mid
        if b - a < 1e-4:
            break
    theta = 0.5 * (a + b)
    info = sum(_C * _C * (e := expected_score(theta, r)) * (1.0 - e) for r, _ in items)
    stderr = 1.0 / math.sqrt(info) if info > 0 else float("inf")
    return RatingEstimate(theta, stderr, n)


def elo_trajectory(
    items: list[tuple[float, bool]], *, start: float = 1500.0, k_start: float = 48.0,
    k_min: float = 16.0, k_halflife: int = 40,
) -> list[float]:
    """Sequential rating after each puzzle -- the "Elo changes after each puzzle"
    view for the web app. Each puzzle of rating R is a rated game; the rating
    updates by K*(solved - expected). K decays from `k_start` toward `k_min` so
    the trajectory settles. Present `items` in ascending difficulty for the
    canonical easy->hard curve. Illustrative; the MLE `puzzle_elo` is the official
    rating."""
    rating = start
    out: list[float] = []
    for i, (puzzle_rating, solved) in enumerate(items):
        k = max(k_min, k_start * k_halflife / (k_halflife + i))
        rating += k * ((1.0 if solved else 0.0) - expected_score(rating, puzzle_rating))
        out.append(rating)
    return out


def tournament_elo(
    results: list[tuple[str, str, float]],
    *,
    anchor: float = 1500.0,
    prior_sd: float = 1000.0,
    fixed: dict[str, float] | None = None,
    sweeps: int = 400,
) -> dict[str, RatingEstimate]:
    """Fit ratings from games. `results` is (player_i, player_j, score_i) with
    score_i in {0, 0.5, 1}. `fixed` pins players to known ratings (e.g. a Stockfish
    anchor) to put the scale on an absolute footing; otherwise the weak prior
    centers ratings on `anchor`."""
    fixed = fixed or {}
    players = sorted({p for g in results for p in (g[0], g[1])} | set(fixed))
    theta: dict[str, float] = {p: float(fixed.get(p, anchor)) for p in players}

    games: dict[str, list[tuple[str, float]]] = defaultdict(list)
    for i, j, s in results:
        games[i].append((j, s))
        games[j].append((i, 1.0 - s))

    for _ in range(sweeps):
        max_step = 0.0
        for p in players:
            if p in fixed:
                continue
            g = -(theta[p] - anchor) / (prior_sd * prior_sd)
            h = -1.0 / (prior_sd * prior_sd)
            for opp, s in games[p]:
                e = expected_score(theta[p], theta[opp])
                g += _C * (s - e)
                h += -_C * _C * e * (1.0 - e)
            step = g / h  # Newton (h < 0)
            theta[p] -= step
            max_step = max(max_step, abs(step))
        if max_step < 1e-6:
            break

    out: dict[str, RatingEstimate] = {}
    for p in players:
        h = -1.0 / (prior_sd * prior_sd)
        for opp, s in games[p]:
            e = expected_score(theta[p], theta[opp])
            h += -_C * _C * e * (1.0 - e)
        stderr = math.sqrt(-1.0 / h) if h < 0 else float("inf")
        out[p] = RatingEstimate(theta[p], 0.0 if p in fixed else stderr, len(games[p]), bounded=p not in fixed)
    return out
