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
from typing import Callable, Iterator, cast

import chess

from ..agents import Agent, TurnContext
from ..conditions import Condition, Legality, PuzzleProtocol
from ..core import board as board_utils
from ..models import EmptyCompletionError, ModelError
from ..types import Message, PuzzleFailure
from ..usage import normalize_usage


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
    # Woodpecker is organized as a training set, not as a rating ladder.
    # Source ratings remain useful provenance, while hand-curated positions can
    # be explicitly assigned to an editorial section without inventing an Elo.
    difficulty_band: str = ""

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
    solved: bool  # completed a full acceptable line
    score: float  # partial credit in [0, 1]
    first_move_legal: bool
    all_moves_legal: bool
    illegal_attempts: int
    failure_reason: PuzzleFailure | None
    solver_plies: int
    plies_correct: int
    moves_played: list[str] = field(default_factory=list)
    # first solver ply's answer (for the web browser / auditing)
    answer_move: str | None = None
    answer_explanation: str | None = None
    answer_raw: str | None = None
    turns: list[dict[str, object]] = field(default_factory=list)
    answer_response_format_valid: bool | None = None
    answer_response_format_error: str | None = None
    # Populated by adaptive rated sessions. They live on the result itself so
    # a resumed run can reconstruct and audit every rating transition without
    # relying on mutable process state.
    solver_rating_before: dict[str, object] | None = None
    solver_rating_after: dict[str, object] | None = None
    rated_selection: dict[str, object] | None = None


@dataclass
class PuzzleCheckpoint:
    """Durable state for an interactive, move-by-move puzzle.

    A terminal result is checkpointed before it is returned to the runner. This
    lets a restart finish the item without repeating its final paid request.
    Full-line/Woodpecker puzzles intentionally remain item-durable because they
    make a single request.
    """

    puzzle_id: str
    board_fen: str
    solver_ply: int
    active_lines: list[int]
    history_san: list[str]
    moves_played: list[str]
    plies_correct: int
    illegal_attempts: int
    first_move_legal: bool | None
    all_moves_legal: bool
    answer: dict[str, object]
    turns: list[dict[str, object]]
    attempts_used: int
    illegal_feedback: str | None
    conversation: list[Message]
    terminal_result: PuzzleResult | None = None
    history_uci: list[str] = field(default_factory=list)


def _turn_record(
    k: int,
    ctx: TurnContext,
    parsed_move: chess.Move | None,
    *,
    model_error: str | None = None,
) -> dict[str, object]:
    usage = ctx.last_usage or {}
    metrics = normalize_usage(
        usage,
        cost_usd=ctx.last_cost,
        cache_discount_usd=ctx.last_cache_discount,
        cache_policy=ctx.last_cache_policy,
        cache_session_id=ctx.last_cache_session_id,
    )
    return {
        "solver_ply": k,
        "system_prompt": ctx.last_system_prompt,
        "prompt": ctx.last_prompt,
        "raw_response": ctx.last_raw_response,
        "parsed_move": parsed_move.uci() if parsed_move else None,
        "rationale": ctx.last_explanation,
        "explanation": ctx.last_explanation,
        "response_format_valid": ctx.last_response_format_valid,
        "response_format_error": ctx.last_response_format_error,
        "response_format": ctx.last_response_format,
        "reasoning": ctx.last_reasoning,
        "reasoning_details": ctx.last_reasoning_details,
        "model_error": model_error,
        "provider_error": ctx.last_provider_error,
        "request_payload": ctx.last_request_payload,
        "provider_response": ctx.last_provider_response,
        "provider_response_raw": ctx.last_provider_response_raw,
        "http_status": ctx.last_http_status,
        "response_headers": ctx.last_response_headers,
        "response_id": ctx.last_response_id,
        "response_model": ctx.last_response_model,
        "response_provider": ctx.last_response_provider,
        "finish_reason": ctx.last_finish_reason,
        "native_finish_reason": ctx.last_native_finish_reason,
        "usage": dict(usage),
        **metrics.to_dict(),
    }


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


