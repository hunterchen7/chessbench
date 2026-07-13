"""Pure scoring functions: Lichess Win%/Accuracy%, error classification, and
confidence intervals / rating-bucketing for the puzzle track.

Everything here is a pure function of numbers so it is trivially unit-testable
and reproducible. Engine-dependent inputs (centipawns) come from engine.py.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

# --- Lichess move-quality model (constants from lichess.org/page/accuracy) ---

_WIN_K = 0.00368208
_ACC_A = 103.1668
_ACC_B = 0.04354
_ACC_C = 3.1669


def win_percent(centipawns: float) -> float:
    """Convert an engine centipawn eval (White POV or side-to-move POV, be
    consistent) to a 0..100 win probability for that POV."""
    return 50.0 + 50.0 * (2.0 / (1.0 + math.exp(-_WIN_K * centipawns)) - 1.0)


def move_accuracy(win_before: float, win_after: float) -> float:
    """Per-move accuracy in [0,100] from the drop in Win% caused by the move.

    win_before/win_after must be from the *moving* side's POV. A move that keeps
    the win probability flat scores ~100; a blunder scores near 0.
    """
    drop = max(0.0, win_before - win_after)
    acc = _ACC_A * math.exp(-_ACC_B * drop) - _ACC_C
    return max(0.0, min(100.0, acc))


# Lichess error thresholds on the Win% drop (side-to-move POV).
INACCURACY, MISTAKE, BLUNDER = 10.0, 20.0, 30.0


def classify_move(win_before: float, win_after: float) -> str:
    """Return 'best'|'inaccuracy'|'mistake'|'blunder' from the Win% drop."""
    drop = max(0.0, win_before - win_after)
    if drop >= BLUNDER:
        return "blunder"
    if drop >= MISTAKE:
        return "mistake"
    if drop >= INACCURACY:
        return "inaccuracy"
    return "best"


# --- Binomial confidence interval (Wilson score) ---


def wilson_interval(successes: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """95% (default) Wilson score interval for a binomial proportion.

    More reliable than the normal approximation at extreme p and small n, which
    matters for per-rating-bucket accuracy where n can be small.
    """
    if n == 0:
        return (0.0, 0.0)
    p = successes / n
    z2 = z * z
    denom = 1.0 + z2 / n
    center = (p + z2 / (2 * n)) / denom
    half = (z * math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / denom
    return (max(0.0, center - half), min(1.0, center + half))


# --- Rating-bucketed puzzle accuracy + implied rating ---


@dataclass
class Bucket:
    low: int
    high: int
    solved: int = 0
    total: int = 0

    @property
    def mid(self) -> float:
        return (self.low + self.high) / 2.0

    @property
    def accuracy(self) -> float:
        return self.solved / self.total if self.total else 0.0

    @property
    def ci(self) -> tuple[float, float]:
        return wilson_interval(self.solved, self.total)


@dataclass
class RatingCurve:
    buckets: list[Bucket] = field(default_factory=list)

    def implied_rating(self) -> float | None:
        """Estimate the rating where solve-rate crosses 50%, by linear
        interpolation between adjacent bucket midpoints. Returns None if the
        curve never crosses 0.5 within the sampled range."""
        pts = [(b.mid, b.accuracy) for b in self.buckets if b.total > 0]
        if len(pts) < 2:
            return None
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            # Accuracy generally decreases with difficulty: find a 0.5 downcrossing.
            if (y0 - 0.5) * (y1 - 0.5) <= 0 and y0 != y1:
                t = (y0 - 0.5) / (y0 - y1)
                return x0 + t * (x1 - x0)
        # No crossing: clamp to an endpoint if entirely above/below 0.5.
        if all(y >= 0.5 for _, y in pts):
            return pts[-1][0]  # solves even the hardest sampled bucket
        if all(y < 0.5 for _, y in pts):
            return pts[0][0]  # fails even the easiest sampled bucket
        return None


def bucketize(
    rows: list[tuple[int, bool]], width: int = 200, lo: int = 400, hi: int = 3000
) -> RatingCurve:
    """Group (rating, solved) pairs into fixed-width rating buckets."""
    edges = list(range(lo, hi + width, width))
    buckets = [Bucket(edges[i], edges[i + 1]) for i in range(len(edges) - 1)]
    for rating, solved in rows:
        idx = min(max((rating - lo) // width, 0), len(buckets) - 1)
        buckets[idx].total += 1
        buckets[idx].solved += 1 if solved else 0
    return RatingCurve([b for b in buckets if b.total > 0])
