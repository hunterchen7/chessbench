"""Deterministic, Lichess-style adaptive puzzle rating sessions.

The source puzzle rating and deviation are frozen measurement inputs. Only the
solver state changes. Selection is deterministic for one pool version, seed,
step, and solver state, so an interrupted paid run can reconstruct its next
puzzle without persisting a mutable random-number generator.
"""

from __future__ import annotations

import bisect
import hashlib
import math
from dataclasses import asdict, dataclass
from typing import Iterable, Sequence

from .tasks.puzzles import Puzzle


GLICKO_SCALE = 173.7178
GLICKO_TAU = 0.75
MIN_RATING = 400.0
MAX_RATING = 4000.0
MIN_DEVIATION = 45.0
MAX_DEVIATION = 500.0
MAX_VOLATILITY = 0.1
PROVISIONAL_DEVIATION = 110.0

# Canonical rated-session defaults. Keep these values in one module so the
# Python API and command-line interface cannot silently define different tests.
DEFAULT_RATED_SEED = 0
DEFAULT_RATED_TARGET_RADIUS = 100
DEFAULT_RATED_MIN_PUZZLES = 50
DEFAULT_RATED_MAX_PUZZLES = 100
DEFAULT_RATED_TARGET_DEVIATION = 77.0


@dataclass(frozen=True)
class GlickoState:
    rating: float = 1500.0
    deviation: float = 500.0
    volatility: float = 0.09

    @property
    def provisional(self) -> bool:
        return self.deviation >= PROVISIONAL_DEVIATION

    def interval95(self) -> tuple[float, float]:
        """Lichess-style displayed interval, approximately rating ± 2 RD."""
        return (
            self.rating - 2.0 * self.deviation,
            self.rating + 2.0 * self.deviation,
        )

    def to_dict(self) -> dict[str, float | bool | list[float]]:
        lo, hi = self.interval95()
        return {
            "rating": self.rating,
            "rating_deviation": self.deviation,
            "volatility": self.volatility,
            "provisional": self.provisional,
            "ci95": [lo, hi],
        }

    @classmethod
    def from_dict(cls, value: dict[str, object]) -> "GlickoState":
        return cls(
            rating=float(value["rating"]),
            deviation=float(value["rating_deviation"]),
            volatility=float(value["volatility"]),
        )


@dataclass(frozen=True)
class RatedSessionConfig:
    seed: int = DEFAULT_RATED_SEED
    target_radius: int = DEFAULT_RATED_TARGET_RADIUS
    min_puzzles: int = DEFAULT_RATED_MIN_PUZZLES
    max_puzzles: int = DEFAULT_RATED_MAX_PUZZLES
    target_deviation: float = DEFAULT_RATED_TARGET_DEVIATION
    selector_version: str = "deterministic_rating_band_v1"
    rating_version: str = "lichess_glicko2_frozen_puzzles_v1"

    def __post_init__(self) -> None:
        if self.target_radius < 0:
            raise ValueError("target_radius must be non-negative")
        if self.min_puzzles < 1:
            raise ValueError("min_puzzles must be positive")
        if self.max_puzzles < self.min_puzzles:
            raise ValueError("max_puzzles must be at least min_puzzles")
        if not MIN_DEVIATION <= self.target_deviation <= MAX_DEVIATION:
            raise ValueError(
                f"target_deviation must be between {MIN_DEVIATION:g} and {MAX_DEVIATION:g}"
            )

    def settled(self, state: GlickoState, attempts: int) -> bool:
        return attempts >= self.min_puzzles and state.deviation <= self.target_deviation

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class PuzzleSelection:
    puzzle_id: str
    sequence: int
    target_rating: int
    minimum_rating: int
    maximum_rating: int
    radius: int
    eligible_count: int
    seed: int
    selector_version: str

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def _volatility(
    *,
    phi: float,
    sigma: float,
    variance: float,
    delta: float,
    tau: float,
) -> float:
    """Glicko-2 step 5, matching the algorithm used by scalachess."""
    a = math.log(sigma * sigma)

    def f(value: float) -> float:
        exp = math.exp(value)
        numerator = exp * (delta * delta - phi * phi - variance - exp)
        denominator = 2.0 * (phi * phi + variance + exp) ** 2
        return numerator / denominator - (value - a) / (tau * tau)

    lower = a
    if delta * delta > phi * phi + variance:
        upper = math.log(delta * delta - phi * phi - variance)
    else:
        k = 1.0
        upper = a - k * abs(tau)
        while f(upper) < 0:
            k += 1.0
            upper = a - k * abs(tau)

    f_lower = f(lower)
    f_upper = f(upper)
    for _ in range(1000):
        if abs(upper - lower) <= 0.000001:
            return math.exp(lower / 2.0)
        candidate = lower + (lower - upper) * f_lower / (f_upper - f_lower)
        f_candidate = f(candidate)
        if f_candidate * f_upper <= 0:
            lower = upper
            f_lower = f_upper
        else:
            f_lower /= 2.0
        upper = candidate
        f_upper = f_candidate
    raise RuntimeError("Glicko-2 volatility failed to converge")


