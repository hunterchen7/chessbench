"""Versioned access to the large Lichess-style adaptive puzzle pool."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from .sources.lichess import iter_lichess_puzzles
from .tasks.puzzles import Puzzle


@dataclass(frozen=True)
class RatedPoolBand:
    low: int
    high: int
    target: int
    minimum_plays: int
    maximum_rating_deviation: int
    minimum_popularity: int

    def accepts(self, puzzle: Puzzle) -> bool:
        return (
            self.low <= puzzle.rating < self.high
            and puzzle.nb_plays >= self.minimum_plays
            and puzzle.rating_deviation <= self.maximum_rating_deviation
            and puzzle.popularity >= self.minimum_popularity
            and puzzle.num_solver_plies() >= 1
            and bool(puzzle.game_url)
        )


# The dense middle uses the strongest gate. Only the sparse extremes relax it,
# and the exact exception is visible in the release manifest and dashboard.
RATED_LICHESS_V1_BANDS = (
    RatedPoolBand(400, 600, 3_000, 750, 100, 85),
    RatedPoolBand(600, 800, 5_000, 1_000, 90, 80),
    RatedPoolBand(800, 1_000, 9_500, 1_000, 90, 80),
    RatedPoolBand(1_000, 1_200, 9_500, 1_000, 90, 80),
    RatedPoolBand(1_200, 1_400, 9_500, 1_000, 90, 80),
    RatedPoolBand(1_400, 1_600, 9_500, 1_000, 90, 80),
    RatedPoolBand(1_600, 1_800, 9_500, 1_000, 90, 80),
    RatedPoolBand(1_800, 2_000, 9_500, 1_000, 90, 80),
    RatedPoolBand(2_000, 2_200, 9_500, 1_000, 90, 80),
    RatedPoolBand(2_200, 2_400, 9_500, 1_000, 90, 80),
    RatedPoolBand(2_400, 2_600, 9_500, 1_000, 90, 80),
    RatedPoolBand(2_600, 2_800, 4_000, 1_000, 90, 80),
    RatedPoolBand(2_800, 3_000, 2_100, 500, 120, 80),
    RatedPoolBand(3_000, 3_200, 400, 500, 120, 80),
)


def rated_pool_band(rating: int) -> RatedPoolBand | None:
    return next(
        (band for band in RATED_LICHESS_V1_BANDS if band.low <= rating < band.high),
        None,
    )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_rated_pool_manifest(
    path: str | Path,
    *,
    verify_artifact: bool = True,
) -> dict[str, object]:
    """Load a rated-pool manifest and optionally verify its compressed artifact."""
    manifest_path = Path(path)
    document = json.loads(manifest_path.read_text(encoding="utf-8"))
    if document.get("schema") != "chessbench.rated_puzzle_pool.v1":
        raise ValueError("unexpected rated puzzle pool schema")
    artifact = document.get("artifact")
    if not isinstance(artifact, dict) or not artifact.get("file"):
        raise ValueError("rated puzzle pool manifest has no artifact")
    artifact_path = manifest_path.parent / str(artifact["file"])
    if not artifact_path.is_file():
        raise ValueError(f"rated puzzle pool artifact is missing: {artifact_path}")
    if verify_artifact:
        actual = _sha256(artifact_path)
        expected = artifact.get("sha256")
        if actual != expected:
            raise ValueError(
                f"rated puzzle pool artifact hash mismatch ({actual} != {expected})"
            )
    return document


def iter_rated_pool(
    manifest_path: str | Path,
    *,
    verify_artifact: bool = True,
) -> Iterator[Puzzle]:
    """Stream puzzles from the compressed, content-addressed pool artifact."""
    path = Path(manifest_path)
    document = load_rated_pool_manifest(path, verify_artifact=verify_artifact)
    artifact = document["artifact"]
    assert isinstance(artifact, dict)
    yield from iter_lichess_puzzles(path.parent / str(artifact["file"]))
