#!/usr/bin/env python3
"""Grade a subagent-produced set of puzzle answers through the SAME harness the
API models use, so a subagent benchmark (e.g. Claude Opus 4.8 solving via the
Agent tool instead of the API) lands on the leaderboard fully comparable.

Input: a JSON array of {id, moves:[uci...], explanation} (the subagents' answers).
It builds a PrecomputedAgent that replays each answer against the puzzle's
solution lines, runs it through run_puzzles, and saves a normal run record.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import chess

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from chessbench.agents import MoveContext  # noqa: E402
from chessbench.conditions import Condition, Legality, Notation, PromptStyle, Representation  # noqa: E402
from chessbench.store import RunRecord, SuiteRef, save_run  # noqa: E402
from chessbench.suite import load_suite  # noqa: E402
from chessbench.tasks.runner import run_puzzles  # noqa: E402


class PrecomputedAgent:
    """Returns a subagent's pre-computed move for the board it's shown, keyed by
    FEN along every acceptable solution line. Unmapped positions (a wrong/absent
    answer) return a null move so the puzzle fails cleanly."""

    def __init__(self, answers: dict[str, dict], puzzles) -> None:
        self.name = "claude-opus-4-8"
        self._map: dict[str, tuple[str, str]] = {}  # fen -> (move_str, puzzle_id)
        self._answers = answers
        for p in puzzles:
            sub = (answers.get(p.id) or {}).get("moves") or []
            for line in p.solution_lines():
                board = chess.Board(p.fen)
                board.push(chess.Move.from_uci(p.moves[0]))  # solver-facing position
                for pos in range(0, len(line), 2):  # even positions are solver plies
                    ki = pos // 2
                    if ki < len(sub):
                        self._map.setdefault(board.fen(), (str(sub[ki]), p.id))
                    board.push(chess.Move.from_uci(line[pos]))  # canonical solver move
                    if pos + 1 < len(line):
                        board.push(chess.Move.from_uci(line[pos + 1]))  # forced reply

    def choose(self, board: chess.Board, ctx: MoveContext) -> str:
        hit = self._map.get(board.fen())
        if hit is None:
            return "0000"  # no answer for this position -> fails as an illegal move
        move, pid = hit
        a = self._answers.get(pid, {})
        ctx.last_raw_response = json.dumps(a.get("moves")) if a.get("moves") else move
        ctx.last_explanation = a.get("explanation")
        return move


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--answers", required=True, help="JSON array of {id, moves, explanation}")
    ap.add_argument("--suite", default="suites/public/standard-public-v1.json")
    ap.add_argument("--out", required=True)
    ap.add_argument("--model", default="claude-opus-4-8")
    args = ap.parse_args()

    raw = json.load(open(args.answers))
    answers = {a["id"]: a for a in raw}
    suite = load_suite(args.suite)
    puzzles = suite.puzzles()

    # The subagents saw mode 2 (legal moves) and answered in UCI.
    condition = Condition(
        legality=Legality.LEGAL_LIST, representation=Representation.FEN_PIECES,
        notation=Notation.UCI, prompt_style=PromptStyle.MINIMAL, temperature=1.0,
    )
    agent = PrecomputedAgent(answers, puzzles)
    report, results = run_puzzles(agent, puzzles, condition)
    record = RunRecord(
        model=args.model, provider="subagent", condition=condition, report=report, results=results,
        puzzles={p.id: p for p in puzzles},
        suite=SuiteRef(suite.name, suite.version, suite.visibility, suite.content_hash), cost_usd=0.0,
    )
    save_run(record, args.out)
    n = report.n
    print(f"{args.model}: {report.solved}/{n} = {report.solve_rate*100:.1f}%  "
          f"puzzleElo {report.elo.rating:.0f}  (answers for {len(answers)}/{n} puzzles)")
    print(f"saved -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