def _matching_line_prefix(
    board: chess.Board,
    played: list[chess.Move],
    expected: list[str],
) -> int:
    """Return the accepted prefix, including an alternate mate at line end."""
    replay = board.copy()
    prefix = 0
    for index, move in enumerate(played[: len(expected)]):
        if move.uci() != expected[index] and not (
            index == len(expected) - 1 and _is_mate_after(replay, move)
        ):
            break
        replay.push(move)
        prefix += 1
    return prefix


def grade_puzzle(
    agent: Agent,
    puzzle: Puzzle,
    condition: Condition,
    *,
    checkpoint: PuzzleCheckpoint | None = None,
    on_checkpoint: Callable[[PuzzleCheckpoint], None] | None = None,
) -> PuzzleResult:
    """Play the puzzle out ply by ply against the set of acceptable lines.

    At each solver ply we track which lines remain consistent with the moves so
    far; a move is correct if it matches any still-viable line (or mates on that
    line's final ply). Every move is validated with python-chess -- legality is
    never decided by a lenient string match.
    """
    start = getattr(agent, "start_puzzle", None)
    if callable(start):
        start(puzzle.id)
    if condition.puzzle_protocol == PuzzleProtocol.FULL_LINE:
        return _grade_full_line(agent, puzzle, condition)

    if checkpoint is not None and checkpoint.puzzle_id != puzzle.id:
        raise ValueError(
            f"checkpoint for {checkpoint.puzzle_id!r} cannot resume {puzzle.id!r}"
        )

    lines = puzzle.solution_lines()
    n_solver = puzzle.num_solver_plies() or 1
    reset = getattr(agent, "reset_puzzle", None)
    if callable(reset):
        reset()

    if checkpoint is None:
        board = chess.Board(puzzle.fen)
        board.push(chess.Move.from_uci(puzzle.moves[0]))
        active: list[int] = list(range(len(lines)))
        history_san: list[str] = []
        history_uci: list[str] = []
        moves_played: list[str] = []
        plies_correct = 0
        illegal_attempts = 0
        first_move_legal: bool | None = None
        all_moves_legal = True
        answer: dict[str, object] = {
            "move": None,
            "explanation": None,
            "raw": None,
            "response_format_valid": None,
            "response_format_error": None,
        }
        turns: list[dict[str, object]] = []
        k = 0
        attempts_used = 0
        feedback: str | None = None
    else:
        board = chess.Board(checkpoint.board_fen)
        active = list(checkpoint.active_lines)
        if any(index < 0 or index >= len(lines) for index in active):
            raise ValueError(f"checkpoint for {puzzle.id!r} has invalid active lines")
        history_san = list(checkpoint.history_san)
        moves_played = list(checkpoint.moves_played)
        plies_correct = checkpoint.plies_correct
        illegal_attempts = checkpoint.illegal_attempts
        first_move_legal = checkpoint.first_move_legal
        all_moves_legal = checkpoint.all_moves_legal
        answer = dict(checkpoint.answer)
        turns = [dict(turn) for turn in checkpoint.turns]
        k = checkpoint.solver_ply
        history_uci = list(checkpoint.history_uci)
        if not history_uci and k and active:
            # Compatibility for a checkpoint created before UCI prompt history
            # was persisted. Reconstruct completed plies from the viable line.
            resume_line = lines[active[0]]
            for previous in range(k):
                if previous < len(moves_played):
                    history_uci.append(moves_played[previous])
                reply_index = previous * 2 + 1
                if reply_index < len(resume_line):
                    history_uci.append(resume_line[reply_index])
        attempts_used = checkpoint.attempts_used
        feedback = checkpoint.illegal_feedback
        restore = getattr(agent, "restore_puzzle", None)
        if callable(restore):
            restore([dict(message) for message in checkpoint.conversation])
        if checkpoint.terminal_result is not None:
            return checkpoint.terminal_result

    def result(solved: bool, reason: PuzzleFailure | None) -> PuzzleResult:
        return PuzzleResult(
            puzzle_id=puzzle.id,
            rating=puzzle.rating,
            themes=puzzle.themes,
            solved=solved,
            score=1.0 if solved else plies_correct / n_solver,
            first_move_legal=bool(first_move_legal),
            all_moves_legal=all_moves_legal,
            illegal_attempts=illegal_attempts,
            failure_reason=reason,
            solver_plies=n_solver,
            plies_correct=plies_correct,
            moves_played=moves_played,
            answer_move=answer["move"] if isinstance(answer["move"], str) else None,
            answer_explanation=answer["explanation"]
            if isinstance(answer["explanation"], str)
            else None,
            answer_raw=answer["raw"] if isinstance(answer["raw"], str) else None,
            turns=turns,
            answer_response_format_valid=(
                answer["response_format_valid"]
                if isinstance(answer["response_format_valid"], bool)
                else None
            ),
            answer_response_format_error=(
                answer["response_format_error"]
                if isinstance(answer["response_format_error"], str)
                else None
            ),
        )

    def conversation_snapshot() -> list[Message]:
        snapshot = getattr(agent, "puzzle_conversation", None)
        if not callable(snapshot):
            return []
        return [cast(Message, dict(message)) for message in snapshot()]

    def persist(current_result: PuzzleResult | None = None) -> None:
        if on_checkpoint is None:
            return
        on_checkpoint(
            PuzzleCheckpoint(
                puzzle_id=puzzle.id,
                board_fen=board.fen(en_passant="fen"),
                solver_ply=k,
                active_lines=list(active),
                history_san=list(history_san),
                moves_played=list(moves_played),
                plies_correct=plies_correct,
                illegal_attempts=illegal_attempts,
                first_move_legal=first_move_legal,
                all_moves_legal=all_moves_legal,
                answer=dict(answer),
                turns=[dict(turn) for turn in turns],
                attempts_used=attempts_used,
                illegal_feedback=feedback,
                conversation=conversation_snapshot(),
                terminal_result=current_result,
                history_uci=list(history_uci),
            )
        )

    while True:
        pos = 2 * k
        if not any(len(lines[i]) > pos for i in active):
            final = result(True, None)  # every viable line is complete
            persist(final)
            return final

        max_tries = (
            condition.retry_attempts + 1 if condition.legality == Legality.RETRY else 1
        )
        chosen: chess.Move | None = None
        while attempts_used < max_tries:
            ctx = TurnContext(
                condition=condition,
                history_san=list(history_san),
                history_uci=list(history_uci),
                illegal_feedback=feedback,
            )
            empty_completion_error: str | None = None
            try:
                raw = agent.choose(board, ctx)
            except EmptyCompletionError as exc:
                # A normally completed generation with no visible answer is a
                # model output, not an infrastructure outage. Preserve its
                # provider audit and score it like any other unparseable move.
                raw = ""
                empty_completion_error = str(exc)
            except ModelError as exc:
                # A billed provider failure is auditable and durable, but it is
                # not a chess attempt: do not consume retry allowance, alter the
                # score, or add it to the model's conversation.
                turns.append(_turn_record(k, ctx, None, model_error=str(exc)))
                persist()
                raise
            move = board_utils.parse_move(board, raw)
            turns.append(
                _turn_record(
                    k,
                    ctx,
                    move,
                    model_error=empty_completion_error,
                )
            )
            attempts_used += 1
            if (
                k == 0 and answer["raw"] is None
            ):  # capture the model's first answer for auditing/UI
                answer["move"] = move.uci() if move else raw[:40]
                answer["explanation"] = ctx.last_explanation
                answer["raw"] = (ctx.last_raw_response or raw)[:2000]
                answer["response_format_valid"] = ctx.last_response_format_valid
                answer["response_format_error"] = ctx.last_response_format_error
            if first_move_legal is None:
                first_move_legal = move is not None
            if move is not None:
                chosen = move
                break
            illegal_attempts += 1
            all_moves_legal = False
            feedback = f"'{raw}' is not a legal move"
            if attempts_used >= max_tries:
                final = result(False, "illegal")
                persist(final)
                return final
            persist()

        if chosen is None:
            final = result(False, "illegal")
            persist(final)
            return final

        uci = chosen.uci()
        viable = [i for i in active if len(lines[i]) > pos and lines[i][pos] == uci]
        final_ply_lines = [i for i in active if len(lines[i]) == pos + 1]
        if not viable and final_ply_lines and _is_mate_after(board, chosen):
            viable = final_ply_lines  # accept an alternate mating move

        moves_played.append(uci)
        history_san.append(board.san(chosen))
        history_uci.append(uci)
        if not viable:
            final = result(False, "wrong_move")
            persist(final)
            return final

        plies_correct += 1
        active = viable
        board.push(chosen)

        # Play the opponent's forced reply (unique in a sound puzzle) and prune.
        replies = [lines[i][pos + 1] for i in active if len(lines[i]) > pos + 1]
        if replies:
            reply_uci = replies[0]
            reply = chess.Move.from_uci(reply_uci)
            history_san.append(board.san(reply))
            history_uci.append(reply_uci)
            board.push(reply)
            active = [
                i
                for i in active
                if len(lines[i]) > pos + 1 and lines[i][pos + 1] == reply_uci
            ]
        k += 1
        attempts_used = 0
        feedback = None
        if not any(len(lines[i]) > 2 * k for i in active):
            final = result(True, None)
            persist(final)
            return final
        # This commit is the resume boundary before the next provider request.
        persist()


