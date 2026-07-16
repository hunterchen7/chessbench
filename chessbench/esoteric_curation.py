"""Editorial curation primitives for a benchmark-quality esoteric corpus.

The runnable :class:`~chessbench.tasks.composed.ComposedProblem` deliberately
stays small.  This module owns the larger evidence record used *before* a task
is admitted: provenance, the complete solution tree, human review, quality
scores, duplicate leads, and public/private selection.

Mechanical soundness is a gate here, never a quality score.  A solver-valid
position remains pending until a curator approves its idea, provenance, and
benchmark value.
"""

from __future__ import annotations

import copy
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Iterable, Literal, Sequence, cast

import chess

from .solvers import stipulations

EsotericGenre = Literal[
    "selfmate",
    "reflexmate",
    "helpmate",
    "series_selfmate",
    "series_helpmate",
    "seriesmate",
    "retro_proofgame",
    "artistic_directmate",
]

TARGET_GENRES: tuple[EsotericGenre, ...] = (
    "selfmate",
    "reflexmate",
    "helpmate",
    "series_selfmate",
    "series_helpmate",
    "seriesmate",
    "retro_proofgame",
    "artistic_directmate",
)

SCORE_DIMENSIONS = ("quality", "originality", "clarity", "benchmark_value")
PUBLIC_RIGHTS = {"public-domain", "permission-granted", "redistribution-cleared"}
COMPLETE_TREES = {"solver-complete", "source-complete-and-replayed"}


def load_curation_records(path: str | Path) -> list[dict[str, object]]:
    """Load either a bare record list or a named candidate-pool document."""
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    records = payload.get("records") if isinstance(payload, dict) else payload
    if not isinstance(records, list) or any(
        not isinstance(item, dict) for item in records
    ):
        raise ValueError(f"{path}: expected a record list or an object with records[]")
    return cast(list[dict[str, object]], records)


def _position_key(fen: str) -> str:
    return " ".join(chess.Board(fen).fen(en_passant="fen").split()[:4])


def _nonempty_text(record: dict[str, object], field: str) -> bool:
    return isinstance(record.get(field), str) and bool(str(record[field]).strip())


def score_total(record: dict[str, object]) -> int:
    raw = record.get("scores", {})
    if not isinstance(raw, dict):
        return 0
    return sum(
        value
        for name in SCORE_DIMENSIONS
        if isinstance((value := raw.get(name)), int) and not isinstance(value, bool)
    )


