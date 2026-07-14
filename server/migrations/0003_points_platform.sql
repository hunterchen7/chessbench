-- Points-first, incremental benchmark storage. The v1 tables remain readable
-- during migration, but all new ingestion and dashboard queries use these
-- normalized tables.

CREATE TABLE IF NOT EXISTS model_variants_v2 (
  variant_key       TEXT PRIMARY KEY,
  base_model        TEXT NOT NULL,
  display_name      TEXT NOT NULL,
  provider          TEXT NOT NULL,
  provider_model_id TEXT NOT NULL,
  reasoning_json    TEXT NOT NULL,
  max_output_tokens INTEGER NOT NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS benchmark_runs_v2 (
  run_id            TEXT PRIMARY KEY,
  track             TEXT NOT NULL CHECK (track IN ('puzzle', 'woodpecker', 'esoteric', 'game')),
  variant_key       TEXT NOT NULL REFERENCES model_variants_v2(variant_key),
  condition_slug    TEXT NOT NULL,
  condition_json    TEXT NOT NULL,
  suite_name        TEXT,
  suite_version     TEXT,
  suite_hash        TEXT,
  suite_visibility  TEXT,
  status            TEXT NOT NULL CHECK (status IN ('queued', 'running', 'partial', 'completed', 'failed')),
  total_items       INTEGER NOT NULL,
  completed_items   INTEGER NOT NULL DEFAULT 0,
  solved_items      INTEGER NOT NULL DEFAULT 0,
  legal_items       INTEGER NOT NULL DEFAULT 0,
  points            REAL NOT NULL DEFAULT 0,
  max_points        REAL NOT NULL DEFAULT 0,
  cost_usd          REAL NOT NULL DEFAULT 0,
  prompt_tokens     INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens  INTEGER NOT NULL DEFAULT 0,
  error             TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  completed_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_benchmark_runs_track ON benchmark_runs_v2(track, status, points DESC);
CREATE INDEX IF NOT EXISTS idx_benchmark_runs_variant ON benchmark_runs_v2(variant_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_benchmark_runs_suite ON benchmark_runs_v2(suite_hash, track);

CREATE TABLE IF NOT EXISTS benchmark_items_v2 (
  run_id             TEXT NOT NULL REFERENCES benchmark_runs_v2(run_id) ON DELETE CASCADE,
  item_id            TEXT NOT NULL,
  sequence           INTEGER NOT NULL,
  points             REAL NOT NULL,
  max_points         REAL NOT NULL DEFAULT 1,
  solved             INTEGER NOT NULL,
  first_move_legal   INTEGER,
  failure_reason     TEXT,
  latency_ms         INTEGER,
  cost_usd           REAL NOT NULL DEFAULT 0,
  prompt_tokens      INTEGER NOT NULL DEFAULT 0,
  completion_tokens  INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens   INTEGER NOT NULL DEFAULT 0,
  payload_json       TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  PRIMARY KEY (run_id, item_id),
  UNIQUE (run_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_benchmark_items_item ON benchmark_items_v2(item_id, run_id);

CREATE TABLE IF NOT EXISTS benchmark_events_v2 (
  event_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id     TEXT NOT NULL REFERENCES benchmark_runs_v2(run_id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  detail     TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_benchmark_events_run ON benchmark_events_v2(run_id, event_id);