def update_solver_rating(
    state: GlickoState,
    *,
    puzzle_rating: float,
    puzzle_deviation: float,
    solved: bool,
    tau: float = GLICKO_TAU,
) -> GlickoState:
    """Apply one frozen-puzzle Glicko-2 result to the solver.

    The ordinary mixed-puzzle Lichess angle has full result weight. Lichess
    additionally downweights a provisional puzzle: a solve uses 80% of the
    computed update and a miss 30%. We preserve that behavior while never
    updating the puzzle itself.
    """
    mu = (state.rating - 1500.0) / GLICKO_SCALE
    phi = state.deviation / GLICKO_SCALE
    opponent_mu = (puzzle_rating - 1500.0) / GLICKO_SCALE
    opponent_phi = max(MIN_DEVIATION, puzzle_deviation) / GLICKO_SCALE
    impact = 1.0 / math.sqrt(1.0 + 3.0 * opponent_phi * opponent_phi / math.pi**2)
    expected = 1.0 / (1.0 + math.exp(-impact * (mu - opponent_mu)))
    variance = 1.0 / (impact * impact * expected * (1.0 - expected))
    score = 1.0 if solved else 0.0
    delta = variance * impact * (score - expected)
    sigma = _volatility(
        phi=phi,
        sigma=state.volatility,
        variance=variance,
        delta=delta,
        tau=tau,
    )
    # Lichess evaluates one puzzle as one rating period. Calendar-time RD aging
    # is deliberately omitted: pausing a benchmark must not change its result.
    phi_star = math.sqrt(phi * phi + sigma * sigma)
    next_phi = 1.0 / math.sqrt(1.0 / (phi_star * phi_star) + 1.0 / variance)
    next_mu = mu + next_phi * next_phi * impact * (score - expected)
    computed = GlickoState(
        rating=min(MAX_RATING, max(MIN_RATING, 1500.0 + GLICKO_SCALE * next_mu)),
        deviation=min(MAX_DEVIATION, max(MIN_DEVIATION, GLICKO_SCALE * next_phi)),
        volatility=min(MAX_VOLATILITY, sigma),
    )

    if puzzle_deviation < PROVISIONAL_DEVIATION:
        return computed
    weight = 0.8 if solved else 0.3
    return GlickoState(
        rating=state.rating * (1.0 - weight) + computed.rating * weight,
        deviation=state.deviation * (1.0 - weight) + computed.deviation * weight,
        volatility=state.volatility * (1.0 - weight) + computed.volatility * weight,
    )


