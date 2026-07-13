"""chessbench -- a chess benchmarking suite for LLMs.

Two pillars (puzzle track shipped; game + composed tracks planned):
  * Puzzles of varying difficulty, including (future) esoteric composed problems.
  * LLMs playing full games against each other and an engine ladder.

The public surface is intentionally small; import submodules directly for detail.
"""

from __future__ import annotations

from .conditions import (
    HEADLINE,
    Condition,
    ContextMode,
    Legality,
    Notation,
    PromptStyle,
    Representation,
)

__all__ = [
    "Condition",
    "ContextMode",
    "HEADLINE",
    "Legality",
    "Notation",
    "PromptStyle",
    "Representation",
]

__version__ = "0.1.0"
