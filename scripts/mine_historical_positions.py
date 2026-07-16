#!/usr/bin/env python3
"""Mine reproducible historical-position candidates from local PGN archives.

Every shown position follows a move that was actually played in the source
game.  Stockfish (or another UCI engine) supplies a short candidate line using
fixed node budgets and MultiPV.  These records belong in the editorial staging
bank: a fixed-node result is evidence, never proof that a move or line is
uniquely forced.

Source metadata can be supplied alongside positional PGNs or in a JSON catalog.
A catalog may be a list, ``{"sources": [...]}``, or an object whose values are
source objects. Each source needs ``pgn``/``path`` and ``source_url``/``url``;
``label``/``name`` and ``category`` are optional.
"""

from __future__ import annotations

import argparse
import hashlib
import heapq
import json
import pathlib
import re
from collections import Counter, defaultdict, deque
from dataclasses import dataclass
from typing import Callable, Iterable, Mapping, Sequence

import chess
import chess.engine
import chess.pgn


SCHEMA_VERSION = "chessbench.historical_candidates.v1"
ROOT = pathlib.Path(__file__).resolve().parents[1]
DIFFICULTIES = ("easy", "medium", "hard")
CAUTION = (
    "Fixed-node MultiPV rankings are curation evidence, not proof that the "
    "first move or continuation is uniquely forced."
)


@dataclass(frozen=True)
class Source:
    path: pathlib.Path
    source_url: str
    label: str
    category: str
    source_id: str = ""
    sha256: str = ""


@dataclass(frozen=True)
class Position:
    source: Source
    game_number: int
    headers: Mapping[str, str]
    game_fingerprint: str
    ply: int
    fen: str
    setup_uci: str
    setup_san: str
    shown_fen_key: str
    selection_key: str


def _slug(value: str, *, fallback: str = "unknown") -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")
    return slug or fallback


def _shown_key(board: chess.Board) -> str:
    return " ".join(board.fen(en_passant="fen").split()[:4])


def _stable_digest(*parts: object) -> str:
    value = "\x1f".join(str(part) for part in parts)
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _game_fingerprint(initial_fen: str, moves: Sequence[chess.Move]) -> str:
    return _stable_digest(
        initial_fen,
        *(move.uci() for move in moves),
    )[:16]


def discover_positions(
    sources: Sequence[Source],
    *,
    min_ply: int,
    scan_limit: int | None,
    scan_offset: int = 0,
    excluded_positions: set[str] | None = None,
) -> list[Position]:
    """Discover unique shown positions, retaining a stable hash sample.

    The bounded heap means a large archive does not have to keep every board in
    memory.  Sampling by content hash, rather than taking the first N games,
    avoids systematically favoring early events in a concatenated PGN.
    """

    if min_ply < 1:
        raise ValueError("min_ply must be positive")
    if scan_limit is not None and scan_limit < 1:
        raise ValueError("scan_limit must be positive")
    if scan_offset < 0:
        raise ValueError("scan_offset must be non-negative")

    found: list[Position] = []
    heap: list[tuple[int, int, Position]] = []
    seen: set[str] = set(excluded_positions or ())
    sequence = 0

    for source in sorted(sources, key=lambda item: (str(item.path), item.source_url)):
        with source.path.open("r", encoding="utf-8", errors="replace") as handle:
            game_number = 0
            while True:
                game = chess.pgn.read_game(handle)
                if game is None:
                    break
                game_number += 1
                if game.errors:
                    continue
                board = game.board()
                if board.chess960 or not board.is_valid():
                    continue
                headers = {str(key): str(value) for key, value in game.headers.items()}
                moves = list(game.mainline_moves())
                fingerprint = _game_fingerprint(board.fen(en_passant="fen"), moves)
                for ply, move in enumerate(moves, 1):
                    if move not in board.legal_moves:
                        break
                    before_fen = board.fen(en_passant="fen")
                    setup_san = board.san(move)
                    board.push(move)
                    if ply < min_ply or board.is_game_over(claim_draw=False):
                        continue
                    shown = _shown_key(board)
                    if shown in seen:
                        continue
                    seen.add(shown)
                    rank_hex = _stable_digest(shown, fingerprint, ply)
                    position = Position(
                        source=source,
                        game_number=game_number,
                        headers=headers,
                        game_fingerprint=fingerprint,
                        ply=ply,
                        fen=before_fen,
                        setup_uci=move.uci(),
                        setup_san=setup_san,
                        shown_fen_key=shown,
                        selection_key=rank_hex,
                    )
                    if scan_limit is None:
                        found.append(position)
                        continue
                    sequence += 1
                    rank = int(rank_hex, 16)
                    entry = (-rank, -sequence, position)
                    sample_size = scan_limit + scan_offset
                    if len(heap) < sample_size:
                        heapq.heappush(heap, entry)
                    elif rank < -heap[0][0]:
                        heapq.heapreplace(heap, entry)

    if scan_limit is not None:
        found = [entry[2] for entry in heap]
    found = sorted(found, key=lambda item: (item.selection_key, item.shown_fen_key))
    return found[scan_offset : scan_offset + scan_limit if scan_limit is not None else None]


