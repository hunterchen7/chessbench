"""Versioned, auditable source corpora for ChessBench.

A corpus is the data-curation layer between a large source pool and a runnable
benchmark suite.  It records where the positions came from, the license, the
selection policy, every selected item, and a validation report.  Suites remain
the immutable execution unit; corpora explain how those suites were assembled.

The distinction matters:

* source pool: a large, changing upstream data set;
* corpus: a reviewed, versioned collection with provenance and quality gates;
* suite: an exact frozen set used for a comparable benchmark run.
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Literal, Sequence

import chess

from .solvers import proofgame, series, stipulations
from .tasks.composed import ComposedProblem
from .tasks.puzzles import Puzzle
from .types import Visibility

CorpusTrack = Literal["standard", "woodpecker", "esoteric"]
ItemType = Literal["puzzle", "composed"]


@dataclass(frozen=True)
class CorpusSource:
    """One upstream source represented in a corpus."""

    id: str
    title: str
    url: str
    license: str
    license_url: str
    snapshot: str
    notes: str = ""


@dataclass
class Corpus:
    """A self-contained, content-addressed collection of benchmark items."""

    name: str
    title: str
    version: str
    track: CorpusTrack
    visibility: Visibility
    description: str
    item_type: ItemType
    sources: list[dict[str, str]]
    selection: dict[str, object]
    items: list[dict[str, object]]
    validation: dict[str, object] = field(default_factory=dict)
    content_hash: str = ""
    schema: str = "chessbench.corpus.v1"

    def puzzles(self) -> list[Puzzle]:
        if self.item_type != "puzzle":
            raise ValueError(f"corpus '{self.name}' contains {self.item_type}, not puzzles")
        return [Puzzle(**item) for item in self.items]  # type: ignore[arg-type]

    def composed_problems(self) -> list[ComposedProblem]:
        if self.item_type != "composed":
            raise ValueError(f"corpus '{self.name}' contains {self.item_type}, not composed problems")
        return [ComposedProblem(**item) for item in self.items]  # type: ignore[arg-type]

    def compute_hash(self) -> str:
        payload = {key: value for key, value in asdict(self).items() if key != "content_hash"}
        blob = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        return "sha256:" + hashlib.sha256(blob.encode("utf-8")).hexdigest()[:20]

    def manifest(self) -> dict[str, object]:
        """Return corpus metadata without membership or selection secrets."""
        return {
            "schema": "chessbench.corpus_manifest.v1",
            "name": self.name,
            "title": self.title,
            "version": self.version,
            "track": self.track,
            "visibility": self.visibility,
            "item_type": self.item_type,
            "items": len(self.items),
            "content_hash": self.content_hash or self.compute_hash(),
            "validation": {
                "valid": self.validation.get("valid"),
                "unique_ids": self.validation.get("unique_ids"),
                "unique_positions": self.validation.get("unique_positions"),
            },
        }


def _position_key(board: chess.Board) -> str:
    """Position identity without move clocks, which do not change the task."""
    return " ".join(board.fen(en_passant="fen").split()[:4])


def _validate_line(board: chess.Board, line: Sequence[str], label: str) -> list[str]:
    errors: list[str] = []
    work = board.copy()
    for ply, token in enumerate(line, 1):
        try:
            move = chess.Move.from_uci(token)
        except ValueError:
            errors.append(f"{label}: ply {ply} is not UCI: {token!r}")
            break
        if move not in work.legal_moves:
            errors.append(f"{label}: ply {ply} is illegal: {token}")
            break
        work.push(move)
    return errors


def validate_puzzle(puzzle: Puzzle, *, min_solver_plies: int = 1) -> tuple[list[str], str | None]:
    """Validate a Lichess-style puzzle and return errors plus its shown-position key."""
    errors: list[str] = []
    try:
        board = chess.Board(puzzle.fen)
    except ValueError as exc:
        return [f"invalid FEN: {exc}"], None
    if not board.is_valid():
        errors.append("position is not a valid orthodox chess position")
    if len(puzzle.moves) < 2:
        errors.append("requires a setup move followed by at least one solver move")
        return errors, None

    errors.extend(_validate_line(board, puzzle.moves, "primary line"))
    try:
        setup = chess.Move.from_uci(puzzle.moves[0])
    except ValueError:
        return errors, None
    if setup not in board.legal_moves:
        return errors, None
    board.push(setup)
    shown_key = _position_key(board)

    if puzzle.num_solver_plies() < min_solver_plies:
        errors.append(
            f"requires at least {min_solver_plies} solver plies; has {puzzle.num_solver_plies()}"
        )
    if len(puzzle.moves[1:]) % 2 != 1:
        errors.append("primary solution must end on a solver move")
    for index, alternate in enumerate(puzzle.alternates, 1):
        if not alternate or len(alternate) % 2 != 1:
            errors.append(f"alternate {index} must be a non-empty line ending on a solver move")
        errors.extend(_validate_line(board, alternate, f"alternate {index}"))
    return errors, shown_key


def validate_composed_problem(problem: ComposedProblem) -> list[str]:
    """Run the appropriate native verifier over one esoteric problem."""
    errors: list[str] = []
    try:
        board = chess.Board(problem.fen)
    except ValueError as exc:
        return [f"invalid FEN: {exc}"]
    if not board.is_valid():
        errors.append("position is not a valid orthodox chess position")
        return errors

    try:
        moves = [chess.Move.from_uci(token) for token in problem.solution]
    except ValueError as exc:
        return [f"solution contains invalid UCI: {exc}"]

    ok = False
    if problem.kind == "directmate":
        ok = bool(moves) and stipulations.verify_directmate(board, problem.n, moves[0])
    elif problem.kind == "selfmate":
        ok = bool(moves) and stipulations.verify_selfmate(board, problem.n, moves[0])
    elif problem.kind == "reflexmate":
        ok = bool(moves) and stipulations.verify_reflexmate(board, problem.n, moves[0])
    elif problem.kind == "helpmate":
        ok = stipulations.verify_helpmate_line(board, problem.n, moves)
    elif problem.kind == "series_directmate":
        ok = series.verify_series_directmate(board, problem.n, moves)
    elif problem.kind == "series_helpmate":
        ok = series.verify_series_helpmate(board, problem.n, moves)
    elif problem.kind == "proofgame":
        ok = proofgame.verify_proofgame(problem.fen, problem.solution, n_plies=problem.n)
    elif problem.kind == "study":
        ok = problem.goal in ("win", "draw")
    if not ok:
        errors.append(f"stored solution does not verify as {problem.label}")
    return errors


def validate_corpus(corpus: Corpus, *, raise_on_error: bool = True) -> dict[str, object]:
    """Validate every item and return a compact, serializable QA report."""
    errors: list[str] = []
    ids: set[str] = set()
    positions: dict[str, str] = {}
    ratings: list[int] = []
    solver_plies: list[int] = []
    themes: Counter[str] = Counter()
    kinds: Counter[str] = Counter()

    expected_type: ItemType = "composed" if corpus.track == "esoteric" else "puzzle"
    if corpus.item_type != expected_type:
        errors.append(f"track {corpus.track!r} requires item_type {expected_type!r}")
    if not corpus.sources:
        errors.append("at least one provenance source is required")
    for raw in corpus.sources:
        for field_name in ("id", "title", "url", "license", "license_url", "snapshot"):
            if not raw.get(field_name):
                errors.append(f"source {raw.get('id', '<unknown>')!r} is missing {field_name}")

    if corpus.item_type == "puzzle":
        minimum = 2 if corpus.track == "woodpecker" else 1
        for puzzle in corpus.puzzles():
            if puzzle.id in ids:
                errors.append(f"duplicate item id: {puzzle.id}")
            ids.add(puzzle.id)
            item_errors, position = validate_puzzle(puzzle, min_solver_plies=minimum)
            errors.extend(f"{puzzle.id}: {message}" for message in item_errors)
            if position is not None:
                if position in positions:
                    errors.append(f"{puzzle.id}: duplicate shown position from {positions[position]}")
                positions[position] = puzzle.id
            ratings.append(puzzle.rating)
            solver_plies.append(puzzle.num_solver_plies())
            themes.update(puzzle.themes)
    else:
        for problem in corpus.composed_problems():
            if problem.id in ids:
                errors.append(f"duplicate item id: {problem.id}")
            ids.add(problem.id)
            item_errors = validate_composed_problem(problem)
            errors.extend(f"{problem.id}: {message}" for message in item_errors)
            key = _position_key(chess.Board(problem.fen))
            if key in positions:
                errors.append(f"{problem.id}: duplicate position from {positions[key]}")
            positions[key] = problem.id
            kinds.update([problem.kind])
            themes.update(problem.themes)

    report: dict[str, object] = {
        "validator": "chessbench.corpus.v1",
        "items": len(corpus.items),
        "valid": not errors,
        "errors": errors,
        "unique_ids": len(ids),
        "unique_positions": len(positions),
        "theme_counts": dict(sorted(themes.items())),
    }
    if ratings:
        report["rating"] = {
            "min": min(ratings),
            "max": max(ratings),
            "mean": round(sum(ratings) / len(ratings), 2),
        }
        report["solver_plies"] = {
            str(plies): count for plies, count in sorted(Counter(solver_plies).items())
        }
    if kinds:
        report["kind_counts"] = dict(sorted(kinds.items()))
    if errors and raise_on_error:
        preview = "; ".join(errors[:8])
        more = f" (+{len(errors) - 8} more)" if len(errors) > 8 else ""
        raise ValueError(f"corpus '{corpus.name}' failed validation: {preview}{more}")
    return report


def finalize_corpus(corpus: Corpus) -> Corpus:
    """Attach a fresh validation report and content hash."""
    corpus.validation = validate_corpus(corpus)
    corpus.content_hash = corpus.compute_hash()
    return corpus


def save_corpus(corpus: Corpus, path: str | Path) -> None:
    finalize_corpus(corpus)
    target = Path(path)
    lowered = {part.lower() for part in target.parts}
    if corpus.visibility == "private" and (
        "public" in lowered or target.parent.name.lower() != "private"
    ):
        raise ValueError(
            "private corpus contents must be written beneath a directory named 'private'"
        )
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(asdict(corpus), indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def save_corpus_manifest(corpus: Corpus, path: str | Path) -> None:
    """Write a safe manifest for either a public or held-out corpus."""
    if not corpus.content_hash:
        finalize_corpus(corpus)
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(corpus.manifest(), indent=1) + "\n", encoding="utf-8")


def load_corpus(path: str | Path, *, validate: bool = True) -> Corpus:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    corpus = Corpus(**data)
    expected = corpus.compute_hash()
    if corpus.content_hash and corpus.content_hash != expected:
        raise ValueError(
            f"corpus '{corpus.name}' hash mismatch "
            f"(file {corpus.content_hash} != {expected}); the corpus was edited after freezing"
        )
    if validate:
        current_report = validate_corpus(corpus)
        if corpus.validation and corpus.validation != current_report:
            raise ValueError(
                f"corpus '{corpus.name}' has a stale validation report; rebuild it with the current validator"
            )
    return corpus


def _stable_priority(item_id: str, *, seed: int, namespace: str) -> str:
    return hashlib.sha256(f"{namespace}:{seed}:{item_id}".encode("utf-8")).hexdigest()


def select_stratified_puzzles(
    source: Sequence[Puzzle],
    *,
    bands: Sequence[tuple[int, int]],
    per_band: int,
    seed: int,
    namespace: str,
    min_popularity: int = 80,
    min_plays: int = 50,
    min_solver_plies: int = 1,
    exclude_ids: set[str] | None = None,
) -> list[Puzzle]:
    """Select exact rating quotas using stable hash priorities.

    Hash-priority sampling is independent of input order and Python's random
    implementation.  Rebuilding from the same source snapshot and parameters
    therefore produces byte-identical membership.
    """
    excluded = exclude_ids or set()
    buckets: dict[int, list[Puzzle]] = defaultdict(list)
    for puzzle in source:
        if puzzle.id in excluded or puzzle.popularity < min_popularity or puzzle.nb_plays < min_plays:
            continue
        if puzzle.num_solver_plies() < min_solver_plies:
            continue
        for index, (lo, hi) in enumerate(bands):
            if lo <= puzzle.rating < hi:
                buckets[index].append(puzzle)
                break

    chosen: list[Puzzle] = []
    for index, (lo, hi) in enumerate(bands):
        candidates = sorted(
            buckets[index],
            key=lambda puzzle: (_stable_priority(puzzle.id, seed=seed, namespace=namespace), puzzle.id),
        )
        if len(candidates) < per_band:
            raise ValueError(
                f"rating band {lo}-{hi - 1} has {len(candidates)} eligible puzzles; "
                f"need {per_band}"
            )
        chosen.extend(candidates[:per_band])
    return sorted(chosen, key=lambda puzzle: puzzle.id)


def corpus_index(corpora: Sequence[Corpus]) -> dict[str, object]:
    """Small discovery document for tooling and future dashboard ingestion."""
    return {
        "schema": "chessbench.corpus_index.v1",
        "corpora": [
            {
                "name": corpus.name,
                "title": corpus.title,
                "version": corpus.version,
                "track": corpus.track,
                "visibility": corpus.visibility,
                "item_type": corpus.item_type,
                "items": len(corpus.items),
                "content_hash": corpus.content_hash,
            }
            for corpus in corpora
        ],
    }