def validate_curation_record(
    record: dict[str, object], *, public_gate: bool = False
) -> list[str]:
    """Validate the evidence schema and, optionally, public admission gates."""
    errors: list[str] = []
    record_id = str(record.get("id", "<unknown>"))
    if record.get("schema") != "chessbench.esoteric_curation_record.v1":
        errors.append("unsupported or missing record schema")
    genre = record.get("genre")
    if genre not in TARGET_GENRES:
        errors.append(f"unsupported genre: {genre!r}")

    for field in (
        "id",
        "subtype",
        "fen",
        "side_to_move",
        "stipulation",
        "central_idea",
        "selection_rationale",
        "publication",
        "publication_date",
        "source_url",
        "provenance_notes",
        "generation_method",
        "validation_engine",
        "validation_version",
        "curator_notes",
    ):
        if not _nonempty_text(record, field):
            errors.append(f"missing {field}")

    board: chess.Board | None = None
    if _nonempty_text(record, "fen"):
        try:
            board = chess.Board(str(record["fen"]))
        except ValueError as exc:
            errors.append(f"invalid FEN: {exc}")
        else:
            if not board.is_valid():
                errors.append("position is not a valid orthodox chess position")
            expected = "white" if board.turn == chess.WHITE else "black"
            if record.get("side_to_move") != expected:
                errors.append(f"side_to_move must be {expected}")

    solution = record.get("solution")
    if not isinstance(solution, list) or not solution:
        errors.append("solution must be a non-empty move list")
    else:
        for token in solution:
            try:
                chess.Move.from_uci(str(token))
            except ValueError:
                errors.append(f"solution contains non-UCI move: {token!r}")

    tree = record.get("complete_solution_tree")
    if not isinstance(tree, dict):
        errors.append("complete_solution_tree must be an object")
    else:
        if tree.get("completeness") not in {
            "pending",
            "published-variations",
            *COMPLETE_TREES,
        }:
            errors.append("complete_solution_tree has an invalid completeness value")
        lines = tree.get("terminal_lines")
        if not isinstance(lines, list):
            errors.append("complete_solution_tree.terminal_lines must be a list")
        else:
            if tree.get("completeness") in COMPLETE_TREES and not lines:
                errors.append("a complete solution tree must contain terminal lines")
            for index, line in enumerate(lines, 1):
                if not isinstance(line, list) or not line:
                    errors.append(
                        f"terminal line {index} must be a non-empty move list"
                    )
                    continue
                for token in line:
                    try:
                        chess.Move.from_uci(str(token))
                    except ValueError:
                        errors.append(
                            f"terminal line {index} contains non-UCI move: {token!r}"
                        )

    for field in ("variations", "twins", "intended_duals", "themes", "composer"):
        if not isinstance(record.get(field), list):
            errors.append(f"{field} must be a list")
    if not record.get("themes"):
        errors.append("at least one theme is required")
    if not record.get("composer"):
        errors.append("at least one composer is required")

    if record.get("difficulty_band") not in {"pending", "easy", "medium", "hard"}:
        errors.append("difficulty_band must be pending, easy, medium, or hard")
    length = record.get("solution_length")
    if not isinstance(length, (int, float)) or isinstance(length, bool) or length <= 0:
        errors.append("solution_length must be positive")
    year = record.get("publication_year")
    if not isinstance(year, int) or not 1000 <= year <= 2100:
        errors.append("publication_year must be a four-digit year")

    scores = record.get("scores")
    if not isinstance(scores, dict):
        errors.append("scores must be an object")
    else:
        for dimension in SCORE_DIMENSIONS:
            value = scores.get(dimension)
            if (
                not isinstance(value, int)
                or isinstance(value, bool)
                or not 0 <= value <= 5
            ):
                errors.append(f"scores.{dimension} must be an integer from 0 to 5")

    if record.get("review_status") not in {"pending", "approved", "rejected"}:
        errors.append("review_status must be pending, approved, or rejected")
    if record.get("visibility") not in {"candidate", "public", "private"}:
        errors.append("visibility must be candidate, public, or private")
    if record.get("validation_status") not in {"pending", "verified", "failed"}:
        errors.append("validation_status must be pending, verified, or failed")
    independent = record.get("independent_verification")
    if not isinstance(independent, dict) or independent.get("status") not in {
        "pending",
        "verified",
        "failed",
    }:
        errors.append("independent_verification.status is invalid")
    if not isinstance(record.get("database_ids"), dict):
        errors.append("database_ids must be an object")
    if not isinstance(record.get("validation_output"), dict):
        errors.append("validation_output must be an object")
    if not isinstance(record.get("rejection_reasons"), list):
        errors.append("rejection_reasons must be a list")

    if public_gate:
        if record.get("review_status") != "approved":
            errors.append("public admission requires approved human review")
        if record.get("difficulty_band") not in {"easy", "medium", "hard"}:
            errors.append("public admission requires calibrated difficulty")
        if record.get("validation_status") != "verified":
            errors.append("public admission requires solver verification")
        if not isinstance(independent, dict) or independent.get("status") != "verified":
            errors.append("public admission requires independent verification")
        if not isinstance(tree, dict) or tree.get("completeness") not in COMPLETE_TREES:
            errors.append("public admission requires a complete solution tree")
        if record.get("rights_status") not in PUBLIC_RIGHTS:
            errors.append("public admission requires cleared redistribution rights")
        if not _nonempty_text(record, "rights_basis"):
            errors.append("public admission requires a rights basis")
        if not str(record.get("source_url", "")).startswith(("https://", "http://")):
            errors.append("public admission requires an HTTP(S) source URL")
        if score_total(record) < 14:
            errors.append(
                "public admission requires a curation score of at least 14/20"
            )
        if not isinstance(scores, dict) or any(
            not isinstance((value := scores.get(name)), int)
            or isinstance(value, bool)
            or value < 2
            for name in SCORE_DIMENSIONS
        ):
            errors.append(
                "public admission requires at least 2/5 in every score dimension"
            )
        if record.get("visibility") == "private":
            errors.append("a private candidate cannot be admitted publicly")
    return [f"{record_id}: {message}" for message in errors]