def _score_cp(info: Mapping[str, object], turn: chess.Color) -> int | None:
    score = info.get("score")
    if not isinstance(score, chess.engine.PovScore):
        return None
    return score.pov(turn).score(mate_score=100_000)


def _mate_in(info: Mapping[str, object], turn: chess.Color) -> int | None:
    score = info.get("score")
    if not isinstance(score, chess.engine.PovScore):
        return None
    return score.pov(turn).mate()


def difficulty_band(
    *,
    legal_move_count: int,
    score_gap_cp: int | None,
    mate_in: int | None,
    first_move_tactical: bool,
    forcing_plies: int,
) -> tuple[str, str]:
    """Return a transparent editorial heuristic, not a player rating."""

    if mate_in is not None and 0 < mate_in <= 3:
        return "easy", "engine reports a short mate at the review budget"
    if (
        first_move_tactical
        and forcing_plies >= 3
        and score_gap_cp is not None
        and score_gap_cp >= 260
        and legal_move_count <= 30
    ):
        return "easy", "forcing first move and a large fixed-node top-two score gap"
    if not first_move_tactical or legal_move_count >= 36:
        return "hard", "quiet first move or broad legal-move search"
    return "medium", "forcing line with a nontrivial fixed-node choice"


def _legal_pv(board: chess.Board, value: object, plies: int) -> list[chess.Move]:
    if not isinstance(value, Sequence):
        return []
    replay = board.copy(stack=False)
    result: list[chess.Move] = []
    for move in value[:plies]:
        if not isinstance(move, chess.Move) or move not in replay.legal_moves:
            return []
        result.append(move)
        replay.push(move)
    return result if len(result) == plies else []


def _clear_hash(engine: object) -> None:
    options = getattr(engine, "options", {})
    if "Clear Hash" in options:
        engine.configure({"Clear Hash": None})  # type: ignore[attr-defined]


def configure_engine(
    engine: object, *, threads: int, hash_mb: int
) -> dict[str, object]:
    requested = {"Threads": threads, "Hash": hash_mb}
    options = getattr(engine, "options", {})
    supported = {key: value for key, value in requested.items() if key in options}
    if supported:
        engine.configure(supported)  # type: ignore[attr-defined]
    return {
        "threads": supported.get("Threads"),
        "hash_mb": supported.get("Hash"),
        "clear_hash_before_each_position": "Clear Hash" in options,
    }


