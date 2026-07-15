"""Transactional local persistence for paid benchmark work.

SQLite is the source of truth.  A completed model response is committed in the
same transaction as the run progress counter, so interruption, provider credit
exhaustion, or a killed process loses at most the in-flight request.  JSON files
remain a derived dashboard/export format.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Iterator

from .conditions import Condition
from .report import PuzzleReport
from .tasks.puzzles import Puzzle, PuzzleResult
from .variants import ModelVariant


if TYPE_CHECKING:
    from .tasks.games import GameRecord


SCHEMA_VERSION = 3
DEFAULT_DB = Path("runs/chessbench.db")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


@dataclass(frozen=True)
class RunSpec:
    track: str
    variant: ModelVariant
    condition: Condition
    total_items: int
    suite_name: str | None = None
    suite_version: str | None = None
    suite_hash: str | None = None
    suite_visibility: str | None = None

    @property
    def natural_key(self) -> str:
        manifest = {
            "track": self.track,
            "variant": self.variant.to_dict(),
            "condition": self.condition.to_dict(),
            "suite_hash": self.suite_hash,
        }
        return hashlib.sha256(_canonical(manifest).encode()).hexdigest()


@dataclass(frozen=True)
class RunHandle:
    run_id: str
    status: str
    completed_items: int
    resumed: bool


_SCHEMA = """
CREATE TABLE IF NOT EXISTS model_variant (
  variant_key TEXT PRIMARY KEY,
  base_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  config_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS benchmark_run (
  run_id TEXT PRIMARY KEY,
  natural_key TEXT NOT NULL,
  track TEXT NOT NULL CHECK(track IN ('puzzle','woodpecker','composed','game','tournament')),
  variant_key TEXT NOT NULL REFERENCES model_variant(variant_key),
  condition_slug TEXT NOT NULL,
  condition_json TEXT NOT NULL,
  suite_name TEXT,
  suite_version TEXT,
  suite_hash TEXT,
  suite_visibility TEXT,
  status TEXT NOT NULL CHECK(status IN ('queued','running','partial','completed','failed')),
  total_items INTEGER NOT NULL,
  completed_items INTEGER NOT NULL DEFAULT 0,
  summary_json TEXT,
  cost_usd REAL NOT NULL DEFAULT 0,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  started_at TEXT,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  error TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_run_natural_current
  ON benchmark_run(natural_key) WHERE status != 'failed';
CREATE INDEX IF NOT EXISTS idx_run_status ON benchmark_run(status, updated_at);

CREATE TABLE IF NOT EXISTS puzzle_attempt (
  run_id TEXT NOT NULL REFERENCES benchmark_run(run_id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  puzzle_id TEXT NOT NULL,
  result_json TEXT NOT NULL,
  puzzle_json TEXT NOT NULL,
  latency_ms INTEGER,
  cost_usd REAL NOT NULL DEFAULT 0,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, puzzle_id),
  UNIQUE (run_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_puzzle_cross_run ON puzzle_attempt(puzzle_id, run_id);

CREATE TABLE IF NOT EXISTS benchmark_item (
  run_id TEXT NOT NULL REFERENCES benchmark_run(run_id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  item_id TEXT NOT NULL,
  points REAL NOT NULL,
  max_points REAL NOT NULL DEFAULT 1,
  solved INTEGER NOT NULL,
  first_move_legal INTEGER,
  response_format_valid INTEGER,
  failure_reason TEXT,
  payload_json TEXT NOT NULL,
  latency_ms INTEGER,
  cost_usd REAL NOT NULL DEFAULT 0,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, item_id),
  UNIQUE (run_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_benchmark_item_cross_run ON benchmark_item(item_id, run_id);

CREATE TABLE IF NOT EXISTS game (
  game_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES benchmark_run(run_id) ON DELETE CASCADE,
  pairing_key TEXT NOT NULL,
  white_variant TEXT NOT NULL,
  black_variant TEXT NOT NULL,
  opening_key TEXT NOT NULL,
  start_fen TEXT,
  status TEXT NOT NULL CHECK(status IN ('running','completed','failed')),
  result TEXT,
  termination TEXT,
  pgn TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(run_id, pairing_key)
);

CREATE TABLE IF NOT EXISTS game_move (
  game_id TEXT NOT NULL REFERENCES game(game_id) ON DELETE CASCADE,
  ply INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(game_id, ply)
);

CREATE TABLE IF NOT EXISTS run_event (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES benchmark_run(run_id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_delivery (
  run_id TEXT NOT NULL REFERENCES benchmark_run(run_id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  PRIMARY KEY(run_id, item_id)
);
"""

_SYNC_SCHEMA = """
CREATE TABLE IF NOT EXISTS sync_delivery (
  run_id TEXT NOT NULL REFERENCES benchmark_run(run_id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  PRIMARY KEY(run_id, item_id)
);
"""

_GENERIC_ITEM_SCHEMA = """
CREATE TABLE IF NOT EXISTS benchmark_item (
  run_id TEXT NOT NULL REFERENCES benchmark_run(run_id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  item_id TEXT NOT NULL,
  points REAL NOT NULL,
  max_points REAL NOT NULL DEFAULT 1,
  solved INTEGER NOT NULL,
  first_move_legal INTEGER,
  response_format_valid INTEGER,
  failure_reason TEXT,
  payload_json TEXT NOT NULL,
  latency_ms INTEGER,
  cost_usd REAL NOT NULL DEFAULT 0,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, item_id),
  UNIQUE (run_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_benchmark_item_cross_run ON benchmark_item(item_id, run_id);
"""


class BenchmarkStore:
    def __init__(self, path: str | Path = DEFAULT_DB) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(self.path, timeout=30, isolation_level=None)
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA foreign_keys = ON")
        self._db.execute("PRAGMA journal_mode = WAL")
        self._db.execute("PRAGMA synchronous = FULL")
        self._migrate()

    def __enter__(self) -> "BenchmarkStore":
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    def close(self) -> None:
        self._db.close()

    def _migrate(self) -> None:
        version = int(self._db.execute("PRAGMA user_version").fetchone()[0])
        if version > SCHEMA_VERSION:
            raise RuntimeError(
                f"database schema {version} is newer than supported {SCHEMA_VERSION}"
            )
        if version == 0:
            self._db.executescript(_SCHEMA)
            self._db.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        else:
            if version == 1:
                self._db.executescript(_SYNC_SCHEMA)
            if version < 3:
                self._db.executescript(_GENERIC_ITEM_SCHEMA)
            self._db.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")

    @contextmanager
    def _transaction(self) -> Iterator[None]:
        self._db.execute("BEGIN IMMEDIATE")
        try:
            yield
        except BaseException:
            self._db.execute("ROLLBACK")
            raise
        else:
            self._db.execute("COMMIT")

    def start_run(self, spec: RunSpec, *, force: bool = False) -> RunHandle:
        now = _now()
        natural_key = spec.natural_key
        if force:
            natural_key += ":replicate:" + uuid.uuid4().hex
        with self._transaction():
            self._db.execute(
                """INSERT INTO model_variant
                   (variant_key, base_key, display_name, provider, model_id, config_json, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(variant_key) DO UPDATE SET
                     display_name=excluded.display_name, config_json=excluded.config_json""",
                (
                    spec.variant.key,
                    spec.variant.base_key,
                    spec.variant.display_name,
                    spec.variant.provider,
                    spec.variant.model_id,
                    _canonical(spec.variant.to_dict()),
                    now,
                ),
            )
            row = self._db.execute(
                "SELECT run_id, status, completed_items FROM benchmark_run WHERE natural_key = ?",
                (natural_key,),
            ).fetchone()
            if row is not None:
                resumed = row["status"] != "completed"
                if resumed:
                    self._db.execute(
                        """UPDATE benchmark_run
                           SET status='running', started_at=COALESCE(started_at, ?), updated_at=?, error=NULL
                           WHERE run_id=?""",
                        (now, now, row["run_id"]),
                    )
                    self._event(
                        row["run_id"],
                        "resumed",
                        f"at item {row['completed_items']}",
                        now,
                    )
                return RunHandle(
                    row["run_id"], row["status"], row["completed_items"], resumed
                )

            run_id = uuid.uuid4().hex
            self._db.execute(
                """INSERT INTO benchmark_run
                   (run_id, natural_key, track, variant_key, condition_slug, condition_json,
                    suite_name, suite_version, suite_hash, suite_visibility, status,
                    total_items, created_at, started_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?)""",
                (
                    run_id,
                    natural_key,
                    spec.track,
                    spec.variant.key,
                    spec.condition.slug(),
                    _canonical(spec.condition.to_dict()),
                    spec.suite_name,
                    spec.suite_version,
                    spec.suite_hash,
                    spec.suite_visibility,
                    spec.total_items,
                    now,
                    now,
                    now,
                ),
            )
            self._event(run_id, "started", None, now)
            return RunHandle(run_id, "running", 0, False)

    def _event(
        self, run_id: str, kind: str, detail: str | None, now: str | None = None
    ) -> None:
        self._db.execute(
            "INSERT INTO run_event(run_id, kind, detail, created_at) VALUES (?, ?, ?, ?)",
            (run_id, kind, detail, now or _now()),
        )

    def load_puzzle_results(self, run_id: str) -> dict[str, PuzzleResult]:
        rows = self._db.execute(
            "SELECT puzzle_id, result_json FROM puzzle_attempt WHERE run_id=? ORDER BY sequence",
            (run_id,),
        ).fetchall()
        return {
            row["puzzle_id"]: PuzzleResult(**json.loads(row["result_json"]))
            for row in rows
        }

    def save_puzzle_result(
        self,
        run_id: str,
        sequence: int,
        puzzle: Puzzle,
        result: PuzzleResult,
        *,
        latency_ms: int | None = None,
        cost_usd: float = 0.0,
        prompt_tokens: int = 0,
        completion_tokens: int = 0,
        reasoning_tokens: int = 0,
    ) -> bool:
        now = _now()
        with self._transaction():
            cursor = self._db.execute(
                """INSERT OR IGNORE INTO puzzle_attempt
                   (run_id, sequence, puzzle_id, result_json, puzzle_json, latency_ms, cost_usd,
                    prompt_tokens, completion_tokens, reasoning_tokens, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    run_id,
                    sequence,
                    puzzle.id,
                    _canonical(asdict(result)),
                    _canonical(asdict(puzzle)),
                    latency_ms,
                    cost_usd,
                    prompt_tokens,
                    completion_tokens,
                    reasoning_tokens,
                    now,
                ),
            )
            inserted = cursor.rowcount == 1
            if inserted:
                self._db.execute(
                    """UPDATE benchmark_run SET
                         completed_items=completed_items+1,
                         cost_usd=cost_usd+?, prompt_tokens=prompt_tokens+?,
                         completion_tokens=completion_tokens+?, reasoning_tokens=reasoning_tokens+?,
                         updated_at=? WHERE run_id=?""",
                    (
                        cost_usd,
                        prompt_tokens,
                        completion_tokens,
                        reasoning_tokens,
                        now,
                        run_id,
                    ),
                )
                self._event(run_id, "item_completed", puzzle.id, now)
            return inserted

    def load_benchmark_items(self, run_id: str) -> dict[str, dict[str, object]]:
        rows = self._db.execute(
            "SELECT item_id, payload_json FROM benchmark_item WHERE run_id=? ORDER BY sequence",
            (run_id,),
        ).fetchall()
        return {str(row["item_id"]): json.loads(row["payload_json"]) for row in rows}

    def save_benchmark_item(
        self,
        run_id: str,
        sequence: int,
        item_id: str,
        payload: dict[str, object],
        *,
        points: float,
        max_points: float = 1.0,
        solved: bool,
        first_move_legal: bool | None = None,
        response_format_valid: bool | None = None,
        failure_reason: str | None = None,
        latency_ms: int | None = None,
        cost_usd: float = 0.0,
        prompt_tokens: int = 0,
        completion_tokens: int = 0,
        reasoning_tokens: int = 0,
    ) -> bool:
        """Commit one non-tactical benchmark item and its complete audit payload."""
        now = _now()
        with self._transaction():
            cursor = self._db.execute(
                """INSERT OR IGNORE INTO benchmark_item
                   (run_id, sequence, item_id, points, max_points, solved, first_move_legal,
                    response_format_valid, failure_reason, payload_json, latency_ms, cost_usd,
                    prompt_tokens, completion_tokens, reasoning_tokens, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    run_id,
                    sequence,
                    item_id,
                    points,
                    max_points,
                    int(solved),
                    None if first_move_legal is None else int(first_move_legal),
                    None
                    if response_format_valid is None
                    else int(response_format_valid),
                    failure_reason,
                    _canonical(payload),
                    latency_ms,
                    cost_usd,
                    prompt_tokens,
                    completion_tokens,
                    reasoning_tokens,
                    now,
                ),
            )
            inserted = cursor.rowcount == 1
            if inserted:
                self._db.execute(
                    """UPDATE benchmark_run SET
                         completed_items=completed_items+1,
                         cost_usd=cost_usd+?, prompt_tokens=prompt_tokens+?,
                         completion_tokens=completion_tokens+?, reasoning_tokens=reasoning_tokens+?,
                         updated_at=? WHERE run_id=?""",
                    (
                        cost_usd,
                        prompt_tokens,
                        completion_tokens,
                        reasoning_tokens,
                        now,
                        run_id,
                    ),
                )
                self._event(run_id, "item_completed", item_id, now)
            return inserted

    def save_game_result(
        self, run_id: str, sequence: int, record: "GameRecord"
    ) -> bool:
        """Commit a completed game and both players' separate turn transcripts."""
        game_id = f"{run_id}:game:{sequence}"
        pairing_key = f"game:{sequence}"
        now = _now()
        prompt_tokens = sum(
            attempt.prompt_tokens
            for move in record.records
            for attempt in move.attempts
        )
        completion_tokens = sum(
            attempt.completion_tokens
            for move in record.records
            for attempt in move.attempts
        )
        reasoning_tokens = sum(
            attempt.reasoning_tokens
            for move in record.records
            for attempt in move.attempts
        )
        cost_usd = sum(
            attempt.cost_usd for move in record.records for attempt in move.attempts
        )
        with self._transaction():
            cursor = self._db.execute(
                """INSERT OR IGNORE INTO game
                   (game_id, run_id, pairing_key, white_variant, black_variant, opening_key,
                    start_fen, status, result, termination, pgn, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?)""",
                (
                    game_id,
                    run_id,
                    pairing_key,
                    record.white,
                    record.black,
                    "standard" if record.start_fen is None else record.start_fen,
                    record.start_fen,
                    record.result,
                    record.termination,
                    record.pgn,
                    now,
                    now,
                ),
            )
            inserted = cursor.rowcount == 1
            if inserted:
                for move_sequence, move in enumerate(record.records):
                    self._db.execute(
                        """INSERT INTO game_move (game_id, ply, payload_json, created_at)
                           VALUES (?, ?, ?, ?)""",
                        (game_id, move_sequence, _canonical(asdict(move)), now),
                    )
                self._db.execute(
                    """UPDATE benchmark_run SET completed_items=completed_items+1,
                       cost_usd=cost_usd+?, prompt_tokens=prompt_tokens+?,
                       completion_tokens=completion_tokens+?, reasoning_tokens=reasoning_tokens+?,
                       updated_at=? WHERE run_id=?""",
                    (
                        cost_usd,
                        prompt_tokens,
                        completion_tokens,
                        reasoning_tokens,
                        now,
                        run_id,
                    ),
                )
                self._event(run_id, "game_completed", pairing_key, now)
            return inserted

    def load_game_results(self, run_id: str) -> dict[int, "GameRecord"]:
        from .tasks.games import GameRecord, MoveAttempt, MoveRecord

        games = self._db.execute(
            "SELECT * FROM game WHERE run_id=? AND status='completed'",
            (run_id,),
        ).fetchall()
        results: dict[int, GameRecord] = {}
        for game in games:
            move_rows = self._db.execute(
                "SELECT payload_json FROM game_move WHERE game_id=? ORDER BY ply",
                (game["game_id"],),
            ).fetchall()
            records: list[MoveRecord] = []
            for move_row in move_rows:
                payload = json.loads(move_row["payload_json"])
                payload["attempts"] = [
                    MoveAttempt(**attempt) for attempt in payload.get("attempts", [])
                ]
                records.append(MoveRecord(**payload))
            sequence = int(str(game["pairing_key"]).split(":", 1)[1])
            results[sequence] = GameRecord(
                white=game["white_variant"],
                black=game["black_variant"],
                result=game["result"],
                termination=game["termination"],
                plies=sum(record.san is not None for record in records),
                moves_san=[record.san for record in records if record.san is not None],
                records=records,
                pgn=game["pgn"],
                start_fen=game["start_fen"],
            )
        return results

    def finalize_run(self, run_id: str, summary: dict[str, object]) -> None:
        """Finalize any generic/composed/game run after every item is durable."""
        now = _now()
        with self._transaction():
            row = self._db.execute(
                "SELECT total_items, completed_items FROM benchmark_run WHERE run_id=?",
                (run_id,),
            ).fetchone()
            if row is None:
                raise KeyError(run_id)
            if row["completed_items"] != row["total_items"]:
                raise RuntimeError(
                    f"cannot complete run {run_id}: "
                    f"{row['completed_items']}/{row['total_items']} items persisted"
                )
            self._db.execute(
                """UPDATE benchmark_run SET status='completed', summary_json=?,
                   completed_at=?, updated_at=?, error=NULL WHERE run_id=?""",
                (_canonical(summary), now, now, run_id),
            )
            self._event(run_id, "completed", None, now)

    def finalize_puzzle_run(
        self, run_id: str, report: PuzzleReport, *, cost_usd: float | None = None
    ) -> None:
        summary = {
            "n": report.n,
            "solved": report.solved,
            "solve_rate": report.solve_rate,
            "mean_score": report.mean_score,
            "first_move_legal_rate": report.first_move_legal_rate,
            "response_format_valid_rate": report.response_format_valid_rate,
            "points": report.points,
            "max_points": report.max_points,
        }
        now = _now()
        with self._transaction():
            row = self._db.execute(
                "SELECT total_items, completed_items FROM benchmark_run WHERE run_id=?",
                (run_id,),
            ).fetchone()
            if row is None:
                raise KeyError(run_id)
            if row["completed_items"] != row["total_items"]:
                raise RuntimeError(
                    f"cannot complete run {run_id}: {row['completed_items']}/{row['total_items']} items persisted"
                )
            if cost_usd is None:
                self._db.execute(
                    """UPDATE benchmark_run SET status='completed', summary_json=?,
                       completed_at=?, updated_at=?, error=NULL WHERE run_id=?""",
                    (_canonical(summary), now, now, run_id),
                )
            else:
                self._db.execute(
                    """UPDATE benchmark_run SET status='completed', summary_json=?, cost_usd=?,
                       completed_at=?, updated_at=?, error=NULL WHERE run_id=?""",
                    (_canonical(summary), cost_usd, now, now, run_id),
                )
            self._event(run_id, "completed", None, now)

    def mark_partial(self, run_id: str, error: str) -> None:
        now = _now()
        with self._transaction():
            self._db.execute(
                "UPDATE benchmark_run SET status='partial', error=?, updated_at=? WHERE run_id=?",
                (error[:2000], now, run_id),
            )
            self._event(run_id, "interrupted", error[:500], now)

    def run_row(self, run_id: str) -> dict[str, object]:
        row = self._db.execute(
            "SELECT * FROM benchmark_run WHERE run_id=?", (run_id,)
        ).fetchone()
        if row is None:
            raise KeyError(run_id)
        return dict(row)

    def list_runs(self) -> list[dict[str, object]]:
        rows = self._db.execute(
            """SELECT r.*, v.display_name, v.model_id, v.config_json AS variant_json
               FROM benchmark_run r JOIN model_variant v USING(variant_key)
               ORDER BY r.created_at DESC"""
        ).fetchall()
        return [dict(row) for row in rows]

    def run_start_document(self, run_id: str) -> dict[str, object]:
        row = self._db.execute(
            """SELECT r.*, v.config_json AS variant_json
               FROM benchmark_run r JOIN model_variant v USING(variant_key)
               WHERE run_id=?""",
            (run_id,),
        ).fetchone()
        if row is None:
            raise KeyError(run_id)
        return {
            "run_id": row["run_id"],
            "track": "esoteric" if row["track"] == "composed" else row["track"],
            "model_variant": json.loads(row["variant_json"]),
            "condition": json.loads(row["condition_json"]),
            "suite": {
                "name": row["suite_name"],
                "version": row["suite_version"],
                "content_hash": row["suite_hash"],
                "visibility": row["suite_visibility"],
            }
            if row["suite_name"]
            else None,
            "total_items": row["total_items"],
            "created_at": row["created_at"],
        }

    def unsynced_item_documents(self, run_id: str) -> list[dict[str, object]]:
        from .categories import categorize_puzzle
        from .store import _position_fields

        rows = self._db.execute(
            """SELECT a.* FROM puzzle_attempt a
               LEFT JOIN sync_delivery d ON d.run_id=a.run_id AND d.item_id=a.puzzle_id
               WHERE a.run_id=? AND d.item_id IS NULL ORDER BY a.sequence""",
            (run_id,),
        ).fetchall()
        docs: list[dict[str, object]] = []
        for row in rows:
            result = json.loads(row["result_json"])
            puzzle_data = json.loads(row["puzzle_json"])
            puzzle = Puzzle(**puzzle_data)
            payload = {
                **result,
                **_position_fields(puzzle),
                "categories": categorize_puzzle(result["themes"], result["rating"]),
            }
            docs.append(
                {
                    "run_id": run_id,
                    "item_id": row["puzzle_id"],
                    "sequence": row["sequence"],
                    "points": result["score"],
                    "max_points": 1,
                    "solved": result["solved"],
                    "first_move_legal": result["first_move_legal"],
                    "response_format_valid": result.get("answer_response_format_valid"),
                    "failure_reason": result["failure_reason"],
                    "latency_ms": row["latency_ms"],
                    "cost_usd": row["cost_usd"],
                    "prompt_tokens": row["prompt_tokens"],
                    "completion_tokens": row["completion_tokens"],
                    "reasoning_tokens": row["reasoning_tokens"],
                    "payload": payload,
                }
            )
        generic_rows = self._db.execute(
            """SELECT a.* FROM benchmark_item a
               LEFT JOIN sync_delivery d ON d.run_id=a.run_id AND d.item_id=a.item_id
               WHERE a.run_id=? AND d.item_id IS NULL ORDER BY a.sequence""",
            (run_id,),
        ).fetchall()
        for row in generic_rows:
            docs.append(
                {
                    "run_id": run_id,
                    "item_id": row["item_id"],
                    "sequence": row["sequence"],
                    "points": row["points"],
                    "max_points": row["max_points"],
                    "solved": bool(row["solved"]),
                    "first_move_legal": None
                    if row["first_move_legal"] is None
                    else bool(row["first_move_legal"]),
                    "response_format_valid": None
                    if row["response_format_valid"] is None
                    else bool(row["response_format_valid"]),
                    "failure_reason": row["failure_reason"],
                    "latency_ms": row["latency_ms"],
                    "cost_usd": row["cost_usd"],
                    "prompt_tokens": row["prompt_tokens"],
                    "completion_tokens": row["completion_tokens"],
                    "reasoning_tokens": row["reasoning_tokens"],
                    "payload": json.loads(row["payload_json"]),
                }
            )
        docs.sort(key=lambda item: int(str(item["sequence"])))
        return docs

    def mark_item_synced(self, run_id: str, item_id: str) -> None:
        self._db.execute(
            "INSERT OR REPLACE INTO sync_delivery(run_id, item_id, synced_at) VALUES (?, ?, ?)",
            (run_id, item_id, _now()),
        )

    def run_finish_document(self, run_id: str) -> dict[str, object]:
        row = self._db.execute(
            "SELECT status, error FROM benchmark_run WHERE run_id=?", (run_id,)
        ).fetchone()
        if row is None:
            raise KeyError(run_id)
        status = row["status"]
        remote_status = (
            "completed"
            if status == "completed"
            else "failed"
            if status == "failed"
            else "partial"
        )
        return {"run_id": run_id, "status": remote_status, "error": row["error"]}
