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
from copy import deepcopy
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Protocol

import chess

from ..conditions import (
    COACH_ADVICE,
    Condition,
    Legality,
    Notation,
    PromptStyle,
    _legal_line,
    _json_line_instruction,
    _json_move_instruction,
    render_position,
)
from ..core import board as board_utils
from ..models import Model
from ..models.base import generate_with_response_format
from ..response_protocols import ResponseShape, response_format_for
from ..solvers import proofgame, series, stipulations
from ..types import AnswerShape, StipulationKind, StudyGoal
from ..usage import normalize_usage

_ANSWER_SHAPE: dict[StipulationKind, AnswerShape] = {
    "directmate": "key",
    "selfmate": "key",
    "reflexmate": "key",
    "helpmate": "line",
    "series_selfmate": "line",
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
    "series_selfmate": "ser-s#{n}",
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
    n: int  # #n / s#n / h#n length, or ply count for proofgame
    solution: list[str] = field(
        default_factory=list
    )  # a known solution (UCI): [key] or full line
    goal: StudyGoal | None = None  # study only
    themes: list[str] = field(default_factory=list)
    source: str = "chessbench"
    provenance: dict[str, object] = field(default_factory=dict)
    certification: dict[str, object] = field(default_factory=dict)

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
    answer_rationale: str | None = None
    response_format_valid: bool | None = None
    response_format_error: str | None = None
    turns: list[dict[str, object]] = field(default_factory=list)


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
    "series_selfmate": "The side to move plays {n} consecutive moves (the opponent does not move), after which "
    "every legal opponent reply must mate the series side. Give the series and one compelled "
    "mating reply.",
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
    notation = (
        "SAN (e.g. Nf3, Qxe7, O-O)"
        if condition.notation == Notation.SAN
        else "UCI (e.g. g1f3, e7e5)"
    )
    help_text = _STIPULATION_HELP[problem.kind].format(
        n=problem.n, plies=2 * problem.n, goal=problem.goal or ""
    )

    lines = [
        f"You are solving a composed chess problem. Stipulation: {problem.label}.",
        "",
        help_text,
        "",
    ]
    if problem.kind == "proofgame":
        lines.append("Target position to reach:")
    lines.append(render_position(board, condition))
    move_board = chess.Board() if problem.kind == "proofgame" else board
    if condition.legality == Legality.LEGAL_LIST:
        lines.extend(["", _legal_line(move_board, condition)])
    if condition.prompt_style == PromptStyle.COACHED:
        lines.extend(["", COACH_ADVICE])
    lines.append("")

    shape = problem.answer_shape
    if condition.explain and shape in ("key", "play"):
        lines.append(_json_move_instruction())
    elif condition.explain and shape == "line":
        lines.append(_json_line_instruction())
    elif shape == "key":
        lines.append(f"Reply with ONLY the key (first) move in {notation}.")
    elif shape == "line":
        lines.append(
            f"Reply with the full solution as a sequence of moves in {notation}, in order."
        )
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
    """Prompts a Model once and retains the complete visible conversation."""

    def __init__(self, model: Model) -> None:
        self._model = model
        self.name = model.name
        self.last_turn: dict[str, object] | None = None

    def solve(self, problem: ComposedProblem, condition: Condition) -> str:
        set_cache_session = getattr(self._model, "set_cache_session", None)
        if callable(set_cache_session):
            # One-shot tasks have no later request that can amortize an explicit
            # cache write. Provider-default automatic caching may still apply.
            set_cache_session(None)
        prompt = build_composed_prompt(problem, condition)
        response_shape: ResponseShape = (
            "line" if problem.answer_shape == "line" else "move"
        )
        response_format = response_format_for(
            condition.response_protocol, response_shape, explain=condition.explain
        )
        raw, applied_format = generate_with_response_format(
            self._model,
            prompt,
            response_format=response_format,
            temperature=condition.temperature,
            max_tokens=condition.max_output_tokens,
        )
        usage = getattr(self._model, "last_usage", None)
        raw_usage = dict(usage) if isinstance(usage, dict) else {}
        metrics = normalize_usage(
            raw_usage,
            cost_usd=float(getattr(self._model, "last_cost", 0.0)),
            cache_discount_usd=float(
                getattr(self._model, "last_cache_discount", 0.0)
            ),
            cache_policy=str(
                getattr(self._model, "last_cache_policy", "provider_default")
            ),
            cache_session_id=getattr(self._model, "last_cache_session_id", None),
        )
        self.last_turn = {
            "system_prompt": None,
            "prompt": prompt,
            "raw_response": raw,
            "response_format": applied_format,
            "usage": raw_usage,
            **metrics.to_dict(),
        }
        # Readable reasoning and native structured artifacts are separate: the
        # former can be displayed, while the latter may be signed or encrypted
        # provider state that must remain structurally unchanged.
        for key, attribute in (
            ("reasoning", "last_reasoning"),
            ("reasoning_details", "last_reasoning_details"),
            ("request_payload", "last_request_payload"),
            ("provider_response", "last_provider_response"),
            ("provider_response_raw", "last_provider_response_raw"),
            ("response_id", "last_response_id"),
            ("response_model", "last_response_model"),
            ("response_provider", "last_response_provider"),
            ("finish_reason", "last_finish_reason"),
            ("native_finish_reason", "last_native_finish_reason"),
        ):
            value = getattr(self._model, attribute, None)
            if value is not None:
                self.last_turn[key] = deepcopy(value)
        return raw


# --- Grading (key / line shapes) ---


def grade_composed(
    solver: ComposedSolver, problem: ComposedProblem, condition: Condition
) -> ComposedResult:
    """Grade a one-shot (key or line) composed problem via the solver in the loop."""
    board = chess.Board(problem.fen)
    raw = solver.solve(problem, condition)

    if problem.answer_shape == "key":
        result = _grade_key(problem, board, raw)
        parsed_move = board_utils.parse_model_move_response(board, raw)
        rationale = parsed_move.rationale
        format_valid = parsed_move.format_valid
        format_error = parsed_move.format_error
    elif problem.answer_shape == "line":
        result = _grade_line(problem, board, raw)
        parse_board = chess.Board() if problem.kind == "proofgame" else board
        parsed_line = board_utils.parse_model_line_response(parse_board, raw)
        rationale = parsed_line.rationale
        format_valid = parsed_line.format_valid
        format_error = parsed_line.format_error
    else:
        raise ValueError(
            f"{problem.kind} is graded interactively; use solvers.grade_study, not grade_composed."
        )
    result.answer_rationale = rationale
    if condition.explain:
        result.response_format_valid = format_valid
        result.response_format_error = format_error
    turn = getattr(solver, "last_turn", None)
    if isinstance(turn, dict):
        enriched = dict(turn)
        enriched.update(
            {
                "rationale": rationale,
                "response_format_valid": format_valid,
                "response_format_error": format_error,
            }
        )
        result.turns = [enriched]
    return result


def _grade_key(
    problem: ComposedProblem, board: chess.Board, raw: str
) -> ComposedResult:
    move = board_utils.parse_model_move_response(board, raw).move
    first_legal = move is not None
    if move is None:
        return ComposedResult(
            problem.id, problem.kind, False, 0.0, False, "no legal move parsed", raw
        )

    if problem.kind == "directmate":
        ok = stipulations.verify_directmate(board, problem.n, move)
    elif problem.kind == "selfmate":
        ok = stipulations.verify_selfmate(board, problem.n, move)
    elif problem.kind == "reflexmate":
        ok = stipulations.verify_reflexmate(board, problem.n, move)
    else:  # pragma: no cover - guarded by answer_shape
        raise ValueError(problem.kind)

    detail = f"key {move.uci()} {'forces' if ok else 'does not force'} {problem.label}"
    return ComposedResult(
        problem.id, problem.kind, ok, 1.0 if ok else 0.0, first_legal, detail, raw
    )


def _grade_line(
    problem: ComposedProblem, board: chess.Board, raw: str
) -> ComposedResult:
    if problem.kind == "proofgame":
        moves = [
            m.uci()
            for m in board_utils.parse_model_line_response(chess.Board(), raw).moves
        ]
        ok = proofgame.verify_proofgame(problem.fen, moves, n_plies=problem.n)
        first_legal = bool(moves)
        detail = f"{len(moves)} plies {'reach' if ok else 'do not reach'} the target in {problem.n}"
        return ComposedResult(
            problem.id, problem.kind, ok, 1.0 if ok else 0.0, first_legal, detail, raw
        )

    if problem.kind in ("series_directmate", "series_helpmate", "series_selfmate"):
        return _grade_series(problem, board, raw)

    line = board_utils.parse_model_line_response(board, raw).moves
    first_legal = bool(line)
    if problem.kind == "helpmate":
        ok = stipulations.verify_helpmate_line(board, problem.n, line)
    else:  # pragma: no cover - guarded by answer_shape
        raise ValueError(f"line grading for {problem.kind} is not implemented")
    detail = f"{len(line)}-ply line is {'a valid' if ok else 'not a'} {problem.label}"
    return ComposedResult(
        problem.id, problem.kind, ok, 1.0 if ok else 0.0, first_legal, detail, raw
    )


def _grade_series(
    problem: ComposedProblem, board: chess.Board, raw: str
) -> ComposedResult:
    """Series-movers need a bespoke parse: the opponent passes, so all the series
    moves are by the side to move (plus, for series help/selfmate, one opponent mate)."""
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
    elif problem.kind == "series_selfmate":
        ok = series.verify_series_selfmate(board, n, moves)
    else:
        ok = series.verify_series_helpmate(board, n, moves)
    detail = (
        f"{len(moves)}-move series is {'a valid' if ok else 'not a'} {problem.label}"
    )
    return ComposedResult(
        problem.id, problem.kind, ok, 1.0 if ok else 0.0, first_legal, detail, raw
    )


# --- Persistence ---


def load_composed(path: str | Path) -> list[ComposedProblem]:
    with open(path, encoding="utf-8") as f:
        rows = json.load(f)
    return [ComposedProblem(**row) for row in rows]


def save_composed(problems: list[ComposedProblem], path: str | Path) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump([asdict(p) for p in problems], f, indent=1)
