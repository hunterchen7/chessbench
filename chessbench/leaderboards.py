"""Offline leaderboards over saved run records -- in particular, per-category
rankings (how does each model do at forks, at mates, at each difficulty tier?).

Reads the run-record JSONs the web app already consumes, buckets every graded
item by its category dimensions, and computes a solve rate + MLE puzzle-Elo per
model within each category.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

from .rating import puzzle_elo
from .store import SCHEMA, load_run


@dataclass
class CatRow:
    model: str          # "model [condition-slug]"
    n: int
    solved: int
    solve_rate: float
    elo: float
    bounded: bool


def load_runs(directory: str | Path) -> list[dict[str, object]]:
    runs: list[dict[str, object]] = []
    for p in sorted(Path(directory).glob("*.json")):
        try:
            run = load_run(p)
        except (ValueError, OSError):
            continue
        if run.get("schema") == SCHEMA and run.get("kind") == "puzzle":
            runs.append(run)
    return runs


def category_leaderboard(
    runs: list[dict[str, object]], *, min_n: int = 3, dim: str | None = None
) -> dict[str, list[CatRow]]:
    """category ("dim:value") -> models ranked by puzzle-Elo within that category."""
    buckets: dict[str, dict[str, list[tuple[float, bool]]]] = defaultdict(lambda: defaultdict(list))
    for run in runs:
        cond = run.get("condition")
        slug = cond.get("slug") if isinstance(cond, dict) else "?"
        key = f"{run.get('model')} [{slug}]"
        items = run.get("items")
        if not isinstance(items, list):
            continue
        for it in items:
            categories = it.get("categories") or {}
            for d, values in categories.items():
                if dim and d != dim:
                    continue
                for v in values:
                    buckets[f"{d}:{v}"][key].append((float(it["rating"]), bool(it["solved"])))

    out: dict[str, list[CatRow]] = {}
    for category, models in buckets.items():
        rows: list[CatRow] = []
        for key, pairs in models.items():
            if len(pairs) < min_n:
                continue
            solved = sum(1 for _, s in pairs if s)
            est = puzzle_elo(pairs)
            rows.append(CatRow(key, len(pairs), solved, solved / len(pairs), est.rating, est.bounded))
        if rows:
            out[category] = sorted(rows, key=lambda r: r.elo, reverse=True)
    return out


def format_category_leaderboard(board: dict[str, list[CatRow]]) -> str:
    lines: list[str] = []
    for category in sorted(board):
        lines.append(f"\n[{category}]")
        for r in board[category]:
            elo = f"{r.elo:.0f}" + ("" if r.bounded else "*")
            lines.append(f"  {r.model:<48} {r.solve_rate:>6.1%} solved   elo {elo:>7}   (n={r.n})")
    return "\n".join(lines) if lines else "(no categories with enough data)"
