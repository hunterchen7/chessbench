"""Composed / esoteric problem track: directmate, selfmate, reflexmate, helpmate,
proof games, and endgame studies.

These are graded by a *solver in the loop* (chessbench.solvers), never by string
matching, because a composed problem answers a stipulation and may have several
valid solutions. Answers come in three shapes:

  * "key"  -- a single first move (directmate/selfmate/reflexmate); verified by
              the corresponding forced-mate search.
  * "line" -- a full move sequence (helpmate: the 2n cooperative plies; proof
              game: the ply sequence from the start); verified by replay.
  * "play" -- interactive play vs an engine defender (study); see solvers.studies.

The one-shot shapes use a `ComposedSolver` (prompt -> raw answer text). Studies
reuse the game-track Agent interface via `solvers.grade_study`.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Protocol

import chess

from ..conditions import Condition, Notation, render_position
from ..core import board as board_utils
from ..models import Model
from ..solvers import proofgame, series, stipulations
from ..types import AnswerShape, StipulationKind, StudyGoal

_ANSWER_SHAPE: dict[StipulationKind, AnswerShape] = {
    "directmate": "key",
    "selfmate": "key",
    "reflexmate": "key",
    "helpmate": "line",
    "series_helpmate": "line",
    "series_directmate": "line",
    "proofgame": "line",
    "study": "play",
}

_LABEL: dict[StipulationKind, str] = {
    "directmate": "#{n}",
    "selfmate": "s#{n}",
    "reflexmate": "r#{n}",
    "helpmate": "h#{n}",
    "series_helpmate": "ser-h#{n}",
    "series_directmate": "ser-#{n}",
    "proofgame": "proof game in {n} plies",
    "study": "study",
}


@dataclass
class ComposedProblem:
    id: str
    fen: str
    kind: StipulationKind
    n: int                              # #n / s#n / h#n length, or ply count for proofgame
    solution: list[str] = field(default_factory=list)  # a known solution (UCI): [key] or full line
    goal: StudyGoal | None = None       # study only
    themes: list[str] = field(default_factory=list)
    source: str = "chessbench"

    @property
    def answer_shape(self) -> AnswerShape:
        return _ANSWER_SHAPE[self.kind]

    @property
    def label(self) -> str:
        return _LABEL[self.kind].format(n=self.n)


@dataclass
class ComposedResult:
    problem_id: str
    kind: StipulationKind
    solved: bool
    score: float
    first_move_legal: bool
    detail: str
    answer: str


class ComposedSolver(Protocol):
    name: str

    def solve(self, problem: ComposedProblem, condition: Condition) -> str:
        """Return the raw answer text for a one-shot (key/line) problem."""
        ...


# --- Prompt building ---

_STIPULATION_HELP: dict[StipulationKind, str] = {
    "directmate": "The side to move must force checkmate in at most {n} of its own moves against ANY defense.",
    "selfmate": "The side to move must force the OPPONENT to deliver checkmate to the side to move within {n} "
    "moves. (The side to move wants to be mated; the opponent tries to avoid mating.)",
    "reflexmate": "As a selfmate in {n}, but under the reflex condition: EITHER side must give checkmate "
    "immediately whenever it is able to.",
    "helpmate": "Both sides COOPERATE to checkmate the side to move in exactly {n} moves. Give the full line as "
    "{plies} moves (the side to move first, then alternating).",
    "series_helpmate": "The side to move plays {n} consecutive moves (the opponent does not move), then the "
    "opponent delivers mate. Give the full move sequence.",
    "series_directmate": "The side to move plays {n} consecutive moves (giving check only on the last), ending "
    "in checkmate. Give the full move sequence.",
    "proofgame": "Give a legal sequence of exactly {n} plies (half-moves) from the standard starting position "
    "that reaches the position shown. List the moves in order.",
    "study": "The side to move must achieve the stipulated result ({goal}) against best defense.",
}


def build_composed_prompt(problem: ComposedProblem, condition: Condition) -> str:
    board = chess.Board(problem.fen)
    notation = "SAN (e.g. Nf3, Qxe7, O-O)" if condition.notation == Notation.SAN else "UCI (e.g. g1f3, e7e5)"
    help_text = _STIPULATION_HELP[problem.kind].format(n=problem.n, plies=2 * problem.n, goal=problem.goal or "")

    lines = [f"This is a composed chess problem. Stipulation: {problem.label}.", "", help_text, ""]
    if problem.kind == "proofgame":
        lines.append("Target position to reach:")
    lines.append(render_position(board, condition))
    lines.append("")

    shape = problem.answer_shape
    if shape == "key":
        lines.append(f"Reply with ONLY the key (first) move in {notation}.")
    elif shape == "line":
        lines.append(f"Reply with the full solution as a sequence of moves in {notation}, in order.")
    else:  # play
        lines.append(f"Reply with your move in {notation}.")
    return "\n".join(lines)


# --- Built-in solvers (baseline / testing) ---


class OracleComposedSolver:
    """Returns the stored solution -- confirms the grader accepts correct answers."""

    name = "oracle"

    def solve(self, problem: ComposedProblem, condition: Condition) -> str:
        return " ".join(problem.solution)


class RandomComposedSolver:
    """Returns a single random legal move -- a floor baseline (fails ~everything)."""

    def __init__(self, seed: int = 0) -> None:
        import random

        self._rng = random.Random(seed)
        self.name = "random"

    def solve(self, problem: ComposedProblem, condition: Condition) -> str:
        board = chess.Board(problem.fen)
        return self._rng.choice(list(board.legal_moves)).uci()


class LLMComposedSolver:
    """Prompts a Model once and returns its raw answer text."""

    def __init__(self, model: Model) -> None:
        self._model = model
        self.name = model.name

    def solve(self, problem: ComposedProblem, condition: Condition) -> str:
        prompt = build_composed_prompt(problem, condition)
        return self._model.generate(prompt, temperature=condition.temperature)


# --- Grading (key / line shapes) ---


def grade_composed(solver: ComposedSolver, problem: ComposedProblem, condition: Condition) -> ComposedResult:
    """Grade a one-shot (key or line) composed problem via the solver in the loop."""
    board = chess.Board(problem.fen)
    raw = solver.solve(problem, condition)

    if problem.answer_shape == "key":
        return _grade_key(problem, board, raw)
    if problem.answer_shape == "line":
        return _grade_line(problem, board, raw)
    raise ValueError(f"{problem.kind} is graded interactively; use solvers.grade_study, not grade_composed.")


def _grade_key(problem: ComposedProblem, board: chess.Board, raw: str) -> ComposedResult:
    move, _tok = board_utils.extract_move(board, raw)
    first_legal = move is not None
    if move is None:
        return ComposedResult(problem.id, problem.kind, False, 0.0, False, "no legal move parsed", raw)

    if problem.kind == "directmate":
        ok = stipulations.verify_directmate(board, problem.n, move)
    elif problem.kind == "selfmate":
        ok = stipulations.verify_selfmate(board, problem.n, move)
    elif problem.kind == "reflexmate":
        ok = stipulations.verify_reflexmate(board, problem.n, move)
    else:  # pragma: no cover - guarded by answer_shape
        raise ValueError(problem.kind)

    detail = f"key {move.uci()} {'forces' if ok else 'does not force'} {problem.label}"
    return ComposedResult(problem.id, problem.kind, ok, 1.0 if ok else 0.0, first_legal, detail, raw)


def _grade_line(problem: ComposedProblem, board: chess.Board, raw: str) -> ComposedResult:
    if problem.kind == "proofgame":
        moves = [m.uci() for m in board_utils.extract_move_sequence(chess.Board(), raw)]
        ok = proofgame.verify_proofgame(problem.fen, moves, n_plies=problem.n)
        first_legal = bool(moves)
        detail = f"{len(moves)} plies {'reach' if ok else 'do not reach'} the target in {problem.n}"
        return ComposedResult(problem.id, problem.kind, ok, 1.0 if ok else 0.0, first_legal, detail, raw)

    if problem.kind in ("series_directmate", "series_helpmate"):
        return _grade_series(problem, board, raw)

    line = board_utils.extract_move_sequence(board, raw)
    first_legal = bool(line)
    if problem.kind == "helpmate":
        ok = stipulations.verify_helpmate_line(board, problem.n, line)
    else:  # pragma: no cover - guarded by answer_shape
        raise ValueError(f"line grading for {problem.kind} is not implemented")
    detail = f"{len(line)}-ply line is {'a valid' if ok else 'not a'} {problem.label}"
    return ComposedResult(problem.id, problem.kind, ok, 1.0 if ok else 0.0, first_legal, detail, raw)


def _grade_series(problem: ComposedProblem, board: chess.Board, raw: str) -> ComposedResult:
    """Series-movers need a bespoke parse: the opponent passes, so all the series
    moves are by the side to move (plus, for series-helpmate, one opponent mate)."""
    side = board.turn
    n = problem.n
    total = n if problem.kind == "series_directmate" else n + 1
    work = board.copy()
    moves: list[chess.Move] = []
    for token in board_utils.move_tokens(raw):
        move = board_utils.parse_move(work, token)
        if move is None:
            continue
        moves.append(move)
        work.push(move)
        if len(moves) >= total:
            break
        if len(moves) <= n - 1:  # still within the series: opponent passes
            work.turn = side
            work.ep_square = None
    first_legal = bool(moves)
    if problem.kind == "series_directmate":
        ok = series.verify_series_directmate(board, n, moves)
    else:
        ok = series.verify_series_helpmate(board, n, moves)
    detail = f"{len(moves)}-move series is {'a valid' if ok else 'not a'} {problem.label}"
    return ComposedResult(problem.id, problem.kind, ok, 1.0 if ok else 0.0, first_legal, detail, raw)


# --- Persistence ---


def load_composed(path: str | Path) -> list[ComposedProblem]:
    with open(path, encoding="utf-8") as f:
        rows = json.load(f)
    return [ComposedProblem(**row) for row in rows]


def save_composed(problems: list[ComposedProblem], path: str | Path) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump([asdict(p) for p in problems], f, indent=1)
