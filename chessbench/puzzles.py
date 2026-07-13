"""Lichess puzzle track: load, grade, and record per-puzzle results.

Lichess convention (critical, and the usual source of bugs):
  * FEN is the position BEFORE the opponent's setup move.
  * Moves[0] is that opponent move -- you play it automatically to reach the
    puzzle position.
  * The SOLVER then plays Moves[1], Moves[3], ... (odd indices). Between them,
    the opponent's forced replies Moves[2], Moves[4], ... are played for you.
  * All solver moves are "only moves" EXCEPT that any move delivering checkmate
    is accepted on the mating ply (there can be several mates).
"""

from __future__ import annotations

import csv
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator

import chess

from .agents import Agent, TurnContext
from .conditions import Condition, Legality


@dataclass
class Puzzle:
    id: str
    fen: str
    moves: list[str]          # UCI; moves[0] is the opponent's setup move
    rating: int
    rating_deviation: int = 0
    popularity: int = 0
    nb_plays: int = 0
    themes: list[str] = field(default_factory=list)
    game_url: str = ""
    opening_tags: str = ""

    @property
    def solver_is_white(self) -> bool:
        # Side to move AFTER the setup move is the solver.
        bd = chess.Board(self.fen)
        bd.push(chess.Move.from_uci(self.moves[0]))
        return bd.turn == chess.WHITE


@dataclass
class PuzzleResult:
    puzzle_id: str
    rating: int
    themes: list[str]
    solved: bool
    first_move_legal: bool         # was the agent's FIRST attempt a legal move?
    all_moves_legal: bool
    illegal_attempts: int
    failure_reason: str | None     # 'illegal' | 'wrong_move' | None
    solver_plies: int
    plies_correct: int
    moves_played: list[str] = field(default_factory=list)


def load_puzzles(path: str | Path, limit: int | None = None) -> list[Puzzle]:
    """Load puzzles from a Lichess-format CSV (the sample fixture or a full dump)."""
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
                )
            )
            if limit and len(out) >= limit:
                break
    return out


def grade_puzzle(agent: Agent, puzzle: Puzzle, condition: Condition) -> PuzzleResult:
    """Play the puzzle out, ply by ply, validating every move with python-chess."""
    board = chess.Board(puzzle.fen)
    board.push(chess.Move.from_uci(puzzle.moves[0]))  # opponent's setup move

    solver_indices = list(range(1, len(puzzle.moves), 2))
    n_plies = len(solver_indices)
    history_san: list[str] = []
    moves_played: list[str] = []

    plies_correct = 0
    illegal_attempts = 0
    first_move_legal: bool | None = None
    all_moves_legal = True

    for ply_no, idx in enumerate(solver_indices):
        expected = puzzle.moves[idx]
        is_last = idx == solver_indices[-1]
        max_tries = condition.retry_attempts + 1 if condition.legality == Legality.RETRY else 1

        chosen: chess.Move | None = None
        feedback: str | None = None
        for attempt in range(max_tries):
            ctx = TurnContext(condition=condition, history_san=list(history_san), illegal_feedback=feedback)
            raw = agent.choose(board, ctx)
            from . import board as board_utils  # local import avoids cycle at module load

            mv = board_utils.parse_move(board, raw)
            legal = mv is not None
            if first_move_legal is None:
                first_move_legal = legal
            if legal:
                chosen = mv
                break
            illegal_attempts += 1
            all_moves_legal = False
            feedback = f"'{raw}' is not a legal move"

        if chosen is None:
            return PuzzleResult(
                puzzle.id, puzzle.rating, puzzle.themes, solved=False,
                first_move_legal=bool(first_move_legal), all_moves_legal=False,
                illegal_attempts=illegal_attempts, failure_reason="illegal",
                solver_plies=n_plies, plies_correct=plies_correct, moves_played=moves_played,
            )

        # A move that delivers checkmate is accepted on the mating ply.
        gives_mate = board.gives_check(chosen) and _is_mate_after(board, chosen)
        correct = chosen.uci() == expected or (is_last and gives_mate)

        moves_played.append(chosen.uci())
        history_san.append(board.san(chosen))

        if not correct:
            return PuzzleResult(
                puzzle.id, puzzle.rating, puzzle.themes, solved=False,
                first_move_legal=bool(first_move_legal), all_moves_legal=all_moves_legal,
                illegal_attempts=illegal_attempts, failure_reason="wrong_move",
                solver_plies=n_plies, plies_correct=plies_correct, moves_played=moves_played,
            )

        plies_correct += 1
        board.push(chosen)

        # Play the opponent's forced reply, if any remain.
        reply_idx = idx + 1
        if reply_idx < len(puzzle.moves):
            reply = chess.Move.from_uci(puzzle.moves[reply_idx])
            history_san.append(board.san(reply))
            board.push(reply)

    return PuzzleResult(
        puzzle.id, puzzle.rating, puzzle.themes, solved=True,
        first_move_legal=bool(first_move_legal), all_moves_legal=all_moves_legal,
        illegal_attempts=illegal_attempts, failure_reason=None,
        solver_plies=n_plies, plies_correct=plies_correct, moves_played=moves_played,
    )


def _is_mate_after(board: chess.Board, move: chess.Move) -> bool:
    board.push(move)
    try:
        return board.is_checkmate()
    finally:
        board.pop()


def iter_grades(agent: Agent, puzzles: list[Puzzle], condition: Condition) -> Iterator[PuzzleResult]:
    for p in puzzles:
        yield grade_puzzle(agent, p, condition)