def validate_private_reserve_record(record: dict[str, object]) -> list[str]:
    """Validate quality-set gates that do not depend on public source rights."""
    errors = validate_curation_record(record)
    record_id = str(record.get("id", "<unknown>"))
    tree = record.get("complete_solution_tree")
    independent = record.get("independent_verification")
    scores = record.get("scores")
    if record.get("review_status") != "approved":
        errors.append(f"{record_id}: reserve admission requires approved human review")
    if record.get("difficulty_band") not in {"easy", "medium", "hard"}:
        errors.append(f"{record_id}: reserve admission requires calibrated difficulty")
    if record.get("validation_status") != "verified":
        errors.append(f"{record_id}: reserve admission requires solver verification")
    if not isinstance(independent, dict) or independent.get("status") != "verified":
        errors.append(
            f"{record_id}: reserve admission requires independent verification"
        )
    if not isinstance(tree, dict) or tree.get("completeness") not in COMPLETE_TREES:
        errors.append(
            f"{record_id}: reserve admission requires a complete solution tree"
        )
    if score_total(record) < 14:
        errors.append(
            f"{record_id}: reserve admission requires a curation score of at least 14/20"
        )
    if not isinstance(scores, dict) or any(
        not isinstance((value := scores.get(name)), int)
        or isinstance(value, bool)
        or value < 2
        for name in SCORE_DIMENSIONS
    ):
        errors.append(
            f"{record_id}: reserve admission requires at least 2/5 in every score dimension"
        )
    return errors


def enumerate_complete_selfmate_tree(fen: str, n: int, key_uci: str) -> list[list[str]]:
    """Enumerate all terminal lines after a selfmate key.

    This intentionally supports s#1 and s#2, the lengths for which a flat set
    of terminal lines remains readable as curation evidence.  Longer problems
    should get their full tree from Popeye's variation output.
    """
    if n not in {1, 2}:
        raise ValueError("native complete-tree extraction is limited to s#1 and s#2")
    board = chess.Board(fen)
    key = chess.Move.from_uci(key_uci)
    if not stipulations.verify_selfmate(board, n, key):
        raise ValueError(f"{key_uci} does not verify as s#{n}")
    board.push(key)
    terminal: list[list[str]] = []
    for defense in list(board.legal_moves):
        board.push(defense)
        if board.is_checkmate():
            terminal.append([key.uci(), defense.uci()])
        elif n == 2:
            for continuation in list(board.legal_moves):
                board.push(continuation)
                replies = list(board.legal_moves)
                if replies and all(
                    stipulations.gives_checkmate(board, reply) for reply in replies
                ):
                    terminal.extend(
                        [key.uci(), defense.uci(), continuation.uci(), reply.uci()]
                        for reply in replies
                    )
                board.pop()
        board.pop()
    return sorted(terminal)


def verify_terminal_lines(fen: str, lines: Sequence[Sequence[str]]) -> bool:
    """Independently replay ordinary alternating lines through final mate."""
    if not lines:
        return False
    for line in lines:
        board = chess.Board(fen)
        for token in line:
            try:
                move = chess.Move.from_uci(token)
            except ValueError:
                return False
            if move not in board.legal_moves:
                return False
            board.push(move)
        if not board.is_checkmate():
            return False
    return True


