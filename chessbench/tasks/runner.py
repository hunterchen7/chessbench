"""Orchestrate a puzzle-track run: grade every puzzle with an agent+condition,
optionally write a per-puzzle JSONL log, and return an aggregated report.
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from dataclasses import asdict
from functools import partial
from pathlib import Path

from ..agents import Agent
from ..conditions import Condition
from ..models import ModelError
from ..report import PuzzleReport, build_report
from .puzzles import Puzzle, PuzzleCheckpoint, PuzzleResult, grade_puzzle


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
    max_new_items: int | None = None,
    max_consecutive_unsolved: int | None = None,
    resume_path: str | Path | None = None,
    completed: dict[str, PuzzleResult] | None = None,
    checkpoints: dict[str, PuzzleCheckpoint] | None = None,
    on_checkpoint: Callable[[int, Puzzle, PuzzleCheckpoint], None] | None = None,
    on_result: Callable[[int, Puzzle, PuzzleResult], None] | None = None,
) -> tuple[PuzzleReport, list[PuzzleResult]]:
    """Grade puzzles and aggregate a report.

    ``max_new_items`` is an operational stop boundary, not an experiment
    condition: it limits newly-issued item evaluations while still loading any
    durable results encountered before the next missing item. This is useful for
    paid compatibility checks without creating a different benchmark identity.
    """
    if max_new_items is not None and max_new_items < 1:
        raise ValueError("max_new_items must be positive")
    if max_consecutive_unsolved is not None and max_consecutive_unsolved < 1:
        raise ValueError("max_consecutive_unsolved must be positive")
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
    consecutive_unsolved = 0
    issued_items = 0
    try:
        start = time.time()
        for i, p in enumerate(puzzles, 1):
            cached = p.id in done
            if (
                not cached
                and max_consecutive_unsolved is not None
                and consecutive_unsolved >= max_consecutive_unsolved
            ):
                print(
                    f"  [stop] {consecutive_unsolved} consecutive unsolved puzzles; "
                    "leaving the remaining items resumable"
                )
                break
            if (
                not cached
                and max_new_items is not None
                and issued_items >= max_new_items
            ):
                break
            if cached:
                res = done[p.id]
            else:
                # Count the paid attempt before issuing it. Provider failures
                # must still consume the operational boundary so a one-call
                # preflight can never spill into a second request.
                issued_items += 1
                try:
                    checkpoint_hook = (
                        partial(on_checkpoint, i - 1, p)
                        if on_checkpoint is not None
                        else None
                    )
                    res = grade_puzzle(
                        agent,
                        p,
                        condition,
                        checkpoint=(checkpoints or {}).get(p.id),
                        on_checkpoint=checkpoint_hook,
                    )
                    consecutive_errors = 0
                except ModelError as exc:
                    errors += 1
                    consecutive_errors += 1
                    if errors <= 3:
                        print(f"  [warn] model error on {p.id}: {exc}")
                    # A run of errors means a persistent outage (e.g. the budget cap):
                    # abort so we don't save a garbage run. Billed failed turns are
                    # checkpointed for audit, but remain unscored and retry the puzzle.
                    if consecutive_errors >= 6:
                        raise RuntimeError(
                            f"aborting after {consecutive_errors} consecutive model errors "
                            f"(budget cap / outage?); progress checkpointed for resume"
                        ) from exc
                    continue
            results.append(res)
            consecutive_unsolved = 0 if res.solved else consecutive_unsolved + 1
            if log_f:
                log_f.write(json.dumps(asdict(res)) + "\n")
            # Only append genuine gradings to the legacy JSONL resume file.
            # Provider failures live in the structured database checkpoint and
            # remain missing here so a resume retries them.
            if resume_f and not cached:
                resume_f.write(json.dumps(asdict(res)) + "\n")
                resume_f.flush()  # durable per-puzzle so a kill loses nothing
            if on_result and not cached:
                on_result(i - 1, p, res)
            if progress_every and i % progress_every == 0:
                rate = sum(r.solved for r in results) / len(results)
                print(
                    f"  [{i}/{len(puzzles)}] solve-rate {rate:.1%} ({time.time() - start:.1f}s)"
                )
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
