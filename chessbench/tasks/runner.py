"""Orchestrate a puzzle-track run: grade every puzzle with an agent+condition,
optionally write a per-puzzle JSONL log, and return an aggregated report.
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from dataclasses import asdict
from pathlib import Path

from ..agents import Agent
from ..conditions import Condition
from ..models import ModelError
from ..report import PuzzleReport, build_report
from .puzzles import Puzzle, PuzzleResult, grade_puzzle


def _error_result(puzzle: Puzzle) -> PuzzleResult:
    """Record a provider failure as an unsolved/illegal puzzle so one flaky call
    doesn't abort a long run."""
    return PuzzleResult(
        puzzle_id=puzzle.id, rating=puzzle.rating, themes=puzzle.themes, solved=False, score=0.0,
        first_move_legal=False, all_moves_legal=False, illegal_attempts=0,
        failure_reason="illegal", solver_plies=puzzle.num_solver_plies(), plies_correct=0,
    )


def _load_checkpoint(path: str | Path) -> dict[str, PuzzleResult]:
    """Read per-puzzle results already computed in a prior (interrupted) run."""
    done: dict[str, PuzzleResult] = {}
    p = Path(path)
    if not p.exists():
        return done
    with open(p, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
                done[d["puzzle_id"]] = PuzzleResult(**d)
            except (json.JSONDecodeError, KeyError, TypeError):
                continue  # skip a torn last line / schema drift
    return done


def run_puzzles(
    agent: Agent,
    puzzles: list[Puzzle],
    condition: Condition,
    *,
    log_path: str | Path | None = None,
    progress_every: int = 0,
    resume_path: str | Path | None = None,
    completed: dict[str, PuzzleResult] | None = None,
    on_result: Callable[[int, Puzzle, PuzzleResult], None] | None = None,
) -> tuple[PuzzleReport, list[PuzzleResult]]:
    """Grade every puzzle and aggregate a report. If `resume_path` is given, it's a
    per-puzzle checkpoint appended as each puzzle finishes (flushed): already-graded
    puzzles are loaded and skipped, so a run killed mid-way resumes where it left off."""
    results: list[PuzzleResult] = []
    errors = 0
    done = dict(completed or {})
    if resume_path:
        done.update(_load_checkpoint(resume_path))
    if done:
        print(f"  [resume] {len(done)} puzzles already done; continuing")
    log_f = open(log_path, "w", encoding="utf-8") if log_path else None
    resume_f = open(resume_path, "a", encoding="utf-8") if resume_path else None
    consecutive_errors = 0
    try:
        start = time.time()
        for i, p in enumerate(puzzles, 1):
            cached = p.id in done
            if cached:
                res = done[p.id]
            else:
                try:
                    res = grade_puzzle(agent, p, condition)
                    consecutive_errors = 0
                except ModelError as exc:
                    errors += 1
                    consecutive_errors += 1
                    if errors <= 3:
                        print(f"  [warn] model error on {p.id}: {exc}")
                    # A run of errors means a persistent outage (e.g. the budget cap):
                    # abort so we don't save a garbage run. Real progress is checkpointed,
                    # so re-running resumes and RETRIES these puzzles (errors aren't saved).
                    if consecutive_errors >= 6:
                        raise RuntimeError(
                            f"aborting after {consecutive_errors} consecutive model errors "
                            f"(budget cap / outage?); progress checkpointed for resume"
                        ) from exc
                    continue
            results.append(res)
            if log_f:
                log_f.write(json.dumps(asdict(res)) + "\n")
            # Only checkpoint genuine gradings — never transient errors, so a resume retries them.
            if resume_f and not cached:
                resume_f.write(json.dumps(asdict(res)) + "\n")
                resume_f.flush()  # durable per-puzzle so a kill loses nothing
            if on_result and not cached:
                on_result(i - 1, p, res)
            if progress_every and i % progress_every == 0:
                rate = sum(r.solved for r in results) / len(results)
                print(f"  [{i}/{len(puzzles)}] solve-rate {rate:.1%} ({time.time() - start:.1f}s)")
        if errors:
            raise RuntimeError(
                f"{errors}/{len(puzzles)} provider calls failed; successful items are persisted and missing items will retry"
            )
    finally:
        if log_f:
            log_f.close()
        if resume_f:
            resume_f.close()
    report = build_report(agent.name, condition.slug(), results)
    return report, results
