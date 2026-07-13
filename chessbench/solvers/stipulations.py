"""Native solvers/verifiers for composed-problem stipulations.

Unlike tactical puzzles (where the "answer" is the engine's best line), composed
problems answer a *stipulation* and are graded by a solver that enumerates or
verifies solutions. We implement the classic genres directly on python-chess so
there is no dependency on an external binary (Popeye/Jacobi), everything is typed
and unit-tested, and grading is transparent.

Genres here:
  * directmate #n  -- side to move mates in <= n of its own moves vs any defense
  * selfmate  s#n  -- side to move forces the opponent to mate it within n moves
  * reflexmate r#n -- selfmate with the reflex condition: either side MUST mate
                      whenever it can (implemented as a restricted move generator)
  * helpmate  h#n  -- both sides cooperate to mate the side to move; verified by
                      replaying the given 2n-ply line, enumerated for fixtures

The forced-mate searches are exponential in n; they are intended for small n
(the usual composed range, #2-#4, h#2-#3). Callers pass small budgets.
"""

from __future__ import annotations

from typing import Callable

import chess

MoveGen = Callable[[chess.Board], list[chess.Move]]


def legal_moves(board: chess.Board) -> list[chess.Move]:
    return list(board.legal_moves)


def gives_checkmate(board: chess.Board, move: chess.Move) -> bool:
    board.push(move)
    try:
        return board.is_checkmate()
    finally:
        board.pop()


def reflex_moves(board: chess.Board) -> list[chess.Move]:
    """Reflex condition: if any move checkmates, only mating moves are allowed."""
    legal = list(board.legal_moves)
    mating = [m for m in legal if gives_checkmate(board, m)]
    return mating if mating else legal


# --- Directmate: attacker (side to move) mates in <= n against any defense ---


def directmate_forced(board: chess.Board, n: int, moves: MoveGen = legal_moves) -> bool:
    if n <= 0:
        return False
    for m in moves(board):
        board.push(m)
        try:
            if board.is_checkmate():
                return True
            if _defenses_all_lose(board, n - 1, moves):
                return True
        finally:
            board.pop()
    return False


def _defenses_all_lose(board: chess.Board, n: int, moves: MoveGen) -> bool:
    defenses = moves(board)
    if not defenses:
        return False  # defender has no move but isn't mated here => stalemate, not a mate
    for d in defenses:
        board.push(d)
        try:
            if not directmate_forced(board, n, moves):
                return False
        finally:
            board.pop()
    return True


def directmate_keys(board: chess.Board, n: int, moves: MoveGen = legal_moves) -> list[chess.Move]:
    """All first moves that force mate in <= n (a sound #n has exactly one)."""
    return [m for m in moves(board) if verify_directmate(board, n, m, moves)]


def verify_directmate(board: chess.Board, n: int, key: chess.Move, moves: MoveGen = legal_moves) -> bool:
    if key not in board.legal_moves:
        return False
    board.push(key)
    try:
        if board.is_checkmate():
            return n >= 1
        return n >= 2 and _defenses_all_lose(board, n - 1, moves)
    finally:
        board.pop()


# --- Selfmate: attacker forces the DEFENDER to checkmate the attacker in <= n ---


def selfmate_forced(board: chess.Board, n: int, moves: MoveGen = legal_moves) -> bool:
    if n <= 0:
        return False
    for m in moves(board):
        board.push(m)
        try:
            if _defender_compelled(board, n - 1, moves):
                return True
        finally:
            board.pop()
    return False


def _defender_compelled(board: chess.Board, n: int, moves: MoveGen) -> bool:
    """board.turn == defender: every reply must (now or later) mate the attacker."""
    defenses = moves(board)
    if not defenses:
        return False  # defender stalemated => attacker not mated => selfmate fails
    for d in defenses:
        board.push(d)
        try:
            if board.is_checkmate():
                continue  # defender's move mated the attacker -- this line is satisfied
            if not selfmate_forced(board, n, moves):
                return False
        finally:
            board.pop()
    return True


def selfmate_keys(board: chess.Board, n: int, moves: MoveGen = legal_moves) -> list[chess.Move]:
    return [m for m in moves(board) if verify_selfmate(board, n, m, moves)]


def verify_selfmate(board: chess.Board, n: int, key: chess.Move, moves: MoveGen = legal_moves) -> bool:
    if key not in board.legal_moves:
        return False
    board.push(key)
    try:
        return _defender_compelled(board, n - 1, moves)
    finally:
        board.pop()


# --- Reflexmate: selfmate under the reflex condition (mate-if-able for both) ---


def reflexmate_forced(board: chess.Board, n: int) -> bool:
    return selfmate_forced(board, n, reflex_moves)


def reflexmate_keys(board: chess.Board, n: int) -> list[chess.Move]:
    return selfmate_keys(board, n, reflex_moves)


def verify_reflexmate(board: chess.Board, n: int, key: chess.Move) -> bool:
    return verify_selfmate(board, n, key, reflex_moves)


# --- Helpmate: both sides cooperate to mate the side to move after 2n plies ---


def verify_helpmate_line(board: chess.Board, n: int, line: list[chess.Move]) -> bool:
    """A helpmate solution is a 2n-ply cooperative line ending in checkmate."""
    if len(line) != 2 * n:
        return False
    work = board.copy()
    for move in line:
        if move not in work.legal_moves:
            return False
        work.push(move)
    return work.is_checkmate()


def helpmate_solutions(
    board: chess.Board, n: int, *, max_solutions: int = 8, node_budget: int = 200_000
) -> list[list[chess.Move]]:
    """Enumerate cooperative mating lines (for fixture validation).

    Exponential; guarded by `max_solutions` and `node_budget`. Helpmates are
    typically sparse, so small n is tractable.
    """
    solutions: list[list[chess.Move]] = []
    budget = [node_budget]

    def rec(work: chess.Board, plies_left: int, line: list[chess.Move]) -> None:
        if len(solutions) >= max_solutions or budget[0] <= 0:
            return
        if plies_left == 0:
            if work.is_checkmate():
                solutions.append(list(line))
            return
        for move in work.legal_moves:
            budget[0] -= 1
            if budget[0] <= 0:
                return
            # Prune: only the final ply may deliver mate; earlier plies must not
            # end the game (no premature checkmate/stalemate).
            work.push(move)
            over = work.is_game_over()
            if plies_left == 1:
                if work.is_checkmate():
                    solutions.append([*line, move])
            elif not over:
                line.append(move)
                rec(work, plies_left - 1, line)
                line.pop()
            work.pop()

    rec(board, 2 * n, [])
    return solutions
