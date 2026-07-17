"""Elo/rating estimation.

Two estimators on the standard logistic (Elo) model:

* `puzzle_elo` -- a Bayesian performance rating from puzzle results. Each puzzle
  of rating R is a rated game the model wins iff it solves the puzzle, under
  P(solve) = 1/(1 + 10^((R - theta)/400)). A frozen weak Gaussian prior keeps
  early all-win and all-loss prefixes finite while the reported rating deviation
  makes that early uncertainty explicit. This is a MAP estimate with a Laplace
  approximation to the posterior interval.

* `tournament_elo` -- ratings from head-to-head games (LLM vs LLM, optionally with
  fixed engine anchors), via MAP Bradley-Terry: a concave objective (logistic
  likelihood + a weak Gaussian prior for identifiability) solved by coordinate
  Newton. Draws count as half. Standard errors come from the observed information.

Both return a `RatingEstimate` with a 95% uncertainty interval so leaderboard
deltas are not over-read.
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass

LN10 = math.log(10.0)
SCALE = 400.0
_C = LN10 / SCALE  # derivative constant of the logistic wrt rating
PUZZLE_PRIOR_MEAN = 1500.0
PUZZLE_PRIOR_SD = 700.0
PROVISIONAL_CI_WIDTH = 400.0


@dataclass
class RatingEstimate:
    rating: float
    stderr: float
    n: int
    bounded: bool = True
    method: str = "maximum_likelihood"
    prior_mean: float | None = None
    prior_sd: float | None = None

    def ci95(self) -> tuple[float, float]:
        if not math.isfinite(self.stderr):
            return (float("-inf"), float("inf"))
        return (self.rating - 1.96 * self.stderr, self.rating + 1.96 * self.stderr)

    def to_dict(self) -> dict[str, object]:
        """JSON-safe rating estimate for persisted reports and dashboards."""
        finite = math.isfinite(self.stderr)
        lo, hi = self.ci95()
        payload: dict[str, object] = {
            "rating": self.rating,
            "stderr": self.stderr if finite else None,
            "rating_deviation": self.stderr if finite else None,
            "ci95": [lo, hi] if finite else None,
            "n": self.n,
            "bounded": self.bounded,
            "method": self.method,
            "provisional": (not finite) or (hi - lo > PROVISIONAL_CI_WIDTH),
        }
        if self.prior_mean is not None and self.prior_sd is not None:
            payload["prior"] = {"mean": self.prior_mean, "sd": self.prior_sd}
        return payload


def expected_score(rating: float, opponent: float) -> float:
    """Logistic expected score of `rating` against `opponent` (Elo)."""
    return 1.0 / (1.0 + 10.0 ** ((opponent - rating) / SCALE))


def puzzle_elo(
    items: list[tuple[float, bool]],
    *,
    prior_mean: float = PUZZLE_PRIOR_MEAN,
    prior_sd: float = PUZZLE_PRIOR_SD,
) -> RatingEstimate:
    """Bayesian performance rating from ``(puzzle_rating, solved)`` pairs.

    The weak, frozen prior is part of the benchmark definition. It prevents
    complete separation (all solves or all misses) from producing an infinite
    estimate. ``stderr`` is the posterior rating deviation from the observed
    curvature at the MAP estimate; its 95% interval is a Laplace approximation.
    """
    if prior_sd <= 0 or not math.isfinite(prior_sd):
        raise ValueError("prior_sd must be a finite positive number")
    n = len(items)
    if n == 0:
        return RatingEstimate(
            prior_mean,
            prior_sd,
            0,
            bounded=False,
            method="bayesian_elo_v1",
            prior_mean=prior_mean,
            prior_sd=prior_sd,
        )

    prior_precision = 1.0 / (prior_sd * prior_sd)

    def gradient(theta: float) -> float:
        return -(theta - prior_mean) * prior_precision + _C * sum(
            (1.0 if solved else 0.0) - expected_score(theta, r)
            for r, solved in items
        )

    # The posterior is strictly log-concave. Ten prior deviations are far into
    # the Gaussian tails and safely bracket the unique MAP even for shutouts.
    a = prior_mean - 10.0 * prior_sd
    b = prior_mean + 10.0 * prior_sd
    for _ in range(200):
        mid = 0.5 * (a + b)
        if gradient(mid) > 0:
            a = mid
        else:
            b = mid
        if b - a < 1e-4:
            break
    theta = 0.5 * (a + b)
    info = prior_precision + sum(
        _C * _C * (e := expected_score(theta, r)) * (1.0 - e)
        for r, _ in items
    )
    stderr = 1.0 / math.sqrt(info) if info > 0 else float("inf")
    return RatingEstimate(
        theta,
        stderr,
        n,
        method="bayesian_elo_v1",
        prior_mean=prior_mean,
        prior_sd=prior_sd,
    )


def puzzle_elo_trajectory(
    items: list[tuple[float, bool]],
    *,
    prior_mean: float = PUZZLE_PRIOR_MEAN,
    prior_sd: float = PUZZLE_PRIOR_SD,
) -> list[RatingEstimate]:
    """Posterior Puzzle Elo after every prefix, using one frozen prior."""
    prefix: list[tuple[float, bool]] = []
    out: list[RatingEstimate] = []
    for item in items:
        prefix.append(item)
        out.append(
            puzzle_elo(prefix, prior_mean=prior_mean, prior_sd=prior_sd)
        )
    return out


def elo_trajectory(
    items: list[tuple[float, bool]], *, start: float = 1500.0, k_start: float = 48.0,
    k_min: float = 16.0, k_halflife: int = 40,
) -> list[float]:
    """Legacy illustrative sequential Elo after each puzzle.

    The dashboard uses :func:`puzzle_elo_trajectory`; this K-factor curve remains
    available for callers that explicitly want game-by-game Elo updates.
    """
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
        out[p] = RatingEstimate(
            theta[p],
            0.0 if p in fixed else stderr,
            len(games[p]),
            bounded=p not in fixed,
            method="map_bradley_terry",
            prior_mean=None if p in fixed else anchor,
            prior_sd=None if p in fixed else prior_sd,
        )
    return out