def analyse_position(
    engine: object,
    position: Position,
    *,
    nodes: int,
    multipv: int,
    line_plies: int,
    min_top_two_gap_cp: int,
    quiet_min_top_two_gap_cp: int,
) -> dict[str, object] | None:
    board = chess.Board(position.fen)
    setup = chess.Move.from_uci(position.setup_uci)
    if setup not in board.legal_moves:
        return None
    board.push(setup)
    legal_count = board.legal_moves.count()
    if legal_count < 2:
        return None
    requested_multipv = min(multipv, legal_count)
    _clear_hash(engine)
    raw = engine.analyse(  # type: ignore[attr-defined]
        board,
        chess.engine.Limit(nodes=nodes),
        multipv=requested_multipv,
    )
    infos = raw if isinstance(raw, list) else [raw]
    infos = [info for info in infos if isinstance(info, dict)]
    infos.sort(key=lambda info: int(info.get("multipv", 1)))
    if not infos:
        return None
    pv = _legal_pv(board, infos[0].get("pv"), line_plies)
    if len(pv) != line_plies:
        return None

    scores = [_score_cp(info, board.turn) for info in infos]
    gap = scores[0] - scores[1] if len(scores) > 1 and None not in scores[:2] else None
    top_mate = _mate_in(infos[0], board.turn)
    first_move = pv[0]
    first_is_capture = board.is_capture(first_move)
    first_gives_check = board.gives_check(first_move)
    first_is_promotion = first_move.promotion is not None
    first_move_tactical = first_is_capture or first_gives_check or first_is_promotion
    required_gap = (
        min_top_two_gap_cp if first_move_tactical else quiet_min_top_two_gap_cp
    )
    passes_quality_gate = (top_mate is not None and top_mate > 0) or (
        gap is not None and gap >= required_gap
    )
    if not passes_quality_gate:
        return None

    forcing_plies = 0
    forcing_replay = board.copy(stack=False)
    for move in pv:
        if (
            forcing_replay.is_capture(move)
            or forcing_replay.gives_check(move)
            or move.promotion is not None
        ):
            forcing_plies += 1
        forcing_replay.push(move)
    band, basis = difficulty_band(
        legal_move_count=legal_count,
        score_gap_cp=gap,
        mate_in=top_mate,
        first_move_tactical=first_move_tactical,
        forcing_plies=forcing_plies,
    )

    san: list[str] = []
    replay = board.copy(stack=False)
    for move in pv:
        san.append(replay.san(move))
        replay.push(move)

    ranked: list[dict[str, object]] = []
    for rank, info in enumerate(infos, 1):
        candidate_pv = _legal_pv(board, info.get("pv"), 1)
        if not candidate_pv:
            continue
        ranked.append(
            {
                "rank": rank,
                "uci": candidate_pv[0].uci(),
                "score_cp_for_solver": _score_cp(info, board.turn),
                "mate_in_for_solver": _mate_in(info, board.turn),
            }
        )

    headers = position.headers
    event = headers.get("Event", "Unknown event")
    white = headers.get("White", "Unknown")
    black = headers.get("Black", "Unknown")
    candidate_hash = _stable_digest(
        position.shown_fen_key, position.game_fingerprint, position.ply
    )[:12]
    candidate_id = f"historic-{_slug(event)[:36]}-p{position.ply}-{candidate_hash}"
    category_theme = _slug(position.source.category).replace("-", "_")
    move_theme = (
        "checkingMove"
        if first_gives_check
        else "capture"
        if first_is_capture
        else "quietMove"
    )
    themes = ["historical", "engineCurated", category_theme, move_theme]
    if top_mate is not None and top_mate > 0:
        themes.append("mate")
    return {
        "id": candidate_id,
        "event": event,
        "site": headers.get("Site", "?"),
        "date": headers.get("Date", "????.??.??").replace(".", "-"),
        "round": headers.get("Round", "?"),
        "white": white,
        "black": black,
        "result": headers.get("Result", "*"),
        "fen": position.fen,
        "setup_uci": position.setup_uci,
        "setup_san_audit_only": position.setup_san,
        "moves": [move.uci() for move in pv],
        "san_audit_only": san,
        "solver_color": "white" if board.turn == chess.WHITE else "black",
        "solver_plies": (line_plies + 1) // 2,
        "difficulty_band": band,
        "difficulty_basis": basis,
        "themes": themes,
        "source_url": position.source.source_url,
        "source_id": position.source.source_id,
        "source_sha256": position.source.sha256,
        "source_label": position.source.label,
        "source_pgn": position.source.path.name,
        "source_category": position.source.category,
        "source_game_number": position.game_number,
        "source_game_fingerprint": position.game_fingerprint,
        "source_game_ply": position.ply,
        "why_famous": f"Critical engine-mined position from {white}–{black}, {event}.",
        "provenance_confidence": "medium",
        "line_provenance": "fixed-node-engine-pv-editorial-candidate",
        "forced": False,
        "engine_derived": True,
        "line_note": CAUTION,
        "engine_evidence": {
            "fixed_nodes": nodes,
            "legal_move_count": legal_count,
            "multipv_requested": requested_multipv,
            "multipv_returned": len(ranked),
            "rank_scope": f"top {len(ranked)} of {legal_count} legal moves reviewed",
            "score_gap_cp_first_to_second": gap,
            "quality_gate": {
                "passed": True,
                "minimum_top_two_gap_cp": required_gap,
                "positive_mate_score_also_qualifies": True,
            },
            "first_move_tactical": first_move_tactical,
            "forcing_plies_in_display_line": forcing_plies,
            "ranked_legal_moves": ranked,
            "caution": CAUTION,
        },
        "verification": "python-chess legal replay; fixed-node UCI engine review pending editorial audit",
    }


