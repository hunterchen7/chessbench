"""Orchestrate a puzzle-track run: grade every puzzle with an agent+condition,
optionally write a per-puzzle JSONL log, and return an aggregated report.
"""

from __future__ import annotations

import json
import time
from dataclasses import asdict
from pathlib import Path

from .agents import Agent
from .conditions import Condition
from .puzzles import Puzzle, PuzzleResult, grade_puzzle
from .report import PuzzleReport, build_report


def run_puzzles(
    agent: Agent,
    puzzles: list[Puzzle],
    condition: Condition,
    *,
    log_path: str | Path | None = None,
    progress_every: int = 0,
) -> tuple[PuzzleReport, list[PuzzleResult]]:
    results: list[PuzzleResult] = []
    log_f = open(log_path, "w", encoding="utf-8") if log_path else None
    try:
        start = time.time()
        for i, p in enumerate(puzzles, 1):
            res = grade_puzzle(agent, p, condition)
            results.append(res)
            if log_f:
                log_f.write(json.dumps(asdict(res)) + "\n")
            if progress_every and i % progress_every == 0:
                rate = sum(r.solved for r in results) / len(results)
                print(f"  [{i}/{len(puzzles)}] solve-rate {rate:.1%} ({time.time() - start:.1f}s)")
    finally:
        if log_f:
            log_f.close()
    report = build_report(agent.name, condition.slug(), results)
    return report, results
