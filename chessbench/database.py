"""Transactional local persistence for paid benchmark work.

SQLite is the source of truth.  A completed model response is committed in the
same transaction as the run progress counter, so interruption, provider credit
exhaustion, or a killed process loses at most the in-flight request.  JSON files
remain a derived dashboard/export format.
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, IO, Iterator

import fcntl

from .conditions import Condition
from .report import PuzzleReport
from .tasks.puzzles import Puzzle, PuzzleCheckpoint, PuzzleResult
from .variants import ModelVariant


if TYPE_CHECKING:
    from .tasks.games import GameRecord, MoveRecord


SCHEMA_VERSION = 5
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


class RunBusyError(RuntimeError):
    """Raised before paid work when another process owns the same run."""


class RunExecutionLock:
    """Process-scoped advisory lock for one durable natural-key run.

    The descriptor stays open for the complete executor lifetime. ``flock`` is
    released by the kernel on normal close *and* abrupt process termination, so
    a killed runner cannot leave a stale lease that blocks an immediate resume.
    """

    def __init__(self, run_id: str, path: Path, file: IO[str]) -> None:
        self.run_id = run_id
        self.path = path
        self._file = file

    @property
    def closed(self) -> bool:
        return self._file.closed

    def close(self) -> None:
        if self._file.closed:
            return
        try:
            fcntl.flock(self._file.fileno(), fcntl.LOCK_UN)
        finally:
            self._file.close()

    def __enter__(self) -> "RunExecutionLock":
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()


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
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  uncached_prompt_tokens INTEGER NOT NULL DEFAULT 0,
  cache_discount_usd REAL NOT NULL DEFAULT 0,
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
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  uncached_prompt_tokens INTEGER NOT NULL DEFAULT 0,
  cache_discount_usd REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, puzzle_id),
  UNIQUE (run_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_puzzle_cross_run ON puzzle_attempt(puzzle_id, run_id);

CREATE TABLE IF NOT EXISTS puzzle_checkpoint (
  run_id TEXT NOT NULL REFERENCES benchmark_run(run_id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  puzzle_id TEXT NOT NULL,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (run_id, puzzle_id),
  UNIQUE (run_id, sequence)
);

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
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  uncached_prompt_tokens INTEGER NOT NULL DEFAULT 0,
  cache_discount_usd REAL NOT NULL DEFAULT 0,
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

_PUZZLE_CHECKPOINT_SCHEMA = """
CREATE TABLE IF NOT EXISTS puzzle_checkpoint (
  run_id TEXT NOT NULL REFERENCES benchmark_run(run_id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  puzzle_id TEXT NOT NULL,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (run_id, puzzle_id),
  UNIQUE (run_id, sequence)
);
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
        self._run_locks: dict[str, RunExecutionLock] = {}
        self._migrate()

    def __enter__(self) -> "BenchmarkStore":
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    def close(self) -> None:
        for lock in self._run_locks.values():
            lock.close()
        self._run_locks.clear()
        self._db.close()

    def acquire_run_lock(self, run_id: str) -> RunExecutionLock:
        """Prevent concurrent executors from duplicating paid provider calls.

        SQLite transactions make writes exact-once, but they cannot by
        themselves protect the time between reading a checkpoint and receiving
        the next provider response. The official paid runners hold this lock
        across that whole interval. The persistent file is only an inode for
        the kernel lock; it is deliberately not deleted on release, avoiding a
        replace/unlink race between contenders.
        """
        existing = self._run_locks.get(run_id)
        if existing is not None and not existing.closed:
            return existing
        present = self._db.execute(
            "SELECT 1 FROM benchmark_run WHERE run_id=?", (run_id,)
        ).fetchone()
        if present is None:
            raise KeyError(f"unknown run {run_id}")

        lock_dir = self.path.parent / ".locks"
        lock_dir.mkdir(parents=True, exist_ok=True)
        database_key = hashlib.sha256(
            str(self.path.resolve()).encode()
        ).hexdigest()[:12]
        path = lock_dir / f"{database_key}--{run_id}.lock"
        file = path.open("a+", encoding="utf-8")
        try:
            fcntl.flock(file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            file.seek(0)
            owner = file.read().strip() or "another executor"
            file.close()
            raise RunBusyError(
                f"durable run {run_id} is already executing ({owner}); "
                "wait for it to finish or terminate that runner before resuming"
            ) from exc

        file.seek(0)
        file.truncate()
        file.write(f"pid {os.getpid()}, acquired {_now()}")
        file.flush()
        lock = RunExecutionLock(run_id, path, file)
        self._run_locks[run_id] = lock
        return lock

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
            if version < 4:
                self._db.executescript(_PUZZLE_CHECKPOINT_SCHEMA)
            if version < 5:
                self._migrate_cache_usage()
            self._db.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")

    def _migrate_cache_usage(self) -> None:
        """Add v5 fields idempotently, including partially migrated databases."""
        definitions = {
            "cache_read_tokens": "INTEGER NOT NULL DEFAULT 0",
            "cache_write_tokens": "INTEGER NOT NULL DEFAULT 0",
            "uncached_prompt_tokens": "INTEGER NOT NULL DEFAULT 0",
            "cache_discount_usd": "REAL NOT NULL DEFAULT 0",
        }
        for table in ("benchmark_run", "puzzle_attempt", "benchmark_item"):
            present = {
                str(row[1])
                for row in self._db.execute(f"PRAGMA table_info({table})").fetchall()
            }
            for column, definition in definitions.items():
                if column not in present:
                    self._db.execute(
                        f"ALTER TABLE {table} ADD COLUMN {column} {definition}"
                    )

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

    def find_run(self, spec: RunSpec) -> RunHandle | None:
        """Return the current durable run without changing status or history."""
        row = self._db.execute(
            """SELECT run_id, status, completed_items
               FROM benchmark_run
               WHERE natural_key = ? AND status != 'failed'
               ORDER BY created_at DESC LIMIT 1""",
            (spec.natural_key,),
        ).fetchone()
        if row is None:
            return None
        return RunHandle(
            row["run_id"],
            row["status"],
            row["completed_items"],
            row["status"] != "completed",
        )

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
                """SELECT run_id, status, completed_items
                   FROM benchmark_run
                   WHERE natural_key = ? AND status != 'failed'
                   ORDER BY created_at DESC LIMIT 1""",
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

    def load_puzzle_checkpoints(self, run_id: str) -> dict[str, PuzzleCheckpoint]:
        """Load incomplete and terminal pre-item puzzle checkpoints."""
        rows = self._db.execute(
            "SELECT puzzle_id, state_json FROM puzzle_checkpoint WHERE run_id=? ORDER BY sequence",
            (run_id,),
        ).fetchall()
        checkpoints: dict[str, PuzzleCheckpoint] = {}
        for row in rows:
            state = json.loads(row["state_json"])
            terminal = state.get("terminal_result")
            if isinstance(terminal, dict):
                state["terminal_result"] = PuzzleResult(**terminal)
            checkpoints[row["puzzle_id"]] = PuzzleCheckpoint(**state)
        return checkpoints

    def save_puzzle_checkpoint(
        self,
        run_id: str,
        sequence: int,
        puzzle_id: str,
        checkpoint: PuzzleCheckpoint,
    ) -> bool:
        """Durably replace one puzzle's state without charging run totals."""
        if checkpoint.puzzle_id != puzzle_id:
            raise ValueError(
                f"checkpoint for {checkpoint.puzzle_id!r} cannot be saved as {puzzle_id!r}"
            )
        now = _now()
        with self._transaction():
            completed = self._db.execute(
                "SELECT 1 FROM puzzle_attempt WHERE run_id=? AND puzzle_id=?",
                (run_id, puzzle_id),
            ).fetchone()
            if completed is not None:
                self._db.execute(
                    "DELETE FROM puzzle_checkpoint WHERE run_id=? AND puzzle_id=?",
                    (run_id, puzzle_id),
                )
                return False
            self._db.execute(
                """INSERT INTO puzzle_checkpoint
                   (run_id, sequence, puzzle_id, state_json, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?)
                   ON CONFLICT(run_id, puzzle_id) DO UPDATE SET
                     sequence=excluded.sequence,
                     state_json=excluded.state_json,
                     updated_at=excluded.updated_at""",
                (
                    run_id,
                    sequence,
                    puzzle_id,
                    _canonical(asdict(checkpoint)),
                    now,
                    now,
                ),
            )
            return True

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
        cache_read_tokens: int = 0,
        cache_write_tokens: int = 0,
        uncached_prompt_tokens: int = 0,
        cache_discount_usd: float = 0.0,
    ) -> bool:
        now = _now()
        with self._transaction():
            cursor = self._db.execute(
                """INSERT OR IGNORE INTO puzzle_attempt
                   (run_id, sequence, puzzle_id, result_json, puzzle_json, latency_ms, cost_usd,
                    prompt_tokens, completion_tokens, reasoning_tokens, cache_read_tokens,
                    cache_write_tokens, uncached_prompt_tokens, cache_discount_usd, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
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
                    cache_read_tokens,
                    cache_write_tokens,
                    uncached_prompt_tokens,
                    cache_discount_usd,
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
                         cache_read_tokens=cache_read_tokens+?,
                         cache_write_tokens=cache_write_tokens+?,
                         uncached_prompt_tokens=uncached_prompt_tokens+?,
                         cache_discount_usd=cache_discount_usd+?,
                         updated_at=? WHERE run_id=?""",
                    (
                        cost_usd,
                        prompt_tokens,
                        completion_tokens,
                        reasoning_tokens,
                        cache_read_tokens,
                        cache_write_tokens,
                        uncached_prompt_tokens,
                        cache_discount_usd,
                        now,
                        run_id,
                    ),
                )
                self._event(run_id, "item_completed", puzzle.id, now)
            # The completed item and checkpoint removal share one transaction.
            # This also cleans a stale checkpoint after an idempotent re-save.
            self._db.execute(
                "DELETE FROM puzzle_checkpoint WHERE run_id=? AND puzzle_id=?",
                (run_id, puzzle.id),
            )
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
        cache_read_tokens: int = 0,
        cache_write_tokens: int = 0,
        uncached_prompt_tokens: int = 0,
        cache_discount_usd: float = 0.0,
    ) -> bool:
        """Commit one non-tactical benchmark item and its complete audit payload."""
        now = _now()
        with self._transaction():
            cursor = self._db.execute(
                """INSERT OR IGNORE INTO benchmark_item
                   (run_id, sequence, item_id, points, max_points, solved, first_move_legal,
                    response_format_valid, failure_reason, payload_json, latency_ms, cost_usd,
                    prompt_tokens, completion_tokens, reasoning_tokens, cache_read_tokens,
                    cache_write_tokens, uncached_prompt_tokens, cache_discount_usd, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
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
                    cache_read_tokens,
                    cache_write_tokens,
                    uncached_prompt_tokens,
                    cache_discount_usd,
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
                         cache_read_tokens=cache_read_tokens+?,
                         cache_write_tokens=cache_write_tokens+?,
                         uncached_prompt_tokens=uncached_prompt_tokens+?,
                         cache_discount_usd=cache_discount_usd+?,
                         updated_at=? WHERE run_id=?""",
                    (
                        cost_usd,
                        prompt_tokens,
                        completion_tokens,
                        reasoning_tokens,
                        cache_read_tokens,
                        cache_write_tokens,
                        uncached_prompt_tokens,
                        cache_discount_usd,
                        now,
                        run_id,
                    ),
                )
                self._event(run_id, "item_completed", item_id, now)
            return inserted

    @staticmethod
    def _game_identity(run_id: str, sequence: int) -> tuple[str, str]:
        return f"{run_id}:game:{sequence}", f"game:{sequence}"

    def _insert_running_game(
        self,
        run_id: str,
        sequence: int,
        white: str,
        black: str,
        start_fen: str | None,
        now: str,
    ) -> bool:
        game_id, pairing_key = self._game_identity(run_id, sequence)
        cursor = self._db.execute(
            """INSERT OR IGNORE INTO game
               (game_id, run_id, pairing_key, white_variant, black_variant, opening_key,
                start_fen, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)""",
            (
                game_id,
                run_id,
                pairing_key,
                white,
                black,
                "standard" if start_fen is None else start_fen,
                start_fen,
                now,
                now,
            ),
        )
        return cursor.rowcount == 1

    def start_game(
        self,
        run_id: str,
        sequence: int,
        white: str,
        black: str,
        start_fen: str | None,
    ) -> bool:
        """Create a durable running-game row before the first provider call."""
        now = _now()
        with self._transaction():
            inserted = self._insert_running_game(
                run_id, sequence, white, black, start_fen, now
            )
            if inserted:
                self._event(run_id, "game_started", f"game:{sequence}", now)
            return inserted

    def save_game_progress(
        self,
        run_id: str,
        sequence: int,
        white: str,
        black: str,
        start_fen: str | None,
        records: list["MoveRecord"],
    ) -> bool:
        """Upsert the latest move/attempt envelope without charging run totals."""
        if not records:
            return self.start_game(run_id, sequence, white, black, start_fen)
        game_id, pairing_key = self._game_identity(run_id, sequence)
        now = _now()
        with self._transaction():
            self._insert_running_game(run_id, sequence, white, black, start_fen, now)
            row = self._db.execute(
                "SELECT status FROM game WHERE game_id=?", (game_id,)
            ).fetchone()
            if row is None or row["status"] == "completed":
                return False
            move_sequence = len(records) - 1
            self._db.execute(
                """INSERT INTO game_move (game_id, ply, payload_json, created_at)
                   VALUES (?, ?, ?, ?)
                   ON CONFLICT(game_id, ply) DO UPDATE SET
                     payload_json=excluded.payload_json""",
                (game_id, move_sequence, _canonical(asdict(records[-1])), now),
            )
            self._db.execute(
                "UPDATE game SET updated_at=? WHERE game_id=?", (now, game_id)
            )
            self._event(
                run_id,
                "game_progress",
                f"{pairing_key}:record:{move_sequence}",
                now,
            )
            return True

    def save_game_result(
        self, run_id: str, sequence: int, record: "GameRecord"
    ) -> bool:
        """Atomically complete a running game and charge its totals exactly once."""
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
        cache_read_tokens = sum(
            attempt.cache_read_tokens
            for move in record.records
            for attempt in move.attempts
        )
        cache_write_tokens = sum(
            attempt.cache_write_tokens
            for move in record.records
            for attempt in move.attempts
        )
        uncached_prompt_tokens = sum(
            attempt.uncached_prompt_tokens
            for move in record.records
            for attempt in move.attempts
        )
        cache_discount_usd = sum(
            attempt.cache_discount_usd
            for move in record.records
            for attempt in move.attempts
        )
        cost_usd = sum(
            attempt.cost_usd for move in record.records for attempt in move.attempts
        )
        with self._transaction():
            self._insert_running_game(
                run_id,
                sequence,
                record.white,
                record.black,
                record.start_fen,
                now,
            )
            row = self._db.execute(
                "SELECT status FROM game WHERE game_id=?", (game_id,)
            ).fetchone()
            if row is None or row["status"] == "completed":
                return False
            for move_sequence, move in enumerate(record.records):
                self._db.execute(
                    """INSERT INTO game_move (game_id, ply, payload_json, created_at)
                       VALUES (?, ?, ?, ?)
                       ON CONFLICT(game_id, ply) DO UPDATE SET
                         payload_json=excluded.payload_json""",
                    (game_id, move_sequence, _canonical(asdict(move)), now),
                )
            self._db.execute(
                "DELETE FROM game_move WHERE game_id=? AND ply>=?",
                (game_id, len(record.records)),
            )
            self._db.execute(
                """UPDATE game SET status='completed', result=?, termination=?, pgn=?,
                   updated_at=? WHERE game_id=?""",
                (record.result, record.termination, record.pgn, now, game_id),
            )
            self._db.execute(
                """UPDATE benchmark_run SET completed_items=completed_items+1,
                   cost_usd=cost_usd+?, prompt_tokens=prompt_tokens+?,
                   completion_tokens=completion_tokens+?, reasoning_tokens=reasoning_tokens+?,
                   cache_read_tokens=cache_read_tokens+?,
                   cache_write_tokens=cache_write_tokens+?,
                   uncached_prompt_tokens=uncached_prompt_tokens+?,
                   cache_discount_usd=cache_discount_usd+?,
                   updated_at=? WHERE run_id=?""",
                (
                    cost_usd,
                    prompt_tokens,
                    completion_tokens,
                    reasoning_tokens,
                    cache_read_tokens,
                    cache_write_tokens,
                    uncached_prompt_tokens,
                    cache_discount_usd,
                    now,
                    run_id,
                ),
            )
            self._event(run_id, "game_completed", pairing_key, now)
            return True

    def load_game_results(self, run_id: str) -> dict[int, "GameRecord"]:
        return self._load_game_records(run_id, "completed")

    def load_in_progress_games(self, run_id: str) -> dict[int, "GameRecord"]:
        return self._load_game_records(run_id, "running")

    def _load_game_records(self, run_id: str, status: str) -> dict[int, "GameRecord"]:
        from .tasks.games import GameRecord, MoveAttempt, MoveRecord

        games = self._db.execute(
            "SELECT * FROM game WHERE run_id=? AND status=?",
            (run_id, status),
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
                result=game["result"] or "",
                termination=game["termination"] or "running",
                plies=sum(record.san is not None for record in records),
                moves_san=[record.san for record in records if record.san is not None],
                records=records,
                pgn=game["pgn"] or "",
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
            "puzzle_performance_rating": report.elo.to_dict(),
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

    def mark_failed(self, run_id: str, error: str) -> None:
        """Retire an invalid run without deleting its forensic audit record.

        Failed runs are excluded from the benchmark natural-key uniqueness
        constraint, so a corrected harness can start a clean replacement.
        """
        now = _now()
        with self._transaction():
            row = self._db.execute(
                "SELECT status FROM benchmark_run WHERE run_id=?", (run_id,)
            ).fetchone()
            if row is None:
                raise KeyError(run_id)
            if row["status"] == "failed":
                raise RuntimeError(f"run {run_id} is already failed")

            # Puzzle checkpoints contain paid turns not yet represented in a
            # completed puzzle_attempt. Retiring a run must not make that spend
            # disappear from its aggregate audit totals.
            checkpoint_totals: dict[str, int | float] = {
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "reasoning_tokens": 0,
                "cache_read_tokens": 0,
                "cache_write_tokens": 0,
                "uncached_prompt_tokens": 0,
                "cache_discount_usd": 0.0,
                "cost_usd": 0.0,
            }
            states = self._db.execute(
                "SELECT state_json FROM puzzle_checkpoint WHERE run_id=?", (run_id,)
            ).fetchall()
            for state_row in states:
                state = json.loads(state_row["state_json"])
                turns = state.get("turns") if isinstance(state, dict) else None
                if not isinstance(turns, list):
                    continue
                for turn in turns:
                    if not isinstance(turn, dict):
                        continue
                    for field in checkpoint_totals:
                        value = turn.get(field, 0)
                        if isinstance(value, (int, float)) and not isinstance(
                            value, bool
                        ):
                            checkpoint_totals[field] += value
            cursor = self._db.execute(
                """UPDATE benchmark_run
                   SET status='failed', error=?, completed_at=?, updated_at=?,
                       prompt_tokens=prompt_tokens+?,
                       completion_tokens=completion_tokens+?,
                       reasoning_tokens=reasoning_tokens+?,
                       cache_read_tokens=cache_read_tokens+?,
                       cache_write_tokens=cache_write_tokens+?,
                       uncached_prompt_tokens=uncached_prompt_tokens+?,
                       cache_discount_usd=cache_discount_usd+?,
                       cost_usd=cost_usd+?
                   WHERE run_id=?""",
                (
                    error[:2000],
                    now,
                    now,
                    int(checkpoint_totals["prompt_tokens"]),
                    int(checkpoint_totals["completion_tokens"]),
                    int(checkpoint_totals["reasoning_tokens"]),
                    int(checkpoint_totals["cache_read_tokens"]),
                    int(checkpoint_totals["cache_write_tokens"]),
                    int(checkpoint_totals["uncached_prompt_tokens"]),
                    float(checkpoint_totals["cache_discount_usd"]),
                    float(checkpoint_totals["cost_usd"]),
                    run_id,
                ),
            )
            assert cursor.rowcount == 1
            self._event(run_id, "failed", error[:500], now)

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
                    "cache_read_tokens": row["cache_read_tokens"],
                    "cache_write_tokens": row["cache_write_tokens"],
                    "uncached_prompt_tokens": row["uncached_prompt_tokens"],
                    "cache_discount_usd": row["cache_discount_usd"],
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
                    "cache_read_tokens": row["cache_read_tokens"],
                    "cache_write_tokens": row["cache_write_tokens"],
                    "uncached_prompt_tokens": row["uncached_prompt_tokens"],
                    "cache_discount_usd": row["cache_discount_usd"],
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
            "SELECT status, error, summary_json FROM benchmark_run WHERE run_id=?", (run_id,)
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
        return {
            "run_id": run_id,
            "status": remote_status,
            "error": row["error"],
            "summary": json.loads(row["summary_json"]) if row["summary_json"] else None,
        }
