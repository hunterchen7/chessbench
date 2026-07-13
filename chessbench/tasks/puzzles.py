"""Puzzle track: load, grade, and record per-puzzle results.

Puzzle convention (Lichess-style, and the usual source of bugs):
  * FEN is the position BEFORE the opponent's setup move.
  * moves[0] is that setup move -- we play it automatically to reach the puzzle.
  * The SOLVER then plays moves[1], moves[3], ... (odd indices); the opponent's
    forced replies moves[2], moves[4], ... are played automatically.

Grading supports what real puzzles need:
  * MULTIPLE / ALTERNATE solutions -- `Puzzle.alternates` holds extra full
    post-setup lines; a move is correct if it matches ANY still-viable line.
  * MATE ACCEPTANCE -- any move that delivers checkmate is accepted on a line's
    final ply (a puzzle can have several mating moves).
  * PARTIAL CREDIT -- multi-move puzzles score `plies_correct / solver_plies`
    in [0, 1], so following half a combination beats blundering immediately.
"""

from __future__ import annotations

import csv
import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Iterator

import chess

from ..agents import Agent, TurnContext
from ..conditions import Condition, Legality
from ..core import board as board_utils
from ..types import PuzzleFailure


@dataclass
class Puzzle:
    """A single position with one or more acceptable solution lines.

    `moves` is the primary line in UCI, with moves[0] the opponent's setup move.
    `alternates` are additional acceptable POST-setup lines (each alternating
    solver/opponent, i.e. aligned with moves[1:]).
    """

    id: str
    fen: str
    moves: list[str]
    rating: int
    rating_deviation: int = 0
    popularity: int = 0
    nb_plays: int = 0
    themes: list[str] = field(default_factory=list)
    game_url: str = ""
    opening_tags: str = ""
    source: str = "lichess"
    alternates: list[list[str]] = field(default_factory=list)

    @property
    def solver_is_white(self) -> bool:
        board = chess.Board(self.fen)
        board.push(chess.Move.from_uci(self.moves[0]))
        return board.turn == chess.WHITE

    def solution_lines(self) -> list[list[str]]:
        """All acceptable post-setup lines (primary first, then alternates)."""
        return [self.moves[1:], *self.alternates]

    def num_solver_plies(self) -> int:
        """Number of moves the solver must make in the primary line."""
        return len(range(1, len(self.moves), 2))


@dataclass
class PuzzleResult:
    puzzle_id: str
    rating: int
    themes: list[str]
    solved: bool                   # completed a full acceptable line
    score: float                   # partial credit in [0, 1]
    first_move_legal: bool
    all_moves_legal: bool
    illegal_attempts: int
    failure_reason: PuzzleFailure | None
    solver_plies: int
    plies_correct: int
    moves_played: list[str] = field(default_factory=list)


def load_puzzles(path: str | Path, limit: int | None = None) -> list[Puzzle]:
    """Load puzzles, dispatching on extension: ``.json`` (our generated format,
    which can carry alternates) or Lichess-style ``.csv``."""
    if str(path).endswith(".json"):
        return load_puzzles_json(path, limit)
    return _load_csv(path, limit)


def _load_csv(path: str | Path, limit: int | None) -> list[Puzzle]:
    out: list[Puzzle] = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            out.append(
                Puzzle(
                    id=row["PuzzleId"],
                    fen=row["FEN"],
                    moves=row["Moves"].split(),
                    rating=int(row["Rating"]),
                    rating_deviation=int(row.get("RatingDeviation") or 0),
                    popularity=int(row.get("Popularity") or 0),
                    nb_plays=int(row.get("NbPlays") or 0),
                    themes=(row.get("Themes") or "").split(),
                    game_url=row.get("GameUrl", ""),
                    opening_tags=row.get("OpeningTags", ""),
                    source=row.get("Source", "lichess"),
                )
            )
            if limit and len(out) >= limit:
                break
    return out


