"""Shared typed vocabulary for chessbench.

Centralizing these aliases keeps signatures precise across the codebase and lets
us avoid ``Any``. Literal types double as the single source of truth for the
string values that appear in reports and on the CLI.
"""

from __future__ import annotations

from typing import Literal, TypedDict

import chess

# --- Chess primitives (python-chess models Color as a bool: True = White) ---

Color = chess.Color  # bool; chess.WHITE / chess.BLACK
Square = chess.Square  # int 0..63

# --- LLM messaging ---

Role = Literal["system", "user", "assistant"]


class Message(TypedDict):
    """One chat message. Providers translate this to their own wire format."""

    role: Role
    content: str


# --- Game outcomes ---

GameResult = Literal["1-0", "0-1", "1/2-1/2"]

Termination = Literal[
    "checkmate",
    "stalemate",
    "insufficient_material",
    "repetition",
    "fifty_moves",
    "move_cap",
    "illegal_forfeit",
    "unknown",
]

# --- Puzzle grading ---

PuzzleFailure = Literal["illegal", "wrong_move"]

# --- Composed-problem stipulations ---
# Directmate #n, selfmate s#n, helpmate h#n, reflexmate r#n, series-helpmate
# ser-h#n, series-directmate ser-#n, proof game (reach a target in n moves), and
# endgame studies (win/draw vs best defense).

StipulationKind = Literal[
    "directmate",
    "selfmate",
    "helpmate",
    "reflexmate",
    "series_helpmate",
    "series_directmate",
    "proofgame",
    "study",
]

StudyGoal = Literal["win", "draw"]

# How a composed problem's answer is supplied by the solver/model:
#   "key"  -> a single first move (directmate/selfmate/reflexmate)
#   "line" -> a full move sequence (helpmate/series/proofgame)
#   "play" -> interactive play vs a defender (study)
AnswerShape = Literal["key", "line", "play"]

# --- Benchmark suites (frozen, versioned item sets) ---

# public  -> committed & shareable; reproducible but at contamination/gaming risk
# private -> held out (gitignored); the trusted, contamination-free measurement
Visibility = Literal["public", "private"]
SuiteKind = Literal["puzzle", "composed"]
