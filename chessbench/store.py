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
import math
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import chess

from .categories import categorize_puzzle
from .conditions import Condition
from .rating import elo_trajectory
from .report import PuzzleReport
from .tasks.puzzles import Puzzle, PuzzleResult

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
    puzzles: dict[str, Puzzle] = field(default_factory=dict)  # id -> Puzzle, to embed board+solution
    suite: SuiteRef | None = None
    cost_usd: float | None = None
    created: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat(timespec="seconds"))

    def to_dict(self) -> dict[str, object]:
        # Order puzzles easy -> hard; compute the sequential Elo in that order.
        ordered = sorted(self.results, key=lambda r: r.rating)
        traj = elo_trajectory([(float(r.rating), r.solved) for r in ordered])
        items = []
        for r, seq in zip(ordered, traj):
            item: dict[str, object] = {
                "puzzle_id": r.puzzle_id, "rating": r.rating, "themes": r.themes,
                "categories": categorize_puzzle(r.themes, r.rating),
                "solved": r.solved, "score": r.score, "first_move_legal": r.first_move_legal,
                "failure_reason": r.failure_reason,
                "answer_move": r.answer_move, "answer_explanation": r.answer_explanation,
                "answer_raw": r.answer_raw, "seq_elo": round(seq, 1),
            }
            item.update(_position_fields(self.puzzles.get(r.puzzle_id)))
            items.append(item)
        rep = self.report
        lo, hi = rep.elo.ci95()
        # JSON has no Infinity: emit null for the CI of a railed (unbounded) estimate.
        ci = [round(lo, 1) if math.isfinite(lo) else None, round(hi, 1) if math.isfinite(hi) else None]
        return {
            "schema": SCHEMA, "kind": "puzzle", "created": self.created,
            "model": self.model, "provider": self.provider,
            "suite": asdict(self.suite) if self.suite else None,
            "condition": _condition_dict(self.condition),
            "summary": {
                "n": rep.n, "solved": rep.solved, "solve_rate": rep.solve_rate,
                "mean_score": rep.mean_score, "first_move_legal_rate": rep.first_move_legal_rate,
                "puzzle_elo": round(rep.elo.rating, 1), "puzzle_elo_ci": ci,
                "puzzle_elo_bounded": rep.elo.bounded, "cost_usd": self.cost_usd,
            },
            "themes": [{"theme": t.theme, "n": t.total, "accuracy": t.accuracy} for t in rep.themes],
            "items": items,
        }


def _position_fields(puzzle: Puzzle | None) -> dict[str, object]:
    """The solver-facing board (after the setup move) + solution, so the web app
    can render and grade without re-deriving anything."""
    if puzzle is None:
        return {}
    board = chess.Board(puzzle.fen)
    setup = chess.Move.from_uci(puzzle.moves[0])
    setup_san = board.san(setup)
    board.push(setup)
    return {
        "fen": board.fen(),                       # position the solver faces
        "setup_san": setup_san,
        "solver_is_white": board.turn == chess.WHITE,
        "solution": puzzle.moves[1:],             # solver + forced replies (UCI)
        "solution_first": puzzle.moves[1] if len(puzzle.moves) > 1 else None,
        "game_url": puzzle.game_url,
    }


def json_safe(obj: object) -> object:
    """Recursively replace non-finite floats (inf/nan) with None -- JSON has no
    Infinity, so this guarantees a valid, browser-parseable document."""
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [json_safe(v) for v in obj]
    return obj


def save_run(record: RunRecord, path: str | Path) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(json_safe(record.to_dict()), f, indent=1)


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
