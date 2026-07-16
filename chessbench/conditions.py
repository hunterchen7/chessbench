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
    SAN = "san"  # non-canonical diagnostic output notation
    UCI = "uci"


class PromptStyle(str, Enum):
    MINIMAL = "minimal"  # headline: instructions + position, nothing else
    COT = "cot"  # ask for reasoning then a tagged answer
    FEW_SHOT = "few_shot"  # prepend worked examples (deltas reported, not baked in)
    COACHED = "coached"  # explicit "how to think about the position" checklist
    DEEP_COACHED = "deep_coached"  # long-form calculation and blunder-check process


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


class CachePolicy(str, Enum):
    """Provider compute reuse; never caches or replays model responses."""

    DISABLED = "disabled"
    PROMPT_PREFIX_V1 = "prompt_prefix_v1"


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
    # Capture provider-supplied thinking separately from the scored visible answer.
    reasoning_exclude: bool = True
    # Zero means ChessBench omits max_tokens and uses the provider/model limit.
    # Numeric caps remain available as an explicit output-budget ablation.
    max_output_tokens: int = 0
    cache_policy: CachePolicy = CachePolicy.PROMPT_PREFIX_V1
    # Prompt text is part of result identity. This version introduced UCI-only
    # legal candidate lists and UCI within-puzzle move history.
    prompt_version: str = "uci_candidates_v1"

    def __post_init__(self) -> None:
        if self.prompt_style == PromptStyle.DEEP_COACHED:
            if self.prompt_version == "uci_candidates_v1":
                object.__setattr__(self, "prompt_version", "deep_coach_v1")
            elif self.prompt_version != "deep_coach_v1":
                raise ValueError(
                    "deep_coached currently requires prompt_version=deep_coach_v1"
                )
        if self.reasoning_effort is not None and self.reasoning_max_tokens is not None:
            raise ValueError(
                "reasoning_effort and reasoning_max_tokens are mutually exclusive"
            )
        if self.reasoning_max_tokens is not None and self.reasoning_max_tokens <= 0:
            raise ValueError("reasoning_max_tokens must be positive")
        if self.max_output_tokens < 0:
            raise ValueError("max_output_tokens must be non-negative")
        if not self.prompt_version:
            raise ValueError("prompt_version must not be empty")

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
            f"prompt-{self.prompt_version.replace('_', '-')}",
            f"cache-{self.cache_policy.value.replace('_', '-')}",
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
        if not self.reasoning_exclude:
            base += "__reasoning-captured"
        return base

    def game_slug(self) -> str:
        return self._reasoning_slug(self._base_slug() + "__" + self.context_mode.value)

    def to_dict(self) -> dict[str, object]:
        """Canonical, JSON-safe condition manifest used in run identities."""
        manifest: dict[str, object] = {
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
            "cache_policy": self.cache_policy.value,
            "prompt_version": self.prompt_version,
            "slug": self.slug(),
        }
        # Preserve historical run identities: hidden reasoning was the original
        # default and needs no extra manifest field.
        if not self.reasoning_exclude:
            manifest["reasoning_exclude"] = False
        return manifest


# The scientific baseline condition (free-form, unaided) -- kept for the honest measurement.
HEADLINE = Condition()

# Constant per-puzzle system message for stateful Standard sessions. Keeping it
# beside the prompt builders lets the web prompt catalog use the literal harness
# text rather than duplicating it.
PUZZLE_SYSTEM_PROMPT = (
    "You are solving one chess puzzle across several turns. Keep track of the line, but "
    "trust each newly supplied position as authoritative."
)

