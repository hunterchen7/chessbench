"""Generate our own puzzles with Stockfish, and curate Lichess ones.

Two independent sourcing paths, so the benchmark is not hostage to a single
corpus:

* `generate_puzzles` mines *fresh* tactical puzzles from random-ish positions.
  Because the positions never appeared in any game database, they cannot be in a
  model's pretraining data -- directly mitigating the contamination risk that
  makes public Lichess puzzles an upper bound. A puzzle is emitted only where the
  side to move has an "only move": the best move beats the second-best by a wide
  margin (`min_gap_cp`) and the resulting advantage is decisive (`min_advantage_cp`).
  The forced line is extended while it stays uniquely best. Engine-equivalent
  first moves (within `alt_margin_cp`) are recorded as `alternates`.

* `curate_lichess` filters an existing Lichess set down to "high quality" puzzles
  by rating-deviation, play count, and popularity.

Ratings for generated puzzles are a documented heuristic (they grow with line
length); they are NOT Glicko-calibrated like Lichess ratings.
"""

from __future__ import annotations

import random
from dataclasses import replace

import chess

from ..core.engine import MATE_CP, Engine
from .puzzles import Puzzle

# A position must be at least this winning for the side to move, and the best
# move at least this much better than the second-best, to seed a puzzle.
DEFAULT_MIN_ADVANTAGE_CP = 200
DEFAULT_MIN_GAP_CP = 150
DEFAULT_ALT_MARGIN_CP = 30


def random_positions(
    count: int, *, min_plies: int = 8, max_plies: int = 40, seed: int = 0
) -> list[tuple[chess.Board, chess.Move]]:
    """Play uniform-random legal moves to reach varied positions.

    Returns (board_before_last_move, last_move) pairs: the last move becomes the
    puzzle's setup move (moves[0]) and `board_before_last_move` its FEN, matching
    the Lichess convention.
    """
    rng = random.Random(seed)
    out: list[tuple[chess.Board, chess.Move]] = []
    attempts = 0
    while len(out) < count and attempts < count * 50:
        attempts += 1
        board = chess.Board()
        target = rng.randint(min_plies, max_plies)
        history: list[chess.Board] = []
        ok = True
        for _ in range(target):
            if board.is_game_over():
                ok = False
                break
            history.append(board.copy())
            move = rng.choice(list(board.legal_moves))
            board.push(move)
        if ok and not board.is_game_over() and board.move_stack:
            out.append((history[-1], board.peek()))
    return out


def _find_tactic(
    engine: Engine, board: chess.Board, *, min_gap_cp: int, max_solver_plies: int, min_advantage_cp: int
) -> list[str] | None:
    """Return the forced solver line (post-setup UCI moves) or None.

    The line alternates solver move / opponent best reply, and is extended only
    while the solver's move stays uniquely best by `min_gap_cp`.
    """
    work = board.copy()
    solver = work.turn
    line: list[str] = []

    for ply in range(max_solver_plies):
        tops = engine.top_moves(work, n=2)
        if not tops:
            break
        best_move, best_cp = tops[0]
        second_cp = tops[1][1] if len(tops) > 1 else -MATE_CP
        if ply == 0 and best_cp < min_advantage_cp:
            return None  # not actually winning
        if best_cp - second_cp < min_gap_cp:
            break  # no longer a unique "only move"; stop the line here
        line.append(best_move.uci())
        work.push(best_move)
        if work.is_game_over():
            break
        reply = engine.best_move(work)  # opponent's forced best defense
        line.append(reply.uci())
        work.push(reply)
        if work.is_game_over():
            break

    # A puzzle line must end on the SOLVER's move; drop any dangling opponent reply.
    if len(line) % 2 == 0:
        line = line[:-1]
    return line if line else None


def _alternate_first_moves(engine: Engine, board: chess.Board, best_uci: str, margin_cp: int) -> list[str]:
    """First moves engine-equivalent to the best (within `margin_cp`)."""
    tops = engine.top_moves(board, n=4)
    if not tops:
        return []
    best_cp = tops[0][1]
    return [m.uci() for m, cp in tops if m.uci() != best_uci and best_cp - cp <= margin_cp]


def _themes(board_after_setup: chess.Board, line: list[str]) -> list[str]:
    """Coarse auto-themes for a generated puzzle."""
    n_solver = len(range(0, len(line), 2))
    themes = ["generated"]
    themes.append("oneMove" if n_solver == 1 else ("short" if n_solver == 2 else "long"))
    end = board_after_setup.copy()
    for uci in line:
        end.push(chess.Move.from_uci(uci))
    if end.is_checkmate():
        themes.append("mate")
        themes.append(f"mateIn{n_solver}")
    return themes


def _heuristic_rating(n_solver_plies: int) -> int:
    """Difficulty proxy that grows with line length (NOT Glicko-calibrated)."""
    return min(2600, 1000 + 300 * (n_solver_plies - 1))


def generate_puzzles(
    engine: Engine,
    count: int,
    *,
    min_gap_cp: int = DEFAULT_MIN_GAP_CP,
    max_solver_plies: int = 4,
    min_advantage_cp: int = DEFAULT_MIN_ADVANTAGE_CP,
    alt_margin_cp: int = DEFAULT_ALT_MARGIN_CP,
    seed: int = 0,
    pool_multiplier: int = 8,
) -> list[Puzzle]:
    """Mine up to `count` fresh, contamination-free tactical puzzles."""
    candidates = random_positions(count * pool_multiplier, seed=seed)
    puzzles: list[Puzzle] = []
    for i, (before, setup) in enumerate(candidates):
        if len(puzzles) >= count:
            break
        after = before.copy()
        after.push(setup)
        if after.is_game_over():
            continue
        line = _find_tactic(
            engine, after, min_gap_cp=min_gap_cp, max_solver_plies=max_solver_plies,
            min_advantage_cp=min_advantage_cp,
        )
        if not line:
            continue
        n_solver = len(range(0, len(line), 2))
        alternates = _alternate_first_moves(engine, after, line[0], alt_margin_cp)
        alt_lines = [[alt, *line[1:]] for alt in alternates] if alternates else []
        puzzles.append(
            Puzzle(
                id=f"gen_{seed}_{i:05d}",
                fen=before.fen(),
                moves=[setup.uci(), *line],
                rating=_heuristic_rating(n_solver),
                themes=_themes(after, line),
                source="generated",
                alternates=alt_lines,
            )
        )
    return puzzles


def curate_lichess(
    puzzles: list[Puzzle], *, max_rating_deviation: int = 90, min_plays: int = 1000, min_popularity: int = 90
) -> list[Puzzle]:
    """Keep only well-calibrated, well-tested, well-liked puzzles.

    Low rating-deviation => the Glicko rating has converged; high play count and
    popularity => the puzzle is unambiguous and enjoyed (a proxy for quality).
    """
    return [
        replace(p)
        for p in puzzles
        if p.rating_deviation <= max_rating_deviation
        and p.nb_plays >= min_plays
        and p.popularity >= min_popularity
    ]
