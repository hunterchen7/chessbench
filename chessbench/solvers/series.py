"""Series-movers: one side plays several consecutive moves while the opponent
stays still.

Convention used here (the common one):
  * series-directmate `ser-#n`: the side to move plays n consecutive legal moves,
    giving NO check until the final move, which must be checkmate.
  * series-helpmate `ser-h#n`: the side to move plays n consecutive legal moves
    (giving no check), reaching a position where the OTHER side delivers mate in
    one; the supplied line is those n moves followed by that mating move.
  * series-selfmate `ser-s#n`: the side to move plays n consecutive legal moves,
    reaching a position where every legal opponent reply mates the series side;
    the supplied line includes one such forced mating reply.

The opponent "passes", so between series moves we hand the turn back to the
series side and clear any en-passant right (there is no opponent move to capture
en passant). Verification replays the supplied line under these rules -- solving
(search) is left to enumeration callers; grading only needs verification.
"""

from __future__ import annotations

import chess


def _run_series(
    board: chess.Board, moves: list[chess.Move], side: chess.Color
) -> chess.Board | None:
    """Replay `moves` as consecutive moves by `side` (opponent passes).

    Rejects (returns None) an illegal move or any check before the final move.
    Leaves the returned board with the OPPONENT to move after the last move.
    """
    work = board.copy()
    n = len(moves)
    for i, move in enumerate(moves):
        if work.turn != side or move not in work.legal_moves:
            return None
        work.push(move)
        is_last = i == n - 1
        if work.is_check() and not is_last:
            return None  # a series move (other than the last) may not give check
        if not is_last:
            work.turn = side  # opponent passes
            work.ep_square = None
    return work


def verify_series_directmate(
    board: chess.Board, n: int, moves: list[chess.Move]
) -> bool:
    """n consecutive moves by the side to move, no check until the final mate."""
    if len(moves) != n:
        return False
    end = _run_series(board, moves, board.turn)
    return end is not None and end.is_checkmate()


def verify_series_helpmate(board: chess.Board, n: int, moves: list[chess.Move]) -> bool:
    """n consecutive (check-free) moves by the side to move, then the opponent
    mates in one. `moves` has length n + 1 (the series plus the mating move)."""
    if len(moves) != n + 1:
        return False
    side = board.turn
    end = _run_series(board, moves[:n], side)
    if end is None or end.is_game_over():
        return False
    # No check may be standing at the end of the series either.
    if end.is_check():
        return False
    mate = moves[n]
    if mate not in end.legal_moves:
        return False
    end.push(mate)
    return end.is_checkmate()


def verify_series_selfmate(board: chess.Board, n: int, moves: list[chess.Move]) -> bool:
    """n consecutive moves, then every legal opponent reply must mate.

    The final series move may give check: in that case each legal check evasion
    must still checkmate the series side.  ``moves[-1]`` records one of the
    compelled mating replies so a benchmark answer remains fully replayable.
    """
    if len(moves) != n + 1:
        return False
    side = board.turn
    end = _run_series(board, moves[:n], side)
    if end is None or end.is_game_over():
        return False
    replies = list(end.legal_moves)
    if not replies or moves[n] not in replies:
        return False
    return all(_is_mate_after(end, reply) for reply in replies)


def _is_mate_after(board: chess.Board, move: chess.Move) -> bool:
    board.push(move)
    try:
        return board.is_checkmate()
    finally:
        board.pop()