def duplicate_and_anticipation_report(
    records: Sequence[dict[str, object]], *, near_threshold: float = 0.82
) -> dict[str, object]:
    """Find exact positions, file mirrors, and conservative near-position leads.

    A near match is only an *anticipation-review lead*.  It is never treated as
    proof that one composition anticipates another's idea.
    """
    exact: dict[tuple[object, str], list[str]] = defaultdict(list)
    mirrors: dict[tuple[object, str], list[str]] = defaultdict(list)
    piece_sets: dict[str, frozenset[tuple[bool, int, int]]] = {}
    buckets: dict[tuple[object, str], list[str]] = defaultdict(list)

    for record in records:
        record_id = str(record.get("id"))
        genre = record.get("genre")
        try:
            board = chess.Board(str(record.get("fen")))
        except ValueError:
            continue
        exact[(genre, _position_key(board.fen(en_passant="fen")))].append(record_id)
        mirrored = board.transform(chess.flip_horizontal)
        mirror_pair = min(
            _position_key(board.fen(en_passant="fen")),
            _position_key(mirrored.fen(en_passant="fen")),
        )
        mirrors[(genre, mirror_pair)].append(record_id)
        pieces = frozenset(
            (piece.color, piece.piece_type, square)
            for square, piece in board.piece_map().items()
        )
        piece_sets[record_id] = pieces
        material = tuple(
            sorted(Counter((color, piece) for color, piece, _ in pieces).items())
        )
        buckets[(genre, repr(material))].append(record_id)

    near: list[dict[str, object]] = []
    for ids in buckets.values():
        for left_index, left in enumerate(ids):
            for right in ids[left_index + 1 :]:
                union = piece_sets[left] | piece_sets[right]
                similarity = len(piece_sets[left] & piece_sets[right]) / len(union)
                if similarity >= near_threshold:
                    near.append(
                        {
                            "ids": [left, right],
                            "piece_placement_jaccard": round(similarity, 4),
                        }
                    )
    exact_groups = [sorted(ids) for ids in exact.values() if len(ids) > 1]
    mirror_groups = [
        sorted(ids)
        for ids in mirrors.values()
        if len(ids) > 1 and sorted(ids) not in exact_groups
    ]
    return {
        "schema": "chessbench.esoteric_duplicate_report.v1",
        "records": len(records),
        "exact_duplicate_groups": sorted(exact_groups),
        "file_mirror_groups": sorted(mirror_groups),
        "anticipation_review_leads": sorted(
            near, key=lambda item: cast(list[str], item["ids"])
        ),
        "note": "Near placement is a review lead, not a finding of thematic anticipation.",
    }


def _stable_tiebreak(record: dict[str, object]) -> str:
    return hashlib.sha256(str(record.get("id", "")).encode("utf-8")).hexdigest()


def _diverse_order(records: Sequence[dict[str, object]]) -> list[dict[str, object]]:
    """Greedy quality order with composer, source, theme, and difficulty spread."""
    remaining = list(records)
    selected: list[dict[str, object]] = []
    composers: Counter[str] = Counter()
    publications: Counter[str] = Counter()
    themes: Counter[str] = Counter()
    difficulties: Counter[str] = Counter()
    while remaining:

        def marginal(record: dict[str, object]) -> tuple[float, str]:
            raw_composers = [
                str(value) for value in cast(list[object], record.get("composer", []))
            ]
            raw_themes = [
                str(value) for value in cast(list[object], record.get("themes", []))
            ]
            penalty = 1.5 * sum(composers[name] for name in raw_composers)
            penalty += 1.0 * publications[str(record.get("publication", ""))]
            penalty += 0.75 * sum(themes[name] for name in raw_themes[:2])
            penalty += 0.5 * difficulties[str(record.get("difficulty_band", ""))]
            return (score_total(record) - penalty, _stable_tiebreak(record))

        chosen = max(remaining, key=marginal)
        remaining.remove(chosen)
        selected.append(chosen)
        composers.update(
            str(value) for value in cast(list[object], chosen.get("composer", []))
        )
        publications.update([str(chosen.get("publication", ""))])
        themes.update(
            str(value) for value in cast(list[object], chosen.get("themes", []))[:2]
        )
        difficulties.update([str(chosen.get("difficulty_band", ""))])
    return selected