def _fair_order(candidates: Iterable[dict[str, object]]) -> list[dict[str, object]]:
    buckets: dict[tuple[str, str, str], deque[dict[str, object]]] = defaultdict(deque)
    def priority(item: dict[str, object]) -> tuple[int, str]:
        evidence = item.get("engine_evidence", {})
        gap = evidence.get("score_gap_cp_first_to_second") if isinstance(evidence, dict) else None
        return (-(gap if isinstance(gap, int) else 100_000), str(item["id"]))

    for candidate in sorted(candidates, key=priority):
        key = (
            str(candidate["difficulty_band"]),
            str(candidate["source_category"]),
            str(candidate["event"]),
        )
        buckets[key].append(candidate)
    ordered: list[dict[str, object]] = []
    keys = sorted(buckets)
    while keys:
        next_keys: list[tuple[str, str, str]] = []
        for key in keys:
            ordered.append(buckets[key].popleft())
            if buckets[key]:
                next_keys.append(key)
        keys = next_keys
    return ordered


def select_candidates(
    candidates: Iterable[dict[str, object]],
    *,
    limit: int | None,
    band_quotas: Mapping[str, int] | None = None,
    category_quotas: Mapping[str, int] | None = None,
    event_quotas: Mapping[str, int] | None = None,
    per_event: int | None = None,
    per_game: int | None = 1,
) -> list[dict[str, object]]:
    """Apply deterministic caps after fair band/category/event interleaving."""

    if limit is not None and limit < 1:
        raise ValueError("limit must be positive")
    if per_event is not None and per_event < 1:
        raise ValueError("per_event must be positive")
    if per_game is not None and per_game < 1:
        raise ValueError("per_game must be positive")
    band_quotas = dict(band_quotas or {})
    category_quotas = dict(category_quotas or {})
    event_quotas = dict(event_quotas or {})
    counts: Counter[tuple[str, str]] = Counter()
    selected: list[dict[str, object]] = []
    for candidate in _fair_order(candidates):
        if any(
            str(candidate.get(field, "")).strip() in {"", "?", "Unknown", "Unknown event"}
            for field in ("event", "white", "black", "date")
        ) or str(candidate.get("date", "")).startswith("????"):
            continue
        band = str(candidate["difficulty_band"])
        category = str(candidate["source_category"])
        event = str(candidate["event"])
        game = str(candidate.get("source_game_fingerprint", candidate["id"]))
        event_cap = event_quotas.get(event, per_event)
        if band in band_quotas and counts[("band", band)] >= band_quotas[band]:
            continue
        if (
            category in category_quotas
            and counts[("category", category)] >= category_quotas[category]
        ):
            continue
        if event_cap is not None and counts[("event", event)] >= event_cap:
            continue
        if per_game is not None and counts[("game", game)] >= per_game:
            continue
        selected.append(candidate)
        counts.update(
            [("band", band), ("category", category), ("event", event), ("game", game)]
        )
        if limit is not None and len(selected) >= limit:
            break
    return sorted(selected, key=lambda item: str(item["id"]))


