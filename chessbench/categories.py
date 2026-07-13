"""Categorization taxonomy for the whole benchmark.

Every puzzle/problem is tagged along a small set of *dimensions* so the web app
can filter and we can build per-category suites and leaderboards:

  * tier         -- difficulty band from the (Lichess) rating
  * phase        -- opening / middlegame / endgame (+ endgame material)
  * motif        -- tactical motif (fork, pin, skewer, ...)
  * mate_pattern -- named mating nets (backRankMate, smotheredMate, ...)
  * goal         -- mate / crushing / advantage / equality
  * length       -- oneMove / short / long / veryLong
  * genre        -- for composed problems: directmate / selfmate / helpmate / ...

Tactical puzzles get their dimensions from Lichess themes (already curated by
millions of votes); composed problems get `genre` from their stipulation kind.
"""

from __future__ import annotations

from .types import StipulationKind

# --- Difficulty tiers (rating bands) ---

DIFFICULTY_TIERS: list[tuple[str, int, int]] = [
    ("beginner", 0, 1000),
    ("novice", 1000, 1400),
    ("intermediate", 1400, 1800),
    ("advanced", 1800, 2200),
    ("expert", 2200, 2600),
    ("master", 2600, 10_000),
]


def difficulty_tier(rating: int) -> str:
    for name, lo, hi in DIFFICULTY_TIERS:
        if lo <= rating < hi:
            return name
    return "master"


# --- Theme -> dimension mapping (Lichess vocabulary) ---

_PHASE = {"opening", "middlegame", "endgame", "rookEndgame", "bishopEndgame", "pawnEndgame",
          "knightEndgame", "queenEndgame", "queenRookEndgame"}
_GOAL = {"mate", "crushing", "advantage", "equality"}
_LENGTH = {"oneMove", "short", "long", "veryLong"}
_MATE_PATTERN = {
    "anastasiaMate", "arabianMate", "backRankMate", "bodenMate", "doubleBishopMate", "dovetailMate",
    "hookMate", "killBoxMate", "smotheredMate", "vukovicMate", "cornerMate", "epauletteMate",
    "swallowstailMate", "mateIn1", "mateIn2", "mateIn3", "mateIn4", "mateIn5",
}
_MOTIF = {
    "advancedPawn", "attackingF2F7", "attraction", "capturingDefender", "clearance", "defensiveMove",
    "deflection", "discoveredAttack", "doubleCheck", "exposedKing", "fork", "hangingPiece", "interference",
    "intermezzo", "kingsideAttack", "pin", "promotion", "queensideAttack", "quietMove", "sacrifice",
    "skewer", "trappedPiece", "underPromotion", "xRayAttack", "zugzwang", "enPassant", "castling",
    "zwischenzug",
}

DIMENSIONS = ("tier", "phase", "goal", "length", "mate_pattern", "motif")


def categorize_puzzle(themes: list[str], rating: int) -> dict[str, list[str]]:
    """Bucket a puzzle's themes into dimensions and add its difficulty tier."""
    buckets: dict[str, list[str]] = {d: [] for d in DIMENSIONS}
    buckets["tier"] = [difficulty_tier(rating)]
    for theme in themes:
        if theme in _PHASE:
            buckets["phase"].append(theme)
        elif theme in _GOAL:
            buckets["goal"].append(theme)
        elif theme in _LENGTH:
            buckets["length"].append(theme)
        elif theme in _MATE_PATTERN:
            buckets["mate_pattern"].append(theme)
        elif theme in _MOTIF:
            buckets["motif"].append(theme)
    return {d: v for d, v in buckets.items() if v}


# --- Composed problems ---

_GENRE_LABEL: dict[StipulationKind, str] = {
    "directmate": "directmate",
    "selfmate": "selfmate",
    "reflexmate": "reflexmate",
    "helpmate": "helpmate",
    "series_helpmate": "series",
    "series_directmate": "series",
    "proofgame": "retrograde",
    "study": "study",
}


def categorize_composed(kind: StipulationKind) -> dict[str, list[str]]:
    return {"genre": [_GENRE_LABEL[kind]], "family": ["composed"]}
