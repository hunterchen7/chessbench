"""Engine-ladder difficulty calibration for generated puzzles.

Generated puzzles (tasks/generate.py) carry only a coarse heuristic rating. This
calibrates each one to a Lichess-comparable Elo by asking a ladder of
strength-limited Stockfish engines (via UCI_Elo, calibrated to CCRL) to solve it:
the puzzle's rating is the Elo of the *weakest* engine that finds the solution.
Puzzles only strong engines solve are rated higher; puzzles the weakest engine
solves are rated at the floor.

Reuses one engine per rung across all puzzles (no per-puzzle engine startup), so
calibrating a large set is a single sweep.

Note: UCI_Elo-limited Stockfish is *stochastic* (the move randomization is how
strength is limited), so a single-shot calibration is noisy at the per-puzzle
level. It still turns a coarse uniform heuristic into a real difficulty spread;
for tighter ratings, average several sweeps.
"""

from __future__ import annotations

from contextlib import ExitStack
from dataclasses import dataclass

from .agents import StockfishAgent
from .conditions import HEADLINE
from .core.engine import Engine, EngineConfig
from .tasks.puzzles import Puzzle, grade_puzzle

# UCI_Elo rungs (min supported is 1320); the top rung's Elo + STEP is the "harder
# than any rung" bucket.
DEFAULT_ELOS = [1320, 1500, 1700, 1900, 2100, 2350, 2600, 2900]
_UNSOLVED_BONUS = 200


@dataclass
class Rung:
    elo: int
    config: EngineConfig


def default_ladder(nodes: int = 200_000) -> list[Rung]:
    return [Rung(elo, EngineConfig(uci_elo=elo, nodes=nodes)) for elo in DEFAULT_ELOS]


def calibrate_puzzles(puzzles: list[Puzzle], ladder: list[Rung] | None = None) -> list[int]:
    """Return a calibrated rating for each puzzle (same order as input)."""
    rungs = ladder or default_ladder()
    top = rungs[-1].elo + _UNSOLVED_BONUS
    with ExitStack() as stack:
        agents = [(r.elo, StockfishAgent(engine=stack.enter_context(Engine(r.config)))) for r in rungs]
        ratings: list[int] = []
        for puzzle in puzzles:
            rating = top
            for elo, agent in agents:  # weakest -> strongest; first solver sets the rating
                if grade_puzzle(agent, puzzle, HEADLINE).solved:
                    rating = elo
                    break
            ratings.append(rating)
    return ratings


def recalibrate(puzzles: list[Puzzle], ladder: list[Rung] | None = None) -> list[Puzzle]:
    """Return copies of `puzzles` with calibrated ratings and source tagged."""
    from dataclasses import replace

    ratings = calibrate_puzzles(puzzles, ladder)
    return [replace(p, rating=r, source=f"{p.source}+calibrated") for p, r in zip(puzzles, ratings)]