def apply_deterministic_split(
    candidates: Sequence[dict[str, object]], *, heldout_count: int
) -> list[dict[str, object]]:
    """Assign an exact held-out count using position-derived stable keys."""

    if heldout_count < 0 or heldout_count > len(candidates):
        raise ValueError(
            "heldout_count must be between zero and the selected candidate count"
        )
    games: dict[str, list[dict[str, object]]] = defaultdict(list)
    for candidate in candidates:
        fingerprint = str(candidate["source_game_fingerprint"])
        games[fingerprint].append(candidate)
    ranked_games = sorted(
        (_stable_digest(fingerprint), fingerprint, items)
        for fingerprint, items in games.items()
    )
    heldout_games: set[str] = set()
    assigned = 0
    for _, fingerprint, items in ranked_games:
        if assigned + len(items) <= heldout_count:
            heldout_games.add(fingerprint)
            assigned += len(items)
        if assigned == heldout_count:
            break
    if assigned != heldout_count:
        raise ValueError(
            "heldout_count cannot be reached without splitting a source game; "
            "use the default --per-game 1 or choose a compatible count"
        )
    result: list[dict[str, object]] = []
    for split_key, fingerprint, items in ranked_games:
        for candidate in items:
            enriched = dict(candidate)
            enriched["split_key"] = f"sha256:{split_key}"
            enriched["split_unit"] = f"source_game:{fingerprint}"
            enriched["split"] = (
                "held_out" if fingerprint in heldout_games else "public"
            )
            result.append(enriched)
    return sorted(result, key=lambda item: str(item["id"]))


def mine(
    sources: Sequence[Source],
    *,
    engine: object,
    engine_path: pathlib.Path,
    nodes: int,
    multipv: int,
    line_plies: int,
    min_ply: int,
    scan_limit: int | None,
    limit: int | None,
    scan_offset: int = 0,
    band_quotas: Mapping[str, int] | None = None,
    category_quotas: Mapping[str, int] | None = None,
    event_quotas: Mapping[str, int] | None = None,
    per_event: int | None = None,
    per_game: int | None = 1,
    threads: int = 1,
    hash_mb: int = 64,
    heldout_count: int = 0,
    min_top_two_gap_cp: int = 80,
    quiet_min_top_two_gap_cp: int = 180,
    excluded_positions: set[str] | None = None,
    seed_candidates: Sequence[dict[str, object]] = (),
) -> dict[str, object]:
    if nodes < 1 or multipv < 1:
        raise ValueError("nodes and multipv must be positive")
    if line_plies < 5 or line_plies % 2 == 0:
        raise ValueError("line_plies must be odd and at least 5")
    if min_top_two_gap_cp < 0 or quiet_min_top_two_gap_cp < min_top_two_gap_cp:
        raise ValueError(
            "quality gaps must be non-negative and quiet gap must be at least the tactical gap"
        )
    settings = configure_engine(engine, threads=threads, hash_mb=hash_mb)
    positions = discover_positions(
        sources,
        min_ply=min_ply,
        scan_limit=scan_limit,
        scan_offset=scan_offset,
        excluded_positions=excluded_positions,
    )
    newly_qualified = [
        candidate
        for position in positions
        if (
            candidate := analyse_position(
                engine,
                position,
                nodes=nodes,
                multipv=multipv,
                line_plies=line_plies,
                min_top_two_gap_cp=min_top_two_gap_cp,
                quiet_min_top_two_gap_cp=quiet_min_top_two_gap_cp,
            )
        )
        is not None
    ]
    candidates = [dict(candidate) for candidate in seed_candidates] + newly_qualified
    selected = select_candidates(
        candidates,
        limit=limit,
        band_quotas=band_quotas,
        category_quotas=category_quotas,
        event_quotas=event_quotas,
        per_event=per_event,
        per_game=per_game,
    )
    selected = apply_deterministic_split(selected, heldout_count=heldout_count)
    engine_id = {
        str(key): str(value) for key, value in getattr(engine, "id", {}).items()
    }
    return {
        "schema_version": SCHEMA_VERSION,
        "track": "historical_woodpecker_candidates",
        "curation_policy": CAUTION,
        "miner": {
            "name": "scripts/mine_historical_positions.py",
            "engine": engine_id,
            "engine_binary": engine_path.name,
            "engine_binary_sha256": _file_sha256(engine_path) if engine_path.is_file() else "",
            "nodes_per_position": nodes,
            "multipv": multipv,
            "line_plies": line_plies,
            "minimum_top_two_gap_cp": min_top_two_gap_cp,
            "quiet_move_minimum_top_two_gap_cp": quiet_min_top_two_gap_cp,
            "positive_mate_score_also_qualifies": True,
            "min_source_game_ply": min_ply,
            "scan_offset": scan_offset,
            "positions_reviewed": len(positions),
            "seed_candidates": len(seed_candidates),
            "new_candidates_qualified": len(newly_qualified),
            "engine_settings": settings,
            "determinism": "content-hash sampling; Threads=1 when supported; hash cleared per position when supported",
            "caution": CAUTION,
        },
        "sources": [
            {
                "pgn": source.path.name,
                "source_url": source.source_url,
                "label": source.label,
                "category": source.category,
                "source_id": source.source_id,
                "sha256": source.sha256,
            }
            for source in sorted(
                sources, key=lambda item: (str(item.path), item.source_url)
            )
        ],
        "candidate_count": len(selected),
        "split_policy": {
            "method": "lowest source-game-derived SHA-256 split keys are held out",
            "public_count": len(selected) - heldout_count,
            "held_out_count": heldout_count,
            "warning": "Never publish records whose split is held_out.",
        },
        "candidates": selected,
    }


