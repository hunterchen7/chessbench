"""Solvers/verifiers for composed problems and endgame studies.

Native python-chess implementations (no external Popeye/Jacobi dependency), so
grading is transparent, typed, and unit-tested against independent brute force.
"""

from __future__ import annotations

from .proofgame import verify_proofgame
from .stipulations import (
    directmate_forced,
    directmate_keys,
    helpmate_solutions,
    reflexmate_keys,
    selfmate_keys,
    verify_directmate,
    verify_helpmate_line,
    verify_reflexmate,
    verify_selfmate,
)
from .studies import StudyConfig, StudyResult, grade_study

__all__ = [
    "directmate_forced",
    "directmate_keys",
    "verify_directmate",
    "selfmate_keys",
    "verify_selfmate",
    "reflexmate_keys",
    "verify_reflexmate",
    "helpmate_solutions",
    "verify_helpmate_line",
    "verify_proofgame",
    "grade_study",
    "StudyConfig",
    "StudyResult",
]
