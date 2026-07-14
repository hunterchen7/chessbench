"""Aggregate puzzle results into a points-first benchmark report."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

from .core import metrics
from .rating import RatingEstimate, puzzle_elo
from .tasks.puzzles import PuzzleResult


@dataclass
class ThemeStat:
    theme: str
    solved: int = 0
    total: int = 0

    @property
    def accuracy(self) -> float:
        return self.solved / self.total if self.total else 0.0


@dataclass
class PuzzleReport:
    agent: str
    condition: str
    n: int
    solved: int
    mean_score: float             # average partial credit in [0, 1]
    first_move_legal: int
    total_illegal_attempts: int
    failures_illegal: int
    failures_wrong: int
    curve: metrics.RatingCurve
    elo: RatingEstimate           # MLE puzzle-Elo (performance rating)
    themes: list[ThemeStat] = field(default_factory=list)

    @property
    def solve_rate(self) -> float:
        return self.solved / self.n if self.n else 0.0

    @property
    def points(self) -> float:
        """Points earned; a complete puzzle is 1 and partial lines are fractional."""
        return self.mean_score * self.n

    @property
    def max_points(self) -> int:
        return self.n

    @property
    def solve_ci(self) -> tuple[float, float]:
        return metrics.wilson_interval(self.solved, self.n)

    @property
    def first_move_legal_rate(self) -> float:
        return self.first_move_legal / self.n if self.n else 0.0

    @property
    def implied_rating(self) -> float | None:
        return self.curve.implied_rating()


def build_report(agent: str, condition: str, results: list[PuzzleResult]) -> PuzzleReport:
    n = len(results)
    solved = sum(r.solved for r in results)
    mean_score = sum(r.score for r in results) / n if n else 0.0
    first_legal = sum(r.first_move_legal for r in results)
    illegal_attempts = sum(r.illegal_attempts for r in results)
    fail_illegal = sum(r.failure_reason == "illegal" for r in results)
    fail_wrong = sum(r.failure_reason == "wrong_move" for r in results)
    curve = metrics.bucketize([(r.rating, r.solved) for r in results])
    elo = puzzle_elo([(float(r.rating), r.solved) for r in results])

    theme_map: dict[str, ThemeStat] = defaultdict(lambda: ThemeStat(""))
    for r in results:
        for th in r.themes:
            st = theme_map[th]
            st.theme = th
            st.total += 1
            st.solved += 1 if r.solved else 0
    themes = sorted(theme_map.values(), key=lambda s: (-s.total, s.theme))

    return PuzzleReport(
        agent=agent, condition=condition, n=n, solved=solved, mean_score=mean_score,
        first_move_legal=first_legal, total_illegal_attempts=illegal_attempts,
        failures_illegal=fail_illegal, failures_wrong=fail_wrong, curve=curve, elo=elo, themes=themes,
    )


def format_report(rep: PuzzleReport, top_themes: int = 8) -> str:
    lo, hi = rep.solve_ci
    lines = [
        f"agent:      {rep.agent}",
        f"condition:  {rep.condition}",
        f"puzzles:    {rep.n}",
        f"solved:     {rep.solved}/{rep.n} = {rep.solve_rate:.1%}  (95% CI {lo:.1%}-{hi:.1%})",
        f"points:     {rep.points:.2f}/{rep.max_points} (partial credit for correct sequence plies)",
        f"legalMove%: {rep.first_move_legal_rate:.1%} first-attempt legal  "
        f"({rep.total_illegal_attempts} illegal attempts total)",
        f"failures:   {rep.failures_wrong} wrong-move, {rep.failures_illegal} illegal",
        "",
        "difficulty-bucketed accuracy:",
        "  bucket        n    solved   acc     95% CI",
    ]
    for b in rep.curve.buckets:
        clo, chi = b.ci
        lines.append(
            f"  {b.low:>4}-{b.high:<4} {b.total:>5}   {b.solved:>5}   {b.accuracy:>5.1%}   [{clo:.0%}-{chi:.0%}]"
        )
    if rep.themes:
        lines += ["", f"top themes (by count, first {top_themes}):", "  theme                 n    acc"]
        for st in rep.themes[:top_themes]:
            lines.append(f"  {st.theme:<20} {st.total:>4}   {st.accuracy:>5.1%}")
    return "\n".join(lines)
