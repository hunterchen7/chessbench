"""Persistent run records -- the data contract the web app reads.

A puzzle run is serialized to a single self-contained JSON file: a manifest
(model, condition, suite, timestamp), the aggregate summary (solve rate,
puzzle-Elo + CI), the sequential Elo trajectory (rating after each puzzle,
ordered easy -> hard), and the per-puzzle results including the model's move,
explanation, correctness, and categories. A static web app can read a directory
of these directly; a database-backed backend can ingest the same shape.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from .categories import categorize_puzzle
from .conditions import Condition
from .rating import elo_trajectory
from .report import PuzzleReport
from .tasks.puzzles import PuzzleResult

SCHEMA = "chessbench.run.v1"


@dataclass
class SuiteRef:
    name: str
    version: str
    visibility: str
    content_hash: str


def _condition_dict(c: Condition) -> dict[str, object]:
    return {
        "legality": c.legality.value, "representation": c.representation.value,
        "notation": c.notation.value, "prompt_style": c.prompt_style.value,
        "context_mode": c.context_mode.value, "explain": c.explain,
        "retry_attempts": c.retry_attempts, "otb_illegal_limit": c.otb_illegal_limit,
        "temperature": c.temperature, "slug": c.slug(),
    }


@dataclass
class RunRecord:
    model: str
    provider: str
    condition: Condition
    report: PuzzleReport
    results: list[PuzzleResult]
    suite: SuiteRef | None = None
    cost_usd: float | None = None
    created: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat(timespec="seconds"))

    def to_dict(self) -> dict[str, object]:
        # Order puzzles easy -> hard; compute the sequential Elo in that order.
        ordered = sorted(self.results, key=lambda r: r.rating)
        traj = elo_trajectory([(float(r.rating), r.solved) for r in ordered])
        items = []
        for r, seq in zip(ordered, traj):
            items.append({
                "puzzle_id": r.puzzle_id, "rating": r.rating, "themes": r.themes,
                "categories": categorize_puzzle(r.themes, r.rating),
                "solved": r.solved, "score": r.score, "first_move_legal": r.first_move_legal,
                "failure_reason": r.failure_reason,
                "answer_move": r.answer_move, "answer_explanation": r.answer_explanation,
                "answer_raw": r.answer_raw, "seq_elo": round(seq, 1),
            })
        rep = self.report
        lo, hi = rep.elo.ci95()
        return {
            "schema": SCHEMA, "kind": "puzzle", "created": self.created,
            "model": self.model, "provider": self.provider,
            "suite": asdict(self.suite) if self.suite else None,
            "condition": _condition_dict(self.condition),
            "summary": {
                "n": rep.n, "solved": rep.solved, "solve_rate": rep.solve_rate,
                "mean_score": rep.mean_score, "first_move_legal_rate": rep.first_move_legal_rate,
                "puzzle_elo": round(rep.elo.rating, 1), "puzzle_elo_ci": [round(lo, 1), round(hi, 1)],
                "puzzle_elo_bounded": rep.elo.bounded, "cost_usd": self.cost_usd,
            },
            "themes": [{"theme": t.theme, "n": t.total, "accuracy": t.accuracy} for t in rep.themes],
            "items": items,
        }


def save_run(record: RunRecord, path: str | Path) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(record.to_dict(), f, indent=1)


def load_run(path: str | Path) -> dict[str, object]:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def list_runs(directory: str | Path) -> list[dict[str, object]]:
    """Lightweight index of runs in a directory (for the web app's run list)."""
    out: list[dict[str, object]] = []
    for p in sorted(Path(directory).glob("*.json")):
        try:
            run = load_run(p)
        except (json.JSONDecodeError, OSError):
            continue
        if run.get("schema") != SCHEMA:
            continue
        cond = run.get("condition")
        suite = run.get("suite")
        out.append({
            "file": p.name, "model": run.get("model"), "created": run.get("created"),
            "kind": run.get("kind"),
            "condition": cond.get("slug") if isinstance(cond, dict) else None,
            "suite": suite.get("name") if isinstance(suite, dict) else None,
            "summary": run.get("summary", {}),
        })
    return out