def _expand(
    values: Sequence[str], size: int, *, name: str, default: Sequence[str] | None = None
) -> list[str]:
    source = list(values or default or [])
    if len(source) == 1:
        return source * size
    if len(source) != size:
        raise ValueError(f"{name} must be supplied once or once per PGN")
    return source


def _parse_quotas(
    values: Sequence[str], *, allowed: set[str] | None = None
) -> dict[str, int]:
    quotas: dict[str, int] = {}
    for value in values:
        try:
            key, raw = value.rsplit("=", 1)
            amount = int(raw)
        except (ValueError, AttributeError) as exc:
            raise ValueError(f"invalid quota {value!r}; expected NAME=COUNT") from exc
        if not key or amount < 0 or (allowed is not None and key not in allowed):
            raise ValueError(f"invalid quota {value!r}")
        quotas[key] = amount
    return quotas


def _file_sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_excluded_positions(paths: Sequence[pathlib.Path]) -> set[str]:
    """Load shown-position keys from existing candidate documents."""

    excluded: set[str] = set()
    documents: list[pathlib.Path] = []
    for path in paths:
        documents.extend(sorted(path.glob("*.json")) if path.is_dir() else [path])
    for path in documents:
        document = json.loads(path.read_text(encoding="utf-8"))
        for item in document.get("candidates", []):
            if not isinstance(item, dict):
                continue
            try:
                board = chess.Board(str(item["fen"]))
                setup = chess.Move.from_uci(str(item["setup_uci"]))
            except (KeyError, ValueError):
                continue
            if setup in board.legal_moves:
                board.push(setup)
                excluded.add(_shown_key(board))
    return excluded


def load_candidate_items(paths: Sequence[pathlib.Path]) -> list[dict[str, object]]:
    candidates: list[dict[str, object]] = []
    for path in paths:
        document = json.loads(path.read_text(encoding="utf-8"))
        items = document.get("candidates", []) if isinstance(document, dict) else []
        if not isinstance(items, list) or not all(isinstance(item, dict) for item in items):
            raise ValueError(f"{path}: candidates must be an object array")
        candidates.extend(dict(item) for item in items)
    return candidates


def document_for_split(
    document: Mapping[str, object], split: str
) -> dict[str, object]:
    candidates = [
        item
        for item in document.get("candidates", [])  # type: ignore[union-attr]
        if isinstance(item, dict) and item.get("split") == split
    ]
    result = dict(document)
    result["candidate_count"] = len(candidates)
    result["output_split"] = split
    result["candidates"] = candidates
    return result


