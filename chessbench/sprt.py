"""SPRT -- sequential A/B testing with early stopping (computer-chess standard).

Instead of fixing the number of games, play A vs B and stop as soon as the
evidence is strong enough to decide between H0 (elo difference <= elo0) and H1
(>= elo1). Uses the normal-approximation generalized SPRT log-likelihood ratio on
the per-game score; the LLR crossing an acceptance bound (from the alpha/beta
error rates) ends the match. This typically needs far fewer games than a
fixed-N match to reach the same confidence.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .conditions import Condition
from .rating import expected_score
from .tasks.games import GameConfig, GameRecord, play_game


@dataclass
class SPRTStatus:
    n: int
    wins: int
    draws: int
    losses: int
    llr: float
    lower: float
    upper: float
    decision: str  # "accept_h1" (A is stronger) | "accept_h0" | "continue"

    @property
    def score(self) -> float:
        return (self.wins + 0.5 * self.draws) / self.n if self.n else 0.0


def sprt_llr(wins: int, draws: int, losses: int, *, elo0: float, elo1: float) -> float:
    """Normal-approximation GSPRT log-likelihood ratio (A's perspective)."""
    n = wins + draws + losses
    if n == 0:
        return 0.0
    s0, s1 = expected_score(elo0, 0.0), expected_score(elo1, 0.0)
    shat = (wins + 0.5 * draws) / n
    var = (wins * (1 - shat) ** 2 + draws * (0.5 - shat) ** 2 + losses * shat ** 2) / n
    var = max(var, 1e-6)
    return n * (shat - 0.5 * (s0 + s1)) * (s1 - s0) / var


def sprt_status(
    wins: int, draws: int, losses: int, *,
    elo0: float = 0.0, elo1: float = 10.0, alpha: float = 0.05, beta: float = 0.05,
) -> SPRTStatus:
    llr = sprt_llr(wins, draws, losses, elo0=elo0, elo1=elo1)
    lower = math.log(beta / (1 - alpha))
    upper = math.log((1 - beta) / alpha)
    decision = "accept_h1" if llr >= upper else "accept_h0" if llr <= lower else "continue"
    return SPRTStatus(wins + draws + losses, wins, draws, losses, llr, lower, upper, decision)


def sprt_match(
    a, b, condition: Condition, config: GameConfig | None = None, *,
    elo0: float = 0.0, elo1: float = 10.0, alpha: float = 0.05, beta: float = 0.05,
    max_games: int = 200, openings: list[str] | None = None,
) -> tuple[SPRTStatus, list[GameRecord]]:
    """Play A vs B (alternating colors, optional opening book) until the SPRT
    decides or `max_games` is reached."""
    config = config or GameConfig()
    book: list[str | None] = list(openings) if openings else [None]
    wins = draws = losses = 0
    games: list[GameRecord] = []
    for g in range(max_games):
        a_white = g % 2 == 0
        white, black = (a, b) if a_white else (b, a)
        rec = play_game(white, black, condition, config, start_fen=book[(g // 2) % len(book)])
        games.append(rec)
        if rec.result == "1/2-1/2":
            draws += 1
        elif (rec.result == "1-0") == a_white:
            wins += 1
        else:
            losses += 1
        status = sprt_status(wins, draws, losses, elo0=elo0, elo1=elo1, alpha=alpha, beta=beta)
        if status.decision != "continue":
            return status, games
    return sprt_status(wins, draws, losses, elo0=elo0, elo1=elo1, alpha=alpha, beta=beta), games
