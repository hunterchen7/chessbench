"""Stockfish wrapper: a tunable opponent and a centipawn oracle.

Two roles, per the design:
  1. Opponent  -> `best_move` at a fixed *node limit* (hardware-independent,
     reproducible strength) or a configured UCI_Elo.
  2. Evaluator -> `evaluate` returns a side-to-move centipawn score used to
     label move quality (Win%/Accuracy%/blunder) via metrics.py.

Pin the engine version + node limit when publishing numbers; "best move" and the
centipawn scale drift across Stockfish versions.
"""

from __future__ import annotations

import shutil
from dataclasses import dataclass

import chess
import chess.engine

# Mate scores are capped to a large centipawn value so Win%/ACPL math stays finite.
MATE_CP = 10_000


def find_stockfish() -> str | None:
    return shutil.which("stockfish")


@dataclass
class EngineConfig:
    path: str | None = None
    nodes: int | None = 1_000_000  # reproducible strength knob (preferred)
    depth: int | None = None       # alternative to nodes
    movetime: float | None = None  # seconds; hardware-dependent, avoid for scoring
    uci_elo: int | None = None     # if set, plays as a ~uci_elo opponent (min 1320)
    skill_level: int | None = None # 0..20 alternative strength knob
    threads: int = 1
    hash_mb: int = 64

    def limit(self) -> chess.engine.Limit:
        return chess.engine.Limit(nodes=self.nodes, depth=self.depth, time=self.movetime)


class Engine:
    """Context-managed Stockfish handle. Always closes the subprocess."""

    def __init__(self, config: EngineConfig | None = None):
        self.config = config or EngineConfig()
        path = self.config.path or find_stockfish()
        if not path:
            raise FileNotFoundError(
                "Stockfish not found on PATH. Install it (brew install stockfish) "
                "or pass EngineConfig(path=...)."
            )
        self.path = path
        self._engine: chess.engine.SimpleEngine | None = None

    def __enter__(self) -> "Engine":
        self._engine = chess.engine.SimpleEngine.popen_uci(self.path)
        opts: dict = {"Threads": self.config.threads, "Hash": self.config.hash_mb}
        if self.config.uci_elo is not None:
            opts["UCI_LimitStrength"] = True
            opts["UCI_Elo"] = max(1320, self.config.uci_elo)
        if self.config.skill_level is not None:
            opts["Skill Level"] = self.config.skill_level
        # Only set options the engine actually advertises.
        self._engine.configure({k: v for k, v in opts.items() if k in self._engine.options})
        return self

    def __exit__(self, *exc) -> None:
        if self._engine is not None:
            self._engine.quit()
            self._engine = None

    @property
    def engine(self) -> chess.engine.SimpleEngine:
        if self._engine is None:
            raise RuntimeError("Engine used outside its context manager.")
        return self._engine

    def best_move(self, board: chess.Board) -> chess.Move:
        result = self.engine.play(board, self.config.limit())
        assert result.move is not None
        return result.move

    def evaluate(self, board: chess.Board) -> int:
        """Centipawn score from the side-to-move POV (mate -> +/-MATE_CP)."""
        info = self.engine.analyse(board, self.config.limit())
        score = info["score"].pov(board.turn)
        return score.score(mate_score=MATE_CP)