def load_source_catalog(
    path: pathlib.Path, *, lock_path: pathlib.Path | None = None
) -> list[Source]:
    """Load a permissive JSON source catalog with paths relative to the catalog."""

    document = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(document, list):
        items = document
    elif isinstance(document, dict) and isinstance(
        document.get("sources", document.get("source_packs", document.get("packs"))),
        list,
    ):
        items = document.get("sources") or document.get("source_packs") or document.get("packs")
    elif isinstance(document, dict) and all(
        isinstance(value, dict) for value in document.values()
    ):
        items = list(document.values())
    else:
        raise ValueError(
            "source catalog must be a list, {sources: [...]}, or an object of source objects"
        )
    locked: dict[str, dict[str, object]] = {}
    if lock_path is not None:
        lock = json.loads(lock_path.read_text(encoding="utf-8"))
        artifacts = lock.get("artifacts", []) if isinstance(lock, dict) else []
        if not isinstance(artifacts, list):
            raise ValueError("source lock artifacts must be an array")
        locked = {
            str(artifact["source_id"]): artifact
            for artifact in artifacts
            if isinstance(artifact, dict) and artifact.get("source_id")
        }
    sources: list[Source] = []
    for index, item in enumerate(items, 1):
        if not isinstance(item, dict):
            raise ValueError(f"source catalog item {index} must be an object")
        if item.get("enabled", True) is False:
            continue
        source_id = str(item.get("source_id", item.get("id", "")))
        if lock_path is not None and source_id not in locked:
            continue
        artifact = locked.get(source_id, {})
        raw_pgn = artifact.get("local_file", item.get("pgn", item.get("path")))
        if raw_pgn is None and source_id:
            raw_pgn = ROOT / "data" / "sources" / "historical" / f"{source_id}.pgn"
        url = item.get(
            "landing_url", item.get("source_url", item.get("url", artifact.get("landing_url")))
        )
        if (
            not isinstance(raw_pgn, str)
            or not isinstance(url, str)
            or not url.startswith("https://")
        ):
            raise ValueError(
                f"source catalog item {index} needs a PGN path and HTTPS source URL"
            )
        pgn = pathlib.Path(raw_pgn)
        if not pgn.is_absolute():
            pgn = ROOT / pgn if artifact else path.parent / pgn
        if pgn.suffix.lower() != ".pgn":
            continue
        label = str(item.get("label", item.get("name", item.get("event", pgn.stem))))
        category = str(item.get("category", "historical-games"))
        sha256 = str(artifact.get("sha256", item.get("sha256", "")))
        sources.append(Source(pgn, url, label, category, source_id, sha256))
    return sources


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=__doc__,
        epilog=(
            "Catalog fields: pgn/path, source_url/url, optional label/name, optional category. "
            "For 400 public + 100 held-out candidates use --limit 500 --heldout-count 100."
        ),
    )
    parser.add_argument("pgns", nargs="*", type=pathlib.Path)
    parser.add_argument("--source-catalog", type=pathlib.Path)
    parser.add_argument("--source-lock", type=pathlib.Path)
    parser.add_argument(
        "--source-url",
        action="append",
        default=[],
        help="HTTPS source URL; once or per positional PGN",
    )
    parser.add_argument(
        "--source-label",
        action="append",
        default=[],
        help="source label; once or per PGN",
    )
    parser.add_argument(
        "--category",
        action="append",
        default=[],
        help="source category; once or per PGN",
    )
    parser.add_argument("--engine", type=pathlib.Path, required=True)
    parser.add_argument("--out", type=pathlib.Path)
    parser.add_argument("--public-out", type=pathlib.Path)
    parser.add_argument("--heldout-out", type=pathlib.Path)
    parser.add_argument(
        "--exclude-candidates",
        action="append",
        type=pathlib.Path,
        default=[],
        help="existing candidate JSON file or directory whose shown positions are excluded",
    )
    parser.add_argument("--nodes", type=int, default=100_000)
    parser.add_argument("--multipv", type=int, default=8)
    parser.add_argument("--line-plies", type=int, default=5)
    parser.add_argument("--min-ply", type=int, default=16)
    parser.add_argument("--scan-limit", type=int, default=5_000)
    parser.add_argument(
        "--scan-offset",
        type=int,
        default=0,
        help="skip this many earlier content-hash-sampled positions for resumable batches",
    )
    parser.add_argument("--limit", type=int)
    parser.add_argument(
        "--seed-candidates",
        action="append",
        type=pathlib.Path,
        default=[],
        help="merge already-mined candidate documents before deterministic selection",
    )
    parser.add_argument("--heldout-count", type=int, default=0)
    parser.add_argument("--min-top-two-gap-cp", type=int, default=80)
    parser.add_argument("--quiet-min-top-two-gap-cp", type=int, default=180)
    parser.add_argument("--band-quota", action="append", default=[], metavar="BAND=N")
    parser.add_argument(
        "--category-quota", action="append", default=[], metavar="CATEGORY=N"
    )
    parser.add_argument("--event-quota", action="append", default=[], metavar="EVENT=N")
    parser.add_argument("--per-event", type=int)
    parser.add_argument("--per-game", type=int, default=1)
    parser.add_argument("--threads", type=int, default=1)
    parser.add_argument("--hash-mb", type=int, default=64)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="analyse and summarize without writing --out",
    )
    return parser


