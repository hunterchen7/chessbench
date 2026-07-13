"""Experimental conditions -- the ablation axes.

The research is emphatic that the "right" choice for legality handling,
representation, notation, and prompting is *model-class dependent and
contradictory*. So chessbench does not hard-code them: each is an axis of a
`Condition`, and the harness reports results per condition. This module also
owns prompt rendering, so the exact text a model sees is a function of the
condition and nothing else.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

import chess

from .core import board as board_utils


class Legality(str, Enum):
    """How illegal moves are handled -- an "OTB vs online" spectrum.

    ONLINE end (you physically cannot submit an illegal move):
      * LEGAL_LIST -- the legal moves are handed to the model; it can only pick one.
      * RETRY      -- an illegal move is rejected with feedback and re-prompted,
                      up to `retry_attempts` times (the board "won't let you").
    OTB end (you can play an illegal move, with consequences):
      * OTB        -- illegal moves are allowed but penalised; the Nth cumulative
                      illegal move in a game (`otb_illegal_limit`, default 2, per
                      FIDE rapid/blitz) forfeits.
      * FREE_FORM  -- the strictest measurement: a single illegal move fails
                      (puzzles) or forfeits (games). The headline benchmark condition.
    """

    FREE_FORM = "free_form"
    RETRY = "retry"
    LEGAL_LIST = "legal_list"
    OTB = "otb"


class Representation(str, Enum):
    FEN = "fen"
    FEN_ASCII = "fen_ascii"     # FEN + ASCII grid (hedge vs FEN tokenization)
    FEN_UNICODE = "fen_unicode"
    PIECE_LIST = "piece_list"   # explicit "White: Ke1, Qd1, ...; Black: ..." listing
    FEN_PIECES = "fen_pieces"   # FEN + the piece list together (the modes' default)
    PGN = "pgn"                 # move history as PGN/SAN (for games w/ history)


class Notation(str, Enum):
    SAN = "san"                 # model-facing default (dominant in pretraining)
    UCI = "uci"


class PromptStyle(str, Enum):
    MINIMAL = "minimal"         # headline: instructions + position, nothing else
    COT = "cot"                 # ask for reasoning then a tagged answer
    FEW_SHOT = "few_shot"       # prepend worked examples (deltas reported, not baked in)
    COACHED = "coached"         # explicit "how to think about the position" checklist


class ContextMode(str, Enum):
    """Game-track only: what the model carries between moves of a single game."""

    FRESH = "fresh"        # self-contained prompt each turn: board + FULL history. Default.
    GROWING = "growing"    # one conversation; append "opponent played X, your move".
    HYBRID = "hybrid"      # growing conversation BUT re-inject authoritative board each turn.


@dataclass(frozen=True)
class Condition:
    legality: Legality = Legality.FREE_FORM
    representation: Representation = Representation.FEN_ASCII
    notation: Notation = Notation.SAN
    prompt_style: PromptStyle = PromptStyle.MINIMAL
    context_mode: ContextMode = ContextMode.FRESH  # game-track axis
    retry_attempts: int = 3      # only used when legality == RETRY
    otb_illegal_limit: int = 2   # only used when legality == OTB (Nth illegal forfeits)
    explain: bool = False        # invite an optional natural-language explanation with the move
    temperature: float = 1.0     # models run at their native default temp; games self-diversify (no opening book needed)
    include_side_to_move: bool = True

    def slug(self) -> str:
        return "__".join(
            [self.legality.value, self.representation.value, self.notation.value, self.prompt_style.value]
        )

    def game_slug(self) -> str:
        return self.slug() + "__" + self.context_mode.value


# The scientific baseline condition (free-form, unaided) -- kept for the honest measurement.
HEADLINE = Condition()

# --- Named "how much help" modes (presets over the axes) ---
# 1: raw FEN + piece list; 2: + legal moves (SAN & UCI); 3: + coaching tips.
# The DEFAULT for CLI runs is MODE 2 ("hand-holding": the legal moves are provided).
MODES: dict[int, tuple[Legality, Representation, PromptStyle]] = {
    1: (Legality.FREE_FORM, Representation.FEN_PIECES, PromptStyle.MINIMAL),
    2: (Legality.LEGAL_LIST, Representation.FEN_PIECES, PromptStyle.MINIMAL),
    3: (Legality.LEGAL_LIST, Representation.FEN_PIECES, PromptStyle.COACHED),
}
DEFAULT_MODE = 2
MODE_LABELS = {1: "raw", 2: "assisted (legal moves)", 3: "coached (legal moves + tips)"}


def mode_condition(mode: int) -> Condition:
    """The preset Condition for a named mode (games add history via the game
    prompt automatically). Use dataclasses.replace() to layer overrides."""
    legality, representation, prompt_style = MODES[mode]
    return Condition(legality=legality, representation=representation, prompt_style=prompt_style)


def render_position(bd: chess.Board, cond: Condition, history_san: list[str] | None = None) -> str:
    parts: list[str] = []
    rep = cond.representation
    if rep in (Representation.FEN, Representation.FEN_ASCII, Representation.FEN_UNICODE, Representation.FEN_PIECES):
        parts.append(f"FEN: {bd.fen()}")
    if rep == Representation.FEN_ASCII:
        parts.append("Board (White is uppercase, `.` is empty):\n" + board_utils.render_ascii(bd))
    elif rep == Representation.FEN_UNICODE:
        parts.append("Board:\n" + board_utils.render_unicode(bd))
    elif rep == Representation.PIECE_LIST:
        parts.append("Pieces:\n" + board_utils.render_piece_list(bd))
    elif rep == Representation.FEN_PIECES:
        parts.append("Pieces:\n" + board_utils.render_piece_list(bd))
    if rep == Representation.PGN and history_san:
        moves = _san_history_to_pgn(history_san)
        parts.append(f"Game so far:\n{moves}")
    if cond.include_side_to_move:
        parts.append(f"Side to move: {'White' if bd.turn == chess.WHITE else 'Black'}")
    return "\n\n".join(parts)


def _san_history_to_pgn(history_san: list[str]) -> str:
    out: list[str] = []
    for i, san in enumerate(history_san):
        if i % 2 == 0:
            out.append(f"{i // 2 + 1}.{san}")
        else:
            out.append(san)
    return " ".join(out)


def build_puzzle_prompt(bd: chess.Board, cond: Condition, illegal_feedback: str | None = None) -> str:
    """Assemble the full user prompt for a single-position puzzle move."""
    notation_name = "SAN (e.g. Nf3, exd5, O-O)" if cond.notation == Notation.SAN else "UCI (e.g. g1f3, e5d6)"
    lines = [
        "You are a chess engine. Find the single best move for the side to move.",
        "",
        render_position(bd, cond),
    ]
    if cond.legality == Legality.LEGAL_LIST:
        lines += ["", _legal_line(bd, cond)]
    if cond.prompt_style == PromptStyle.COACHED:
        lines += ["", COACH_ADVICE]
    lines += ["", f"Reply with your move in {notation_name}."]
    if cond.prompt_style == PromptStyle.COT:
        lines += ["Think step by step, then give your final move as `answer: <move>`."]
    elif cond.explain:
        lines += ["Then, on a new line starting `why:`, add a brief explanation of your move."]
    elif cond.prompt_style == PromptStyle.MINIMAL:
        lines += ["Reply with ONLY the move, no explanation."]
    if illegal_feedback:
        lines += ["", f"Your previous answer was illegal: {illegal_feedback}. Choose a legal move."]
    return "\n".join(lines)


# --- Game track prompting ---

COACH_ADVICE = (
    "Before choosing, work through this checklist:\n"
    "1. Note where both sides' pieces are and which of yours are undefended.\n"
    "2. Look at every check, capture, and threat available to you AND your opponent.\n"
    "3. Verify your intended move is legal and does not hang a piece for free.\n"
    "4. Anticipate the opponent's best reply before committing.\n"
    "5. Favor king safety, piece activity, and material."
)


def _notation_name(cond: Condition) -> str:
    return "SAN (e.g. Nf3, exd5, O-O)" if cond.notation == Notation.SAN else "UCI (e.g. g1f3, e5d6)"


def game_system_prompt(cond: Condition, color: bool) -> str:
    """Constant per-game instructions (the system message)."""
    side = "White" if color == chess.WHITE else "Black"
    lines = [
        f"You are a strong chess player playing a full game as {side}.",
        f"On each of your turns, output a single legal move in {_notation_name(cond)}.",
    ]
    if cond.prompt_style == PromptStyle.COACHED:
        lines += ["", COACH_ADVICE]
    if cond.prompt_style == PromptStyle.COT:
        lines += ["Think briefly, then end your reply with `answer: <move>`."]
    elif cond.explain:
        lines += ["Give your move, then a brief explanation on a new line starting `why:`."]
    elif cond.prompt_style in (PromptStyle.MINIMAL, PromptStyle.FEW_SHOT):
        lines += ["Reply with ONLY your move, no commentary."]
    return "\n".join(lines)


def build_game_turn(
    bd: chess.Board,
    cond: Condition,
    *,
    history_san: list[str],
    last_opponent_move_san: str | None,
    illegal_feedback: str | None,
    is_first: bool,
) -> str:
    """Build the per-turn USER message, shaped by the context mode.

    FRESH  -> fully self-contained: authoritative board + full move history.
    GROWING-> terse: relies on the conversation for board state.
    HYBRID -> terse opponent move BUT re-injects the authoritative board.
    """
    mode = cond.context_mode
    lines: list[str] = []

    if illegal_feedback and not is_first:
        # A retry within the same turn: only feedback, whatever the mode.
        lines.append(f"That move was illegal: {illegal_feedback}. Reply with a legal move.")
        if cond.legality == Legality.LEGAL_LIST:
            lines.append(_legal_line(bd, cond))
        return "\n".join(lines)

    if mode == ContextMode.FRESH or is_first:
        lines.append(render_position(bd, cond, history_san=history_san))
        if cond.representation != Representation.PGN and history_san:
            lines.append("Moves so far: " + _san_history_to_pgn(history_san))
    else:  # GROWING / HYBRID continuation
        if last_opponent_move_san:
            lines.append(f"I played {last_opponent_move_san}.")
        if mode == ContextMode.HYBRID:
            lines.append(render_position(bd, cond, history_san=history_san))

    if cond.legality == Legality.LEGAL_LIST:
        lines.append(_legal_line(bd, cond))
    lines.append("Your move.")
    if illegal_feedback and is_first:
        lines.append(f"(Note: {illegal_feedback}.)")
    return "\n".join(lines)


def _legal_line(bd: chess.Board, cond: Condition) -> str:
    # Show every legal move in BOTH SAN and UCI, so the model can map notations.
    pairs = sorted(f"{bd.san(m)} ({m.uci()})" for m in bd.legal_moves)
    return "Legal moves [SAN (UCI)]: " + ", ".join(pairs)