def _grade_full_line(
    agent: Agent, puzzle: Puzzle, condition: Condition
) -> PuzzleResult:
    """Grade a Woodpecker-style one-shot answer containing the full variation.

    The expected line includes both the solver's moves and the forced replies.
    Partial credit counts correct solver plies in the longest matching prefix,
    exactly as the move-by-move protocol does.
    """
    solve_line = getattr(agent, "solve_line", None)
    if not callable(solve_line):
        raise TypeError("full-line puzzle protocol requires an agent with solve_line()")

    board = chess.Board(puzzle.fen)
    board.push(chess.Move.from_uci(puzzle.moves[0]))
    ctx = TurnContext(condition=condition)
    raw = str(solve_line(board.copy(), ctx))
    parsed = board_utils.parse_model_line_response(board, raw)
    moves = parsed.moves
    played = [m.uci() for m in moves]
    lines = puzzle.solution_lines()
    n_solver = puzzle.num_solver_plies() or 1

    best_prefix = 0
    solved = False
    for line in lines:
        prefix = _matching_line_prefix(board, moves, line)
        best_prefix = max(best_prefix, prefix)
        if len(played) >= len(line) and prefix == len(line):
            solved = True

    plies_correct = sum(1 for i in range(best_prefix) if i % 2 == 0)
    first_move_legal = bool(moves)
    failure: PuzzleFailure | None = (
        None if solved else ("wrong_move" if moves else "illegal")
    )
    answer_move = played[0] if played else raw.strip().split("\n")[0][:40]
    return PuzzleResult(
        puzzle_id=puzzle.id,
        rating=puzzle.rating,
        themes=puzzle.themes,
        solved=solved,
        score=1.0 if solved else plies_correct / n_solver,
        first_move_legal=first_move_legal,
        all_moves_legal=bool(moves),
        illegal_attempts=0 if moves else 1,
        failure_reason=failure,
        solver_plies=n_solver,
        plies_correct=plies_correct,
        moves_played=played,
        answer_move=answer_move,
        answer_explanation=ctx.last_explanation,
        answer_raw=(ctx.last_raw_response or raw)[:2000],
        turns=[_turn_record(0, ctx, moves[0] if moves else None)],
        answer_response_format_valid=ctx.last_response_format_valid,
        answer_response_format_error=ctx.last_response_format_error,
    )


def iter_grades(
    agent: Agent, puzzles: list[Puzzle], condition: Condition
) -> Iterator[PuzzleResult]:
    for p in puzzles:
        yield grade_puzzle(agent, p, condition)
