#!/usr/bin/env python3
"""Build the 100,000-item calibrated pool for randomized rated sessions."""

from __future__ import annotations

import argparse
import csv
import hashlib
import heapq
import json
import subprocess
import sys
import tempfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from chessbench.categories import categorize_puzzle, profile_families  # noqa: E402
from chessbench.corpus import load_corpus, validate_puzzle  # noqa: E402
from chessbench.rated_pool import RATED_LICHESS_V1_BANDS, rated_pool_band  # noqa: E402
from chessbench.sources.lichess import lichess_rows, puzzle_from_row  # noqa: E402


NAME = "rated-lichess-v1"
VERSION = "1.0.0"
SEED = 20260717
SNAPSHOT = "2026-07-05"
SOURCE_SHA256 = "5503bfaf5534518ffe3c4c3bb0ac1ae82350d117ad1a52947796096b75e6247e"
DEFAULT_SOURCE = ROOT / "data/lichess_db_puzzle_2026-07-05.csv.zst"
DEFAULT_TARGET = ROOT / "corpora/pools/rated-lichess-v1.csv.zst"
DEFAULT_MANIFEST = ROOT / "corpora/pools/rated-lichess-v1.manifest.json"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _priority(puzzle_id: str) -> int:
    digest = hashlib.sha256(f"{NAME}:{SEED}:{puzzle_id}".encode()).digest()
    return int.from_bytes(digest, "big")


def _game_key(url: str) -> str:
    return url.split("#", 1)[0]


def _blocked_membership() -> tuple[set[str], set[str], list[dict[str, object]]]:
    ids: set[str] = set()
    games: set[str] = set()
    releases: list[dict[str, object]] = []
    paths = [
        *(ROOT / "corpora/public").glob("*.json"),
        *(ROOT / "corpora/private").glob("*.json"),
    ]
    for path in sorted(paths):
        corpus = load_corpus(path)
        if corpus.item_type != "puzzle":
            continue
        for puzzle in corpus.puzzles():
            ids.add(puzzle.id)
            games.add(_game_key(puzzle.game_url))
        releases.append(
            {
                "name": corpus.name,
                "content_hash": corpus.content_hash,
                "items": len(corpus.items),
            }
        )
    return ids, games, releases


def _quantile(values: list[int], fraction: float) -> int:
    values.sort()
    return values[round((len(values) - 1) * fraction)]


