"""Persistent run records -- the data contract the web app reads.

A puzzle run is serialized to a self-contained JSON document: a manifest,
points summary, and auditable per-puzzle prompts, responses, token usage, moves,
correctness, and categories. A static app can read these documents directly;
the Cloudflare backend ingests the same shape incrementally.
"""

from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

import chess

from .categories import categorize_puzzle
from .conditions import Condition
from .report import PuzzleReport
from .tasks.puzzles import Puzzle, PuzzleResult

if TYPE_CHECKING:
    from .tasks.tournament import TournamentResult

SCHEMA = "chessbench.run.v1"
TOURNAMENT_SCHEMA = "chessbench.tournament.v1"
COMPOSED_SCHEMA = "chessbench.composed_run.v1"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@dataclass
class SuiteRef:
    name: str
    version: str
    visibility: str
    content_hash: str


def _condition_dict(c: Condition) -> dict[str, object]:
    return c.to_dict()


@dataclass
class RunRecord:
    model: str
    provider: str
    condition: Condition
    report: PuzzleReport
    results: list[PuzzleResult]
    puzzles: dict[str, Puzzle] = field(
        default_factory=dict
    )  # id -> Puzzle, to embed board+solution
    suite: SuiteRef | None = None
    cost_usd: float | None = None
    run_id: str | None = None
    model_variant: dict[str, object] | None = None
    created: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(timespec="seconds")
    )

    def to_dict(self) -> dict[str, object]:
        items = []
        for r in self.results:
            item: dict[str, object] = {
                "puzzle_id": r.puzzle_id,
                "rating": r.rating,
                "themes": r.themes,
                "categories": categorize_puzzle(r.themes, r.rating),
                "solved": r.solved,
                "score": r.score,
                "first_move_legal": r.first_move_legal,
                "failure_reason": r.failure_reason,
                "answer_move": r.answer_move,
                "answer_rationale": r.answer_explanation,
                "answer_explanation": r.answer_explanation,  # compatibility with v1 dashboard fixtures
                "answer_response_format_valid": r.answer_response_format_valid,
                "answer_response_format_error": r.answer_response_format_error,
                "answer_raw": r.answer_raw,
                "moves_played": r.moves_played,
                "solver_plies": r.solver_plies,
                "plies_correct": r.plies_correct,
                "turns": r.turns,
            }
            item.update(_position_fields(self.puzzles.get(r.puzzle_id)))
            items.append(item)
        rep = self.report
        kind = (
            "woodpecker"
            if self.condition.puzzle_protocol.value == "full_line"
            else "puzzle"
        )
        return {
            "schema": SCHEMA,
            "run_id": self.run_id,
            "kind": kind,
            "created": self.created,
            "model": self.model,
            "provider": self.provider,
            "model_variant": self.model_variant,
            "suite": asdict(self.suite) if self.suite else None,
            "condition": _condition_dict(self.condition),
            "summary": {
                "n": rep.n,
                "solved": rep.solved,
                "solve_rate": rep.solve_rate,
                "mean_score": rep.mean_score,
                "first_move_legal_rate": rep.first_move_legal_rate,
                "response_format_valid_rate": rep.response_format_valid_rate,
                "points": round(rep.points, 4),
                "max_points": rep.max_points,
                "cost_usd": self.cost_usd,
            },
            "themes": [
                {"theme": t.theme, "n": t.total, "accuracy": t.accuracy}
                for t in rep.themes
            ],
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
        "fen": board.fen(),  # position the solver faces
        "setup_san": setup_san,
        "solver_is_white": board.turn == chess.WHITE,
        "solution": puzzle.moves[1:],  # solver + forced replies (UCI)
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


@dataclass
class TournamentRecord:
    """A saved round-robin: point standings, every game (result + PGN +
    per-move eval), and the crosstable -- the data contract for the web games viewer."""

    result: TournamentResult
    condition: Condition
    max_plies: int
    anchor: dict[str, float] | None = None
    created: str = field(default_factory=_now)

    def to_dict(self) -> dict[str, object]:
        from collections import defaultdict

        from .tasks.games import accuracy_by_color

        acc_sum: dict[str, float] = defaultdict(float)
        acc_n: dict[str, int] = defaultdict(int)
        for g in self.result.games:
            wacc, bacc = accuracy_by_color(g.records)
            if wacc is not None:
                acc_sum[g.white] += wacc
                acc_n[g.white] += 1
            if bacc is not None:
                acc_sum[g.black] += bacc
                acc_n[g.black] += 1

        standings = []
        for s in self.result.standings:
            standings.append(
                {
                    "label": s.label,
                    "wins": s.wins,
                    "draws": s.draws,
                    "losses": s.losses,
                    "games": s.games,
                    "score": s.score,
                    "illegal_forfeits": s.illegal_forfeits,
                    "accuracy": round(acc_sum[s.label] / acc_n[s.label], 1)
                    if acc_n[s.label]
                    else None,
                }
            )
        games = []
        for g in self.result.games:
            games.append(
                {
                    "white": g.white,
                    "black": g.black,
                    "result": g.result,
                    "termination": g.termination,
                    "plies": g.plies,
                    "pgn": g.pgn,
                    "start_fen": g.start_fen,
                    "moves": [
                        {
                            "ply": m.ply,
                            "color": m.color,
                            "san": m.san,
                            "uci": m.uci,
                            "eval_cp": m.eval_cp,
                            "forfeited": m.forfeited,
                            "attempts": [asdict(attempt) for attempt in m.attempts],
                            "prompt_tokens": sum(a.prompt_tokens for a in m.attempts),
                            "completion_tokens": sum(
                                a.completion_tokens for a in m.attempts
                            ),
                            "reasoning_tokens": sum(
                                a.reasoning_tokens for a in m.attempts
                            ),
                            "cost_usd": sum(a.cost_usd for a in m.attempts),
                        }
                        for m in g.records
                    ],
                }
            )
        crosstable = [
            {"a": a, "b": b, "w": w, "d": d, "l": ll}
            for (a, b), (w, d, ll) in self.result.crosstable.items()
        ]
        return {
            "schema": TOURNAMENT_SCHEMA,
            "created": self.created,
            "condition": _condition_dict(self.condition),
            "max_plies": self.max_plies,
            "anchor": self.anchor,
            "standings": standings,
            "games": games,
            "crosstable": crosstable,
        }


def save_tournament(record: TournamentRecord, path: str | Path) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(json_safe(record.to_dict()), f, indent=1)


def list_tournaments(directory: str | Path) -> list[dict[str, object]]:
    out: list[dict[str, object]] = []
    for p in sorted(Path(directory).glob("*.json")):
        try:
            t = load_run(p)
        except (json.JSONDecodeError, OSError):
            continue
        if t.get("schema") != TOURNAMENT_SCHEMA:
            continue
        standings = t.get("standings")
        games = t.get("games")
        top = (
            standings[0]["label"] if isinstance(standings, list) and standings else None
        )
        out.append(
            {
                "file": p.name,
                "created": t.get("created"),
                "n_players": len(standings) if isinstance(standings, list) else 0,
                "n_games": len(games) if isinstance(games, list) else 0,
                "winner": top,
            }
        )
    return out


def list_composed_runs(directory: str | Path) -> list[dict[str, object]]:
    """Return the lightweight, deterministic index consumed by the esoteric UI.

    Only complete composed-run documents enter the index. This deliberately
    ignores ``index.json``, unrelated JSON documents, truncated checkpoints,
    and files missing the fields the loader needs.
    """
    out: list[dict[str, object]] = []
    for path in sorted(Path(directory).glob("*.json")):
        try:
            run = load_run(path)
        except (json.JSONDecodeError, OSError):
            continue
        if run.get("schema") != COMPOSED_SCHEMA:
            continue
        model = run.get("model")
        solver = run.get("solver")
        summary = run.get("summary")
        items = run.get("items")
        if (
            not isinstance(model, str)
            or not model
            or not isinstance(solver, str)
            or not solver
            or not isinstance(summary, dict)
            or not isinstance(items, list)
        ):
            continue
        solve_rate = summary.get("solve_rate")
        if (
            not isinstance(solve_rate, (int, float))
            or isinstance(solve_rate, bool)
            or not math.isfinite(float(solve_rate))
            or not 0.0 <= float(solve_rate) <= 1.0
        ):
            continue
        suite = run.get("suite")
        condition = run.get("condition")
        out.append(
            {
                "file": path.name,
                "model": model,
                "solver": solver,
                "created": run.get("created"),
                "suite": suite.get("name") if isinstance(suite, dict) else None,
                "condition": condition.get("slug")
                if isinstance(condition, dict)
                else None,
                "solve_rate": solve_rate,
            }
        )
    return out


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
        out.append(
            {
                "file": p.name,
                "model": run.get("model"),
                "created": run.get("created"),
                "kind": run.get("kind"),
                "condition": cond.get("slug") if isinstance(cond, dict) else None,
                "suite": suite.get("name") if isinstance(suite, dict) else None,
                "summary": run.get("summary", {}),
            }
        )
    return out
