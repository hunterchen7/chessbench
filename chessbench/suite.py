"""Frozen, versioned benchmark suites.

A *suite* pins an exact set of items so that **every model is scored on identical
puzzles** -- the prerequisite for a comparable leaderboard. Each suite embeds its
items (self-contained), records how it was built, and carries a content hash so a
run can assert it evaluated the intended set.

Public vs private (the held-out split):
  * a **public** suite is committed and shareable -- reproducible, but its items
    may leak into training data or be gamed;
  * a **private** suite is held out (kept out of the public repo) -- the trusted,
    contamination-free score. Our Stockfish generator (`tasks/generate.py`) makes
    fresh, never-published positions ideal for private suites.

Ratings: public suites should be sourced from Lichess, whose Glicko-2 ratings are
calibrated from millions of human solves -- trustworthy difficulty. Generated
(private) puzzles carry only heuristic ratings; see `calibrate` for closing that
gap with an engine ladder.
"""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from pathlib import Path
from random import Random

from .tasks.composed import ComposedProblem
from .tasks.puzzles import Puzzle
from .types import SuiteKind, Visibility


@dataclass
class Suite:
    name: str
    version: str
    visibility: Visibility
    kind: SuiteKind
    source: str
    seed: int
    items: list[dict[str, object]] = field(default_factory=list)  # frozen item dicts
    content_hash: str = ""
    # Editorial copy describes a release but does not alter the benchmark task.
    description: str = ""

    def puzzles(self) -> list[Puzzle]:
        if self.kind != "puzzle":
            raise ValueError(f"suite '{self.name}' is {self.kind}, not puzzle")
        return [Puzzle(**it) for it in self.items]  # type: ignore[arg-type]

    def composed_problems(self) -> list[ComposedProblem]:
        if self.kind != "composed":
            raise ValueError(f"suite '{self.name}' is {self.kind}, not composed")
        return [ComposedProblem(**it) for it in self.items]  # type: ignore[arg-type]

    def compute_hash(self) -> str:
        payload = {
            k: v
            for k, v in asdict(self).items()
            if k not in {"content_hash", "description"}
        }
        blob = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        return "sha256:" + hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]

    def manifest(self) -> dict[str, object]:
        """Return a discovery record without held-out membership or seeds."""
        return {
            "schema": "chessbench.suite_manifest.v1",
            "name": self.name,
            "version": self.version,
            "visibility": self.visibility,
            "kind": self.kind,
            "source": self.source,
            "description": self.description,
            "items": len(self.items),
            "content_hash": self.content_hash or self.compute_hash(),
        }


def build_puzzle_suite(
    source: list[Puzzle],
    *,
    name: str,
    version: str = "1",
    visibility: Visibility = "public",
    source_label: str = "lichess",
    per_bucket: int = 20,
    width: int = 200,
    lo: int = 600,
    hi: int = 2800,
    seed: int = 0,
) -> Suite:
    """Deterministically sample a rating-stratified suite (reproducible given the
    same source, params, and seed)."""
    rng = Random(seed)
    buckets: dict[int, list[Puzzle]] = defaultdict(list)
    for p in source:
        if lo <= p.rating < hi:
            buckets[(p.rating - lo) // width].append(p)

    chosen: list[Puzzle] = []
    for idx in sorted(buckets):
        candidates = sorted(buckets[idx], key=lambda p: p.id)  # stable before sampling
        chosen.extend(rng.sample(candidates, min(per_bucket, len(candidates))))
    chosen.sort(key=lambda p: p.id)

    suite = Suite(
        name=name,
        version=version,
        visibility=visibility,
        kind="puzzle",
        source=source_label,
        seed=seed,
        items=[asdict(p) for p in chosen],
    )
    suite.content_hash = suite.compute_hash()
    return suite


def freeze_puzzle_suite(
    puzzles: list[Puzzle],
    *,
    name: str,
    version: str = "1",
    visibility: Visibility = "public",
    source_label: str,
    description: str = "",
    seed: int = 0,
) -> Suite:
    """Freeze an already-curated puzzle corpus without sampling it again."""
    suite = Suite(
        name=name,
        version=version,
        visibility=visibility,
        kind="puzzle",
        source=source_label,
        description=description,
        seed=seed,
        items=[asdict(puzzle) for puzzle in puzzles],
    )
    suite.content_hash = suite.compute_hash()
    return suite


def freeze_composed_suite(
    problems: list[ComposedProblem],
    *,
    name: str,
    version: str = "1",
    visibility: Visibility = "public",
    source_label: str,
    description: str = "",
    seed: int = 0,
) -> Suite:
    """Freeze a validated esoteric corpus as a runnable composed suite."""
    suite = Suite(
        name=name,
        version=version,
        visibility=visibility,
        kind="composed",
        source=source_label,
        description=description,
        seed=seed,
        items=[asdict(problem) for problem in problems],
    )
    suite.content_hash = suite.compute_hash()
    return suite


def save_suite(suite: Suite, path: str | Path) -> None:
    target = Path(path)
    _guard_private_path(suite.visibility, target)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("w", encoding="utf-8") as f:
        json.dump(asdict(suite), f, indent=1)


def save_suite_manifest(suite: Suite, path: str | Path) -> None:
    """Write a membership-free manifest suitable for a public dashboard."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(suite.manifest(), indent=1) + "\n", encoding="utf-8")


def _guard_private_path(visibility: Visibility, path: Path) -> None:
    if visibility != "private":
        return
    lowered = {part.lower() for part in path.parts}
    if "public" in lowered or path.parent.name.lower() != "private":
        raise ValueError(
            "private suite contents must be written beneath a directory named 'private'"
        )


def load_suite(path: str | Path) -> Suite:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    suite = Suite(**data)
    expected = suite.compute_hash()
    if suite.content_hash and suite.content_hash != expected:
        raise ValueError(
            f"suite '{suite.name}' hash mismatch (file {suite.content_hash} != {expected}); "
            "the items were edited after freezing."
        )
    return suite