def _write_artifact(rows: list[dict[str, str]], header: list[str], target: Path) -> tuple[str, str]:
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w",
        newline="",
        encoding="utf-8",
        suffix=".csv",
        delete=False,
    ) as handle:
        temporary = Path(handle.name)
        writer = csv.DictWriter(handle, fieldnames=header, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    try:
        uncompressed_sha256 = _sha256(temporary)
        subprocess.run(
            ["zstd", "-q", "-19", "-T1", "-f", str(temporary), "-o", str(target)],
            check=True,
        )
    finally:
        temporary.unlink(missing_ok=True)
    return uncompressed_sha256, _sha256(target)


def build(source: Path, target: Path, manifest_path: Path) -> dict[str, object]:
    if _sha256(source) != SOURCE_SHA256:
        raise ValueError(f"source snapshot hash does not match {SOURCE_SHA256}")
    blocked_ids, blocked_games, excluded_releases = _blocked_membership()
    heaps: dict[int, list[tuple[int, str, dict[str, str]]]] = {
        band.low: [] for band in RATED_LICHESS_V1_BANDS
    }
    eligible: Counter[str] = Counter()
    scanned = 0
    header: list[str] = []

    with lichess_rows(source) as rows:
        for row in rows:
            scanned += 1
            if not header:
                header = list(row)
            try:
                puzzle = puzzle_from_row(row)
            except (KeyError, TypeError, ValueError):
                continue
            band = rated_pool_band(puzzle.rating)
            if band is None or not band.accepts(puzzle):
                continue
            if puzzle.id in blocked_ids or _game_key(puzzle.game_url) in blocked_games:
                continue
            label = f"{band.low}-{band.high - 1}"
            eligible[label] += 1
            priority = _priority(puzzle.id)
            heap = heaps[band.low]
            entry = (-priority, puzzle.id, row)
            # Keep a deterministic reserve so the final pass can discard the
            # occasional duplicate source game or shown position without ever
            # weakening a band's admission gate.
            capacity = band.target + max(100, band.target // 20)
            if len(heap) < capacity:
                heapq.heappush(heap, entry)
            elif (priority, puzzle.id) < (-heap[0][0], heap[0][1]):
                heapq.heapreplace(heap, entry)
            if scanned % 500_000 == 0:
                retained = sum(len(items) for items in heaps.values())
                print(
                    f"scanned {scanned:,}; eligible {sum(eligible.values()):,}; retained {retained:,}",
                    file=sys.stderr,
                )

    selected: list[dict[str, str]] = []
    selected_ids: set[str] = set()
    selected_games: set[str] = set()
    selected_positions: set[str] = set()
    for band in RATED_LICHESS_V1_BANDS:
        chosen_for_band = 0
        candidates = sorted(
            (entry[2] for entry in heaps[band.low]),
            key=lambda row: (_priority(row["PuzzleId"]), row["PuzzleId"]),
        )
        for row in candidates:
            puzzle = puzzle_from_row(row)
            errors, shown_position = validate_puzzle(puzzle)
            if errors:
                raise ValueError(f"{puzzle.id} failed validation: {'; '.join(errors)}")
            game = _game_key(puzzle.game_url)
            if (
                puzzle.id in selected_ids
                or game in selected_games
                or shown_position in selected_positions
            ):
                continue
            selected.append(row)
            selected_ids.add(puzzle.id)
            selected_games.add(game)
            if shown_position is not None:
                selected_positions.add(shown_position)
            chosen_for_band += 1
            if chosen_for_band == band.target:
                break
    selected.sort(key=lambda row: (int(row["Rating"]), row["PuzzleId"]))
    expected = sum(band.target for band in RATED_LICHESS_V1_BANDS)
    if len(selected) != expected:
        raise ValueError(f"selected {len(selected):,} puzzles; expected {expected:,}")

    ids: set[str] = set()
    games: set[str] = set()
    positions: set[str] = set()
    ratings: list[int] = []
    deviations: list[int] = []
    plays: list[int] = []
    popularity: list[int] = []
    themes: Counter[str] = Counter()
    category_counts: dict[str, Counter[str]] = {}
    profile_family_counts: Counter[str] = Counter()
    solver_plies: Counter[int] = Counter()
    selected_counts: Counter[str] = Counter()
    for row in selected:
        puzzle = puzzle_from_row(row)
        errors, shown_position = validate_puzzle(puzzle)
        if errors:
            raise ValueError(f"{puzzle.id} failed validation: {'; '.join(errors)}")
        game = _game_key(puzzle.game_url)
        if puzzle.id in ids or game in games or shown_position in positions:
            raise ValueError(f"duplicate membership, source game, or shown position: {puzzle.id}")
        ids.add(puzzle.id)
        games.add(game)
        if shown_position is not None:
            positions.add(shown_position)
        band = rated_pool_band(puzzle.rating)
        assert band is not None and band.accepts(puzzle)
        selected_counts[f"{band.low}-{band.high - 1}"] += 1
        ratings.append(puzzle.rating)
        deviations.append(puzzle.rating_deviation)
        plays.append(puzzle.nb_plays)
        popularity.append(puzzle.popularity)
        themes.update(puzzle.themes)
        for dimension, values in categorize_puzzle(puzzle.themes, puzzle.rating).items():
            bucket = category_counts.setdefault(dimension, Counter())
            bucket.update(values)
        profile_family_counts.update(profile_families(puzzle.themes))
        solver_plies[puzzle.num_solver_plies()] += 1

    for band in RATED_LICHESS_V1_BANDS:
        label = f"{band.low}-{band.high - 1}"
        if selected_counts[label] != band.target:
            raise ValueError(f"{label} has {selected_counts[label]} items; expected {band.target}")

    uncompressed_sha256, artifact_sha256 = _write_artifact(selected, header, target)
    manifest = {
        "schema": "chessbench.rated_puzzle_pool.v1",
        "name": NAME,
        "title": "Rated sessions — calibrated Lichess pool v1",
        "version": VERSION,
        "visibility": "public",
        "item_type": "puzzle",
        "session_protocol": "adaptive_glicko2",
        "description": (
            "A 100,000-position, content-addressed Lichess puzzle pool for randomized "
            "adaptive rating sessions. Dense bands require at least 1,000 human plays "
            "and RD at most 90; only the scarce rating extremes use documented relaxations."
        ),
        "items": len(selected),
        "content_hash": f"sha256:{uncompressed_sha256[:20]}",
        "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": {
            "title": "Lichess puzzle database",
            "url": "https://database.lichess.org/#puzzles",
            "license": "CC0-1.0",
            "license_url": "https://creativecommons.org/publicdomain/zero/1.0/",
            "snapshot": SNAPSHOT,
            "source_sha256": SOURCE_SHA256,
            "scanned": scanned,
        },
        "artifact": {
            "file": target.name,
            "format": "lichess_csv_zstd",
            "sha256": artifact_sha256,
            "uncompressed_sha256": uncompressed_sha256,
            "bytes": target.stat().st_size,
        },
        "selection": {
            "algorithm": "lowest-stable-sha256-priority-per-rating-band",
            "seed": SEED,
            "one_puzzle_per_source_game": True,
            "excluded_releases": excluded_releases,
            "bands": [
                {
                    "rating": [band.low, band.high],
                    "target": band.target,
                    "eligible": eligible[f"{band.low}-{band.high - 1}"],
                    "minimum_plays": band.minimum_plays,
                    "maximum_rating_deviation": band.maximum_rating_deviation,
                    "minimum_popularity": band.minimum_popularity,
                }
                for band in RATED_LICHESS_V1_BANDS
            ],
        },
        "validation": {
            "valid": True,
            "unique_ids": len(ids),
            "unique_source_games": len(games),
            "unique_positions": len(positions),
            "rating": {
                "min": min(ratings),
                "p25": _quantile(ratings, 0.25),
                "median": _quantile(ratings, 0.5),
                "p75": _quantile(ratings, 0.75),
                "max": max(ratings),
            },
            "rating_deviation": {
                "min": min(deviations),
                "median": _quantile(deviations, 0.5),
                "p95": _quantile(deviations, 0.95),
                "max": max(deviations),
            },
            "plays": {
                "min": min(plays),
                "median": _quantile(plays, 0.5),
                "p95": _quantile(plays, 0.95),
                "max": max(plays),
            },
            "popularity": {
                "min": min(popularity),
                "median": _quantile(popularity, 0.5),
            },
            "selected_by_rating_band": dict(selected_counts),
            "solver_plies": {str(key): value for key, value in sorted(solver_plies.items())},
            "theme_counts": dict(themes.most_common()),
            "category_counts": {
                dimension: dict(counts.most_common())
                for dimension, counts in sorted(category_counts.items())
            },
            "profile_family_counts": dict(profile_family_counts.most_common()),
        },
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=1) + "\n", encoding="utf-8")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--out", type=Path, default=DEFAULT_TARGET)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    args = parser.parse_args()
    manifest = build(args.source, args.out, args.manifest)
    print(
        f"{manifest['name']}: {manifest['items']:,} puzzles, {manifest['content_hash']}"
    )
    print(f"artifact: {args.out} ({args.out.stat().st_size / 1024 / 1024:.2f} MiB)")
    print(f"manifest: {args.manifest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
