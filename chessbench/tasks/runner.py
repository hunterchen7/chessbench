"""Orchestrate a puzzle-track run: grade every puzzle with an agent+condition,
optionally write a per-puzzle JSONL log, and return an aggregated report.
"""

from __future__ import annotations

import json
import time
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
) -> tuple[PuzzleReport, list[PuzzleResult]]:
    """Grade every puzzle and aggregate a report. If `resume_path` is given, it's a
    per-puzzle checkpoint appended as each puzzle finishes (flushed): already-graded
    puzzles are loaded and skipped, so a run killed mid-way resumes where it left off."""
    results: list[PuzzleResult] = []
    errors = 0
    done = _load_checkpoint(resume_path) if resume_path else {}
    if done:
        print(f"  [resume] {len(done)} puzzles already done; continuing")
    log_f = open(log_path, "w", encoding="utf-8") if log_path else None
    resume_f = open(resume_path, "a", encoding="utf-8") if resume_path else None
    try:
        start = time.time()
        for i, p in enumerate(puzzles, 1):
            cached = p.id in done
            if cached:
                res = done[p.id]
            else:
                try:
                    res = grade_puzzle(agent, p, condition)
                except ModelError as exc:
                    errors += 1
                    res = _error_result(p)
                    if errors <= 3:
                        print(f"  [warn] model error on {p.id}: {exc}")
            results.append(res)
            if log_f:
                log_f.write(json.dumps(asdict(res)) + "\n")
            if resume_f and not cached:
                resume_f.write(json.dumps(asdict(res)) + "\n")
                resume_f.flush()  # durable per-puzzle so a kill loses nothing
            if progress_every and i % progress_every == 0:
                rate = sum(r.solved for r in results) / len(results)
                print(f"  [{i}/{len(puzzles)}] solve-rate {rate:.1%} ({time.time() - start:.1f}s)")
        if errors:
            print(f"  [warn] {errors}/{len(puzzles)} puzzles hit a model error (counted as failed)")
    finally:
        if log_f:
            log_f.close()
        if resume_f:
            resume_f.close()
    report = build_report(agent.name, condition.slug(), results)
    return report, results