def select_curation_records(
    records: Sequence[dict[str, object]],
    *,
    public_per_genre: int = 50,
    reserve_per_genre: int = 10,
) -> dict[str, list[dict[str, object]]]:
    """Partition reviewed candidates without upgrading pending work implicitly."""
    approved: dict[object, list[dict[str, object]]] = defaultdict(list)
    rejected: list[dict[str, object]] = []
    pending: list[dict[str, object]] = []
    invalid: list[dict[str, object]] = []
    for raw in records:
        record = copy.deepcopy(raw)
        structural = validate_curation_record(record)
        if structural:
            record["admission_blockers"] = structural
            invalid.append(record)
        elif record.get("review_status") == "rejected":
            rejected.append(record)
        elif record.get("review_status") == "approved":
            approved[record.get("genre")].append(record)
        else:
            record["admission_blockers"] = ["human review is pending"]
            pending.append(record)

    public: list[dict[str, object]] = []
    reserved: list[dict[str, object]] = []
    for genre in TARGET_GENRES:
        candidates = _diverse_order(approved[genre])
        public_candidates: list[dict[str, object]] = []
        private_candidates: list[dict[str, object]] = []
        blocked_candidates: list[dict[str, object]] = []
        for record in candidates:
            public_blockers = validate_curation_record(record, public_gate=True)
            if not public_blockers:
                public_candidates.append(record)
            elif not (reserve_blockers := validate_private_reserve_record(record)):
                record["public_admission_blockers"] = public_blockers
                private_candidates.append(record)
            else:
                record["admission_blockers"] = reserve_blockers
                blocked_candidates.append(record)
        for record in public_candidates[:public_per_genre]:
            record["visibility"] = "public"
            public.append(record)
        overflow = public_candidates[public_per_genre:] + private_candidates
        for record in _diverse_order(overflow)[:reserve_per_genre]:
            record["visibility"] = "private"
            reserved.append(record)
        for record in _diverse_order(overflow)[reserve_per_genre:]:
            record["admission_blockers"] = record.get(
                "public_admission_blockers", ["genre quota filled"]
            )
            pending.append(record)
        pending.extend(blocked_candidates)

    return {
        "accepted_public": sorted(public, key=lambda item: str(item["id"])),
        "reserved_private": sorted(reserved, key=lambda item: str(item["id"])),
        "rejected": sorted(rejected, key=lambda item: str(item["id"])),
        "pending": sorted(pending, key=lambda item: str(item["id"])),
        "invalid": sorted(invalid, key=lambda item: str(item.get("id", ""))),
    }


def distribution_report(
    partitions: dict[str, list[dict[str, object]]],
    *,
    public_target: int = 50,
    reserve_target: int = 10,
) -> dict[str, object]:
    """Return exact decision counts and public-set distributions."""
    public = partitions["accepted_public"]

    def counts(records: Iterable[dict[str, object]], field: str) -> dict[str, int]:
        values: Counter[str] = Counter()
        for record in records:
            raw = record.get(field)
            if isinstance(raw, list):
                values.update(str(value) for value in raw)
            elif raw is not None and raw != "":
                values.update([str(raw)])
        return dict(sorted(values.items()))

    by_genre: dict[str, dict[str, int]] = {}
    for genre in TARGET_GENRES:
        public_count = sum(item.get("genre") == genre for item in public)
        private_count = sum(
            item.get("genre") == genre for item in partitions["reserved_private"]
        )
        rejected_count = sum(
            item.get("genre") == genre for item in partitions["rejected"]
        )
        pending_count = sum(
            item.get("genre") == genre
            for bucket in ("pending", "invalid")
            for item in partitions[bucket]
        )
        by_genre[genre] = {
            "accepted_public": public_count,
            "public_target": public_target,
            "public_gap": max(0, public_target - public_count),
            "reserved_private": private_count,
            "reserve_target": reserve_target,
            "reserve_gap": max(0, reserve_target - private_count),
            "rejected": rejected_count,
            "pending_or_invalid": pending_count,
        }
    exact = {name: len(items) for name, items in partitions.items()}
    exact["candidate_pool"] = sum(exact.values())
    return {
        "schema": "chessbench.esoteric_distribution_report.v1",
        "exact_counts": exact,
        "by_genre": by_genre,
        "accepted_public_distribution": {
            "difficulty": counts(public, "difficulty_band"),
            "themes": counts(public, "themes"),
            "composer": counts(public, "composer"),
            "publication": counts(public, "publication"),
            "solution_length": counts(public, "solution_length"),
        },
        "targets_met": all(
            values["public_gap"] == 0 and values["reserve_gap"] == 0
            for values in by_genre.values()
        ),
    }


def artifact_document(
    kind: str, records: Sequence[dict[str, object]]
) -> dict[str, object]:
    return {
        "schema": "chessbench.esoteric_curation_artifact.v1",
        "kind": kind,
        "records": list(records),
    }


def safe_status_report(report: dict[str, object]) -> dict[str, object]:
    """Strip a distribution report to membership-free release progress."""
    return {
        "schema": "chessbench.esoteric_curation_status.v1",
        "items": cast(dict[str, int], report["exact_counts"])["candidate_pool"],
        "exact_counts": report["exact_counts"],
        "by_genre": report["by_genre"],
        "targets_met": report["targets_met"],
        "note": "Aggregate curation status only; private membership is omitted.",
    }