# --- Named "how much help" modes (presets over the axes) ---
# 1: raw FEN + piece list; 2: + legal moves (UCI only); 3: + concise coaching;
# 4 remains the Woodpecker full-line protocol; 5 adds long-form coaching.
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
    5: (
        Legality.LEGAL_LIST,
        Representation.FEN_PIECES,
        PromptStyle.DEEP_COACHED,
        PuzzleProtocol.MOVE_BY_MOVE,
    ),
}
DEFAULT_MODE = 2
MODE_LABELS = {
    1: "raw",
    2: "assisted (legal moves)",
    3: "coached (legal moves + tips)",
    4: "full line (Woodpecker)",
    5: "deep coached (legal moves + calculation process)",
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
    history_uci: list[str] | None = None,
) -> str:
    """Assemble the full user prompt for a single-position puzzle move."""
    lines = [
        "You are solving a chess puzzle. Choose the single best move for the side to move.",
        "",
        render_position(bd, cond),
    ]
    if cond.legality == Legality.LEGAL_LIST:
        lines += ["", _legal_line(bd, cond)]
    if history_uci:
        lines += [
            "",
            "Moves already played in this puzzle [UCI]: " + " ".join(history_uci),
        ]
    coaching = coaching_advice(cond)
    if coaching:
        lines += ["", coaching]
    if cond.puzzle_protocol == PuzzleProtocol.FULL_LINE:
        lines += [
            "",
            "Calculate the complete solution now, including the opponent's forced replies.",
        ]
        if cond.explain:
            lines += ["", _json_line_instruction()]
        else:
            lines += [
                f"Reply with every move in order in {_notation_name(cond)}, starting with `line:`. "
                "Include no explanation or other text."
            ]
    else:
        lines += [
            "",
            _json_move_instruction()
            if cond.explain
            else f"Reply with ONLY your move in {_notation_name(cond)}, no explanation or other text.",
        ]
    if cond.prompt_style == PromptStyle.COT:
        lines += [
            "Think through the position carefully before producing the requested JSON."
        ]
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


# This text is deliberately versioned and immutable. Editing it requires a new
# prompt_version so completed cells cannot silently pool across prompt changes.
DEEP_COACH_ADVICE_V1 = """Use the following as a disciplined lens for calculation, not as a rigid checklist. Adapt the depth and order to the position. Your task is still to choose the best move; do not assume that the most forcing-looking move is correct.

First orient yourself precisely. Confirm the side to move, whether either king is in check or exposed, and what the last move or preceding puzzle moves changed. Reconstruct the location and role of every relevant piece from the supplied position. Count material, but also note piece activity, trapped pieces, loose pieces, overloaded defenders, pinned pieces, weak back ranks, advanced passed pawns, promotion threats, and squares that are defended only once. Before searching for your own idea, ask what the opponent threatens right now. If you made a neutral move, what check, capture, mating idea, promotion, or positional transformation would they choose?

Generate a small but serious set of candidate moves. Examine legal checks, captures, promotions, and direct threats early because they constrain the reply, but do not automatically prefer them. Include quiet moves when they improve a piece, remove a defender, create zugzwang, prepare a pawn break, make prophylaxis, or threaten something the opponent cannot meet. In sparse positions or positions that appear to hinge on a precise move, widen the search and compare every plausible legal alternative. A familiar pattern is a clue, not proof: verify that the exact geometry, move order, and defenders in this position make it work.

For each candidate, calculate the opponent's strongest reply rather than the reply you hope to see. Treat the opponent as resourceful and actively trying to refute you. Start with their forcing options: counterchecks, captures, promotions, mating threats, intermediate moves, and attacks on your queen or king. Then look for defensive resources such as declining a sacrifice, returning material, exchanging the attacking piece, interposing, evacuating a threatened piece, creating luft, pinning a key attacker, perpetual check, fortress, stalemate, or a move-order change. An attack is sound only if it survives the best defense, not merely the natural defense.

Be especially careful with captures. Never stop at “I take that piece” or “I win the queen.” Assume the opponent may capture back and explicitly identify every legal recapture: by pawn, piece, king, or a different piece along a newly opened line. After the apparent recapture, check whether either side has an intermediate check, zwischenzug, discovered attack, promotion, or stronger capture before completing the exchange. Recount the full material balance only after the sequence has settled. Verify whether the capturing piece is protected, whether a defender is pinned or overloaded, whether moving it exposes your king or another valuable piece, and whether an apparently free target is bait. If your move places a piece on a square the opponent can capture, prove why that capture fails; do not merely assume it is poisoned.

Carry critical variations far enough to reach a quiet or otherwise stable position. Do not end a line at the first attractive event, such as winning material, giving check, or reaching an apparently winning attack. Continue through forced recaptures, counterchecks, and tactical clean-up until the consequences can be compared reliably. When several move orders reach similar positions, check whether one order gives the opponent an extra tempo, escape square, intermezzo, or defensive exchange. Keep the board visualization synchronized after every ply: remove captured pieces, update opened and closed lines, move both pieces during castling, handle en passant correctly, and replace a promoted pawn with the chosen piece.

At the stable endpoint of each serious line, compare concrete outcomes before general impressions. Check for forced mate, perpetual check, stalemate, insufficient material, promotion, decisive material gain, or an unavoidable tactical loss. If none decides the position, compare king safety, piece activity, coordination, pawn structure, passed pawns, weak squares, space, and whose threats arrive first. Prefer a smaller secure advantage over a spectacular line that depends on cooperation. Conversely, do not reject a sound sacrifice merely because the immediate material count is unfavorable if the follow-up is forced and sufficient.

In defensive positions, search for active resistance. Consider counterchecks, forcing exchanges, interference, deflection, counter-sacrifices, perpetual-check mechanisms, stalemate tricks, and returning material to eliminate the attack. When solving a puzzle, the key move must begin the intended forcing solution against every relevant defense; a move that is generally strong but allows one escape is not enough. Also consider that the best move may be a quiet retreat, prophylactic move, or only move that prevents the opponent's threat.

Treat endgames concretely. Recalculate king distances, opposition, corresponding squares, pawn races, breakthrough ideas, reserve tempi, zugzwang, and whether a rook belongs behind a passed pawn. Count promotion tempi one move at a time and include checks that gain tempo. Verify whether the promoted piece can be captured, whether promotion gives check, whether underpromotion matters, and whether simplifying enters a theoretically drawn fortress or an unwinnable material configuration. In queen and rook endings, test perpetual checks and back-rank tactics before trusting a material advantage.

Before committing, perform a final opponent-perspective blunder audit on the exact candidate move. Confirm that it is legal and does not leave your own king in check. Then ask: can the opponent check me, mate me, capture the moved piece, capture something the move stopped defending, recapture what I just took, insert a stronger intermediate move, promote, trap my queen, or force perpetual or stalemate? Re-scan all newly opened ranks, files, diagonals, and discovered attacks from both sides. Finally compare the candidate once more with the strongest alternative. Only then return the move in the requested format."""


