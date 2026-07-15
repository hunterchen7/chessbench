"""Experimental conditions -- the ablation axes.

The research is emphatic that the "right" choice for legality handling,
representation, notation, and prompting is *model-class dependent and
contradictory*. So chessbench does not hard-code them: each is an axis of a
`Condition`, and the harness reports results per condition. This module also
owns prompt rendering, so the exact text a model sees is a function of the
condition and nothing else.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from enum import Enum

import chess

from .core import board as board_utils
from .response_protocols import ResponseProtocol


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
    FEN_ASCII = "fen_ascii"  # FEN + ASCII grid (hedge vs FEN tokenization)
    FEN_UNICODE = "fen_unicode"
    PIECE_LIST = "piece_list"  # explicit "White: Ke1, Qd1, ...; Black: ..." listing
    FEN_PIECES = "fen_pieces"  # FEN + the piece list together (the modes' default)
    PGN = "pgn"  # move history as PGN/SAN (for games w/ history)


class Notation(str, Enum):
    SAN = "san"  # model-facing default (dominant in pretraining)
    UCI = "uci"


class PromptStyle(str, Enum):
    MINIMAL = "minimal"  # headline: instructions + position, nothing else
    COT = "cot"  # ask for reasoning then a tagged answer
    FEW_SHOT = "few_shot"  # prepend worked examples (deltas reported, not baked in)
    COACHED = "coached"  # explicit "how to think about the position" checklist


class ContextMode(str, Enum):
    """Game-track only: what the model carries between moves of a single game."""

    FRESH = "fresh"  # self-contained prompt each turn: board + FULL history. Default.
    GROWING = "growing"  # one conversation; append "opponent played X, your move".
    HYBRID = (
        "hybrid"  # growing conversation BUT re-inject authoritative board each turn.
    )


class PuzzleProtocol(str, Enum):
    """How a tactical puzzle answer is elicited and graded.

    ``MOVE_BY_MOVE`` mirrors normal online puzzle solving: ask for one solver
    move, apply the forced reply, then ask again. ``FULL_LINE`` is the
    Woodpecker-style recall/calculation condition: one request must contain the
    complete variation, including the opponent's replies.
    """

    MOVE_BY_MOVE = "move_by_move"
    FULL_LINE = "full_line"


@dataclass(frozen=True)
class Condition:
    legality: Legality = Legality.FREE_FORM
    representation: Representation = Representation.FEN_ASCII
    notation: Notation = Notation.UCI
    prompt_style: PromptStyle = PromptStyle.MINIMAL
    context_mode: ContextMode = (
        ContextMode.HYBRID
    )  # stateful chat + authoritative board each turn
    puzzle_protocol: PuzzleProtocol = PuzzleProtocol.MOVE_BY_MOVE
    retry_attempts: int = 3  # only used when legality == RETRY
    otb_illegal_limit: int = 2  # only used when legality == OTB (Nth illegal forfeits)
    # The canonical benchmark response is structured JSON with a visible rationale.
    # ``False`` remains available as a legacy/output-protocol ablation.
    explain: bool = True
    response_protocol: ResponseProtocol = ResponseProtocol.JSON_SCHEMA_V1
    temperature: float = 1.0  # models run at their native default temp; games self-diversify (no opening book needed)
    include_side_to_move: bool = True
    reasoning_effort: str | None = (
        None  # OpenRouter normalized effort, including minimal/max/xhigh/none
    )
    reasoning_max_tokens: int | None = (
        None  # exact thinking-token budget; mutually exclusive with effort
    )
    max_output_tokens: int = 2048

    def __post_init__(self) -> None:
        if self.reasoning_effort is not None and self.reasoning_max_tokens is not None:
            raise ValueError(
                "reasoning_effort and reasoning_max_tokens are mutually exclusive"
            )
        if self.reasoning_max_tokens is not None and self.reasoning_max_tokens <= 0:
            raise ValueError("reasoning_max_tokens must be positive")
        if self.max_output_tokens <= 0:
            raise ValueError("max_output_tokens must be positive")

    def slug(self) -> str:
        base = self._base_slug()
        if self.puzzle_protocol == PuzzleProtocol.FULL_LINE:
            base += "__full-line"
        else:
            base += f"__pctx-{self.context_mode.value}"
        return self._reasoning_slug(base)

    def _base_slug(self) -> str:
        parts = [
            self.legality.value,
            self.representation.value,
            self.notation.value,
            self.prompt_style.value,
        ]
        if self.explain:
            parts.append("json-rationale")
            parts.append(self.response_protocol.value.replace("_", "-"))
        else:
            parts.append("plain-text-v1")
        return "__".join(parts)

    def _reasoning_slug(self, base: str) -> str:
        if self.reasoning_effort is not None:
            base += f"__reason-{self.reasoning_effort}"
        elif self.reasoning_max_tokens is not None:
            base += f"__reason-{self.reasoning_max_tokens}t"
        return base

    def game_slug(self) -> str:
        return self._reasoning_slug(self._base_slug() + "__" + self.context_mode.value)

    def to_dict(self) -> dict[str, object]:
        """Canonical, JSON-safe condition manifest used in run identities."""
        return {
            "legality": self.legality.value,
            "representation": self.representation.value,
            "notation": self.notation.value,
            "prompt_style": self.prompt_style.value,
            "context_mode": self.context_mode.value,
            "puzzle_protocol": self.puzzle_protocol.value,
            "retry_attempts": self.retry_attempts,
            "otb_illegal_limit": self.otb_illegal_limit,
            "explain": self.explain,
            "response_protocol": (
                self.response_protocol.value if self.explain else "plain_text_v1"
            ),
            "temperature": self.temperature,
            "include_side_to_move": self.include_side_to_move,
            "reasoning_effort": self.reasoning_effort,
            "reasoning_max_tokens": self.reasoning_max_tokens,
            "max_output_tokens": self.max_output_tokens,
            "slug": self.slug(),
        }


# The scientific baseline condition (free-form, unaided) -- kept for the honest measurement.
HEADLINE = Condition()

# --- Named "how much help" modes (presets over the axes) ---
# 1: raw FEN + piece list; 2: + legal moves (SAN & UCI); 3: + coaching tips.
# The DEFAULT for CLI runs is MODE 2 ("hand-holding": the legal moves are provided).
MODES: dict[int, tuple[Legality, Representation, PromptStyle, PuzzleProtocol]] = {
    1: (
        Legality.FREE_FORM,
        Representation.FEN_PIECES,
        PromptStyle.MINIMAL,
        PuzzleProtocol.MOVE_BY_MOVE,
    ),
    2: (
        Legality.LEGAL_LIST,
        Representation.FEN_PIECES,
        PromptStyle.MINIMAL,
        PuzzleProtocol.MOVE_BY_MOVE,
    ),
    3: (
        Legality.LEGAL_LIST,
        Representation.FEN_PIECES,
        PromptStyle.COACHED,
        PuzzleProtocol.MOVE_BY_MOVE,
    ),
    4: (
        Legality.LEGAL_LIST,
        Representation.FEN_PIECES,
        PromptStyle.COACHED,
        PuzzleProtocol.FULL_LINE,
    ),
}
DEFAULT_MODE = 2
MODE_LABELS = {
    1: "raw",
    2: "assisted (legal moves)",
    3: "coached (legal moves + tips)",
    4: "full line (Woodpecker)",
}


def mode_condition(mode: int) -> Condition:
    """The preset Condition for a named mode (games add history via the game
    prompt automatically). Use dataclasses.replace() to layer overrides."""
    legality, representation, prompt_style, puzzle_protocol = MODES[mode]
    return Condition(
        legality=legality,
        representation=representation,
        prompt_style=prompt_style,
        puzzle_protocol=puzzle_protocol,
    )


def render_position(
    bd: chess.Board, cond: Condition, history_san: list[str] | None = None
) -> str:
    parts: list[str] = []
    rep = cond.representation
    if rep in (
        Representation.FEN,
        Representation.FEN_ASCII,
        Representation.FEN_UNICODE,
        Representation.FEN_PIECES,
    ):
        parts.append(f"FEN: {bd.fen()}")
    if rep == Representation.FEN_ASCII:
        parts.append(
            "Board (White is uppercase, `.` is empty):\n" + board_utils.render_ascii(bd)
        )
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


def build_puzzle_prompt(
    bd: chess.Board,
    cond: Condition,
    illegal_feedback: str | None = None,
    history_san: list[str] | None = None,
) -> str:
    """Assemble the full user prompt for a single-position puzzle move."""
    lines = [
        "You are solving a chess puzzle. Choose the single best move for the side to move.",
        "",
        render_position(bd, cond),
    ]
    if cond.legality == Legality.LEGAL_LIST:
        lines += ["", _legal_line(bd, cond)]
    if history_san:
        lines += [
            "",
            "Moves already played in this puzzle: " + _san_history_to_pgn(history_san),
        ]
    if cond.prompt_style == PromptStyle.COACHED:
        lines += ["", COACH_ADVICE]
    if cond.puzzle_protocol == PuzzleProtocol.FULL_LINE:
        lines += [
            "",
            "Calculate the complete solution now, including the opponent's forced replies.",
        ]
        if cond.explain:
            lines += ["", _json_line_instruction()]
        else:
            lines += [
                f"Reply with every move in order in {_notation_name(cond)}, starting with `line:`."
            ]
    else:
        lines += [
            "",
            _json_move_instruction()
            if cond.explain
            else f"Reply with your move in {_notation_name(cond)}.",
        ]
    if cond.prompt_style == PromptStyle.COT:
        lines += [
            "Think through the position carefully before producing the requested JSON."
        ]
    elif (
        not cond.explain
        and cond.prompt_style == PromptStyle.MINIMAL
        and cond.puzzle_protocol == PuzzleProtocol.MOVE_BY_MOVE
    ):
        lines += ["Reply with ONLY the move, no explanation."]
    if illegal_feedback:
        lines += [
            "",
            f"Your previous answer was illegal: {illegal_feedback}. Choose a legal move.",
        ]
    return "\n".join(lines)


# --- Game track prompting ---

_DEFAULT_COACH = (
    "As you analyze the position, consider the following. These are useful considerations, "
    "not a mandatory sequence or an exhaustive checklist:\n"
    "- The side to move, checks, material balance, king safety, immediate threats, and loose or "
    "inadequately defended pieces.\n"
    "- Checks, captures, promotions, and direct threats. These are often useful to examine early, "
    "but a forcing move is not necessarily best.\n"
    "- Defensive resources, quiet threats, sacrifices, zwischenzugs, pawn breaks, improving moves, "
    "prophylaxis, waiting moves, and possible zugzwang.\n"
    "- Every legal move when the position has few alternatives or appears to depend on a precise quiet move.\n"
    "- The opponent's strongest defense, including counterchecks, intermediate moves, tactical "
    "refutations, move-order changes, and unexpected defensive resources.\n"
    "- Tactical features such as pins, overloaded or removed defenders, discovered attacks, mating "
    "nets, perpetual checks, stalemate, and promotion.\n"
    "- Whether each important line has been followed far enough for its consequences to become clear. "
    "Winning material may not end the calculation.\n"
    "- Resulting positions in terms of forced outcomes, material, king safety, activity, pawn structure, "
    "passed pawns, space, and long-term threats.\n"
    "- In a puzzle, whether the move begins a forced solution against every defense rather than being "
    "merely advantageous.\n"
    "- A final legality and blunder check from the opponent's perspective."
)
# The coaching block can be overridden per-process (e.g. for prompt A/B experiments)
# via the CHESSBENCH_COACH env var, without touching the code.
COACH_ADVICE = os.environ.get("CHESSBENCH_COACH", _DEFAULT_COACH)


def _notation_name(cond: Condition) -> str:
    return (
        "SAN (e.g. Nf3, exd5, O-O)"
        if cond.notation == Notation.SAN
        else "UCI (e.g. g1f3, e5d6)"
    )


def _json_move_instruction() -> str:
    return (
        "Return exactly one JSON object with no Markdown or additional text, using this shape:\n"
        '{"move":"e2e4","rationale":"A concise explanation of why the move is best."}\n'
        "`move` must be exactly one legal move in lowercase UCI coordinate notation. Valid UCI examples: "
        "`e2e4`, `g1f3`, `e7e8q`. Do not use SAN such as `e4`, `Nf3`, `Qh4+`, or `O-O`. Do not wrap the "
        "object in a Markdown code fence. `rationale` should briefly identify the important "
        "features of the position, why the move works against the opponent's strongest response, and any "
        "important tactical or strategic idea. Mention alternatives only when relevant; preferably stay "
        "under 150 words."
    )


def _json_line_instruction() -> str:
    return (
        "Return exactly one JSON object with no Markdown or additional text, using this shape:\n"
        '{"moves":["e2e4","e7e5","g1f3"],"rationale":"A concise explanation of the forced sequence."}\n'
        "Every entry in `moves` must use lowercase UCI coordinate notation. Valid UCI examples: `e2e4`, "
        "`g1f3`, `e7e8q`. Do not use SAN such as `e4`, `Nf3`, `Qh4+`, or `O-O`, and do not wrap the object "
        "in a Markdown code fence. `moves` must contain the complete variation in legal play order, including "
        "the opponent's replies. "
        "`rationale` should briefly explain why the sequence is forced against the strongest defense; "
        "preferably stay under 150 words."
    )


def game_system_prompt(cond: Condition, color: bool) -> str:
    """Constant per-game instructions (the system message)."""
    side = "White" if color == chess.WHITE else "Black"
    lines = [
        f"You are playing a chess game as {side}.",
        "On each of your turns, choose a single legal move.",
    ]
    if cond.prompt_style == PromptStyle.COACHED:
        lines += ["", COACH_ADVICE]
    if cond.prompt_style == PromptStyle.COT:
        lines += [
            "Think through the position carefully before producing the requested response."
        ]
    if cond.explain:
        lines += ["", _json_move_instruction()]
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
        lines.append(
            f"That move was illegal: {illegal_feedback}. Reply with a legal move."
        )
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