def main(
    argv: Sequence[str] | None = None,
    *,
    engine_factory: Callable[[str], object] = chess.engine.SimpleEngine.popen_uci,
) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    try:
        if not args.dry_run and not any((args.out, args.public_out, args.heldout_out)):
            parser.error(
                "one of --out, --public-out, or --heldout-out is required unless --dry-run is used"
            )
        sources = (
            load_source_catalog(args.source_catalog, lock_path=args.source_lock)
            if args.source_catalog
            else []
        )
        if args.pgns:
            if any(not url.startswith("https://") for url in args.source_url):
                parser.error("every --source-url must be HTTPS")
            urls = _expand(args.source_url, len(args.pgns), name="--source-url")
            labels = _expand(
                args.source_label,
                len(args.pgns),
                name="--source-label",
                default=[path.stem for path in args.pgns],
            )
            categories = _expand(
                args.category,
                len(args.pgns),
                name="--category",
                default=["historical-games"],
            )
            sources.extend(
                Source(path=path, source_url=url, label=label, category=category)
                for path, url, label, category in zip(
                    args.pgns, urls, labels, categories
                )
            )
        if not sources:
            parser.error("provide positional PGNs or --source-catalog")
        if any(not source.path.is_file() for source in sources):
            parser.error("every PGN path must be a readable file")
        band_quotas = _parse_quotas(args.band_quota, allowed=set(DIFFICULTIES))
        category_quotas = _parse_quotas(args.category_quota)
        event_quotas = _parse_quotas(args.event_quota)
        seed_candidates = load_candidate_items(args.seed_candidates)
        excluded_positions = load_excluded_positions(
            [*args.exclude_candidates, *args.seed_candidates]
        )
        with engine_factory(str(args.engine)) as engine:  # type: ignore[attr-defined]
            document = mine(
                sources,
                engine=engine,
                engine_path=args.engine,
                nodes=args.nodes,
                multipv=args.multipv,
                line_plies=args.line_plies,
                min_ply=args.min_ply,
                scan_limit=args.scan_limit,
                scan_offset=args.scan_offset,
                limit=args.limit,
                band_quotas=band_quotas,
                category_quotas=category_quotas,
                event_quotas=event_quotas,
                per_event=args.per_event,
                per_game=args.per_game,
                threads=args.threads,
                hash_mb=args.hash_mb,
                heldout_count=args.heldout_count,
                min_top_two_gap_cp=args.min_top_two_gap_cp,
                quiet_min_top_two_gap_cp=args.quiet_min_top_two_gap_cp,
                excluded_positions=excluded_positions,
                seed_candidates=seed_candidates,
            )
    except (OSError, ValueError, chess.engine.EngineError) as exc:
        parser.error(str(exc))

    summary = {
        "dry_run": args.dry_run,
        "candidate_count": document["candidate_count"],
        "difficulty": dict(
            sorted(
                Counter(
                    item["difficulty_band"] for item in document["candidates"]
                ).items()
            )
        ),
        "output": None if args.dry_run or args.out is None else str(args.out),
        "public_output": None if args.dry_run or args.public_out is None else str(args.public_out),
        "heldout_output": None if args.dry_run or args.heldout_out is None else str(args.heldout_out),
        "public_count": sum(item.get("split") == "public" for item in document["candidates"]),
        "heldout_count": sum(item.get("split") == "held_out" for item in document["candidates"]),
        "caution": CAUTION,
    }
    if not args.dry_run:
        outputs = [
            (args.out, document),
            (args.public_out, document_for_split(document, "public")),
            (args.heldout_out, document_for_split(document, "held_out")),
        ]
        for target, payload in outputs:
            if target is None:
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