def coaching_advice(cond: Condition) -> str | None:
    """Return the fixed coaching text selected by this condition."""
    if cond.prompt_style == PromptStyle.COACHED:
        return COACH_ADVICE
    if cond.prompt_style == PromptStyle.DEEP_COACHED:
        return DEEP_COACH_ADVICE_V1
    return None


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
        "`move` must be exactly one legal move in lowercase UCI coordinate notation. Valid examples: "
        "`e2e4`, `g1f3`, `e7e8q`. Do not use SAN or any other notation. Do not wrap the "
        "object in a Markdown code fence. `rationale` should briefly identify the important "
        "features of the position, why the move works against the opponent's strongest response, and any "
        "important tactical or strategic idea. Mention alternatives only when relevant; preferably stay "
        "under 150 words."
    )


def _json_line_instruction() -> str:
    return (
        "Return exactly one JSON object with no Markdown or additional text, using this shape:\n"
        '{"moves":["e2e4","e7e5","g1f3"],"rationale":"A concise explanation of the forced sequence."}\n'
        "Every entry in `moves` must use lowercase UCI coordinate notation. Valid examples: `e2e4`, "
        "`g1f3`, `e7e8q`. Do not use SAN or any other notation, and do not wrap the object "
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
    coaching = coaching_advice(cond)
    if coaching:
        lines += ["", coaching]
    if cond.prompt_style == PromptStyle.COT:
        lines += [
            "Think through the position carefully before producing the requested response."
        ]
    if cond.explain:
        lines += ["", _json_move_instruction()]
    else:
        lines += [
            f"Reply with ONLY your move in {_notation_name(cond)}, no explanation or other text."
        ]
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
    del cond  # Candidate notation is deliberately invariant across conditions.
    # SAN suffixes leak tactical labels: '+' identifies checks and '#' identifies
    # checkmates. Candidate lists therefore use unannotated UCI coordinates only.
    moves = sorted(m.uci() for m in bd.legal_moves)
    return "Legal moves [UCI]: " + ", ".join(moves)