def load_puzzles_json(path: str | Path, limit: int | None = None) -> list[Puzzle]:
    """Load puzzles from a JSON array of Puzzle dicts (our generated format)."""
    with open(path, encoding="utf-8") as f:
        rows = json.load(f)
    puzzles = [Puzzle(**row) for row in rows]
    return puzzles[:limit] if limit else puzzles


def save_puzzles_json(puzzles: list[Puzzle], path: str | Path) -> None:
    """Serialize puzzles (including alternates) to a JSON array."""
    with open(path, "w", encoding="utf-8") as f:
        json.dump([asdict(p) for p in puzzles], f, indent=1)


def _is_mate_after(board: chess.Board, move: chess.Move) -> bool:
    board.push(move)
    try:
        return board.is_checkmate()
    finally:
        board.pop()


def grade_puzzle(agent: Agent, puzzle: Puzzle, condition: Condition) -> PuzzleResult:
    """Play the puzzle out ply by ply against the set of acceptable lines.

    At each solver ply we track which lines remain consistent with the moves so
    far; a move is correct if it matches any still-viable line (or mates on that
    line's final ply). Every move is validated with python-chess -- legality is
    never decided by a lenient string match.
    """
    board = chess.Board(puzzle.fen)
    board.push(chess.Move.from_uci(puzzle.moves[0]))

    lines = puzzle.solution_lines()
    n_solver = puzzle.num_solver_plies() or 1
    active: list[int] = list(range(len(lines)))

    history_san: list[str] = []
    moves_played: list[str] = []
    plies_correct = 0
    illegal_attempts = 0
    first_move_legal: bool | None = None
    all_moves_legal = True

    def result(solved: bool, reason: PuzzleFailure | None) -> PuzzleResult:
        return PuzzleResult(
            puzzle_id=puzzle.id, rating=puzzle.rating, themes=puzzle.themes,
            solved=solved, score=1.0 if solved else plies_correct / n_solver,
            first_move_legal=bool(first_move_legal), all_moves_legal=all_moves_legal,
            illegal_attempts=illegal_attempts, failure_reason=reason,
            solver_plies=n_solver, plies_correct=plies_correct, moves_played=moves_played,
        )

    k = 0  # solver-ply index (0-based)
    while True:
        pos = 2 * k
        if not any(len(lines[i]) > pos for i in active):
            return result(True, None)  # every viable line is complete

        max_tries = condition.retry_attempts + 1 if condition.legality == Legality.RETRY else 1
        chosen: chess.Move | None = None
        feedback: str | None = None
        for _ in range(max_tries):
            ctx = TurnContext(condition=condition, history_san=list(history_san), illegal_feedback=feedback)
            raw = agent.choose(board, ctx)
            move = board_utils.parse_move(board, raw)
            if first_move_legal is None:
                first_move_legal = move is not None
            if move is not None:
                chosen = move
                break
            illegal_attempts += 1
            all_moves_legal = False
            feedback = f"'{raw}' is not a legal move"

        if chosen is None:
            return result(False, "illegal")

        uci = chosen.uci()
        viable = [i for i in active if len(lines[i]) > pos and lines[i][pos] == uci]
        final_ply_lines = [i for i in active if len(lines[i]) == pos + 1]
        if not viable and final_ply_lines and _is_mate_after(board, chosen):
            viable = final_ply_lines  # accept an alternate mating move

        moves_played.append(uci)
        history_san.append(board.san(chosen))
        if not viable:
            return result(False, "wrong_move")

        plies_correct += 1
        active = viable
        board.push(chosen)

        # Play the opponent's forced reply (unique in a sound puzzle) and prune.
        replies = [lines[i][pos + 1] for i in active if len(lines[i]) > pos + 1]
        if replies:
            reply_uci = replies[0]
            reply = chess.Move.from_uci(reply_uci)
            history_san.append(board.san(reply))
            board.push(reply)
            active = [i for i in active if len(lines[i]) > pos + 1 and lines[i][pos + 1] == reply_uci]
        k += 1


def iter_grades(agent: Agent, puzzles: list[Puzzle], condition: Condition) -> Iterator[PuzzleResult]:
    for p in puzzles:
        yield grade_puzzle(agent, p, condition)