class DeterministicPuzzleSelector:
    """Choose an unused, near-rating puzzle with stable seeded hashing."""

    def __init__(
        self,
        puzzles: Sequence[Puzzle],
        *,
        pool_hash: str,
        config: RatedSessionConfig,
    ) -> None:
        if not puzzles:
            raise ValueError("rated puzzle pool is empty")
        self._puzzles = sorted(puzzles, key=lambda puzzle: (puzzle.rating, puzzle.id))
        self._ratings = [puzzle.rating for puzzle in self._puzzles]
        self.pool_hash = pool_hash
        self.config = config

    def _priority(self, puzzle: Puzzle, sequence: int) -> bytes:
        identity = (
            f"{self.config.selector_version}:{self.pool_hash}:"
            f"{self.config.seed}:{sequence}:{puzzle.id}"
        )
        return hashlib.sha256(identity.encode()).digest()

    def select(
        self,
        state: GlickoState,
        *,
        sequence: int,
        excluded: Iterable[str] = (),
    ) -> tuple[Puzzle, PuzzleSelection]:
        used = set(excluded)
        target = round(state.rating)
        radius = self.config.target_radius
        maximum_radius = max(
            abs(target - self._ratings[0]), abs(self._ratings[-1] - target)
        )
        while radius <= maximum_radius + self.config.target_radius:
            minimum = target - radius
            maximum = target + radius
            left = bisect.bisect_left(self._ratings, minimum)
            right = bisect.bisect_right(self._ratings, maximum)
            candidates = [
                puzzle for puzzle in self._puzzles[left:right] if puzzle.id not in used
            ]
            if candidates:
                chosen = min(
                    candidates,
                    key=lambda puzzle: (self._priority(puzzle, sequence), puzzle.id),
                )
                return chosen, PuzzleSelection(
                    puzzle_id=chosen.id,
                    sequence=sequence,
                    target_rating=target,
                    minimum_rating=minimum,
                    maximum_rating=maximum,
                    radius=radius,
                    eligible_count=len(candidates),
                    seed=self.config.seed,
                    selector_version=self.config.selector_version,
                )
            radius += max(1, self.config.target_radius or 100)
        raise RuntimeError("rated puzzle pool has no unused puzzle")


def rating_summary(
    state: GlickoState,
    *,
    attempts: int,
    config: RatedSessionConfig,
) -> dict[str, object]:
    lo, hi = state.interval95()
    return {
        "rating": state.rating,
        "stderr": state.deviation,
        "rating_deviation": state.deviation,
        "ci95": [lo, hi],
        "n": attempts,
        "bounded": True,
        "method": config.rating_version,
        "provisional": state.provisional,
        "settled": config.settled(state, attempts),
        "volatility": state.volatility,
        "prior": {
            "rating": 1500.0,
            "rating_deviation": 500.0,
            "volatility": 0.09,
        },
    }


def session_protocol(
    *,
    pool_name: str,
    pool_version: str,
    pool_hash: str,
    config: RatedSessionConfig,
) -> dict[str, object]:
    return {
        "kind": "adaptive_glicko2",
        "version": "rated_session_v1",
        "canonical": True,
        "pool": {
            "name": pool_name,
            "version": pool_version,
            "content_hash": pool_hash,
        },
        "selection": {
            "version": config.selector_version,
            "seed": config.seed,
            "target_radius": config.target_radius,
            "without_replacement": True,
            "deterministic": True,
        },
        "rating": {
            "version": config.rating_version,
            "initial": GlickoState().to_dict(),
            "tau": GLICKO_TAU,
            "puzzles_frozen": True,
            "calendar_aging": False,
            "full_solve_is_win": True,
            "partial_credit_affects_rating": False,
        },
        "stopping": {
            "minimum_puzzles": config.min_puzzles,
            "maximum_puzzles": config.max_puzzles,
            "target_rating_deviation": config.target_deviation,
        },
        "prompt": {
            "version": "rated_raw_uci_v1",
            "legal_moves_supplied": False,
            "coaching": False,
            "rationale_requested": False,
            "illegal_move": "puzzle_loss",
            "wrong_move": "puzzle_loss",
            "notation": "uci",
        },
    }
