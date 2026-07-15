-- Clean corpus/result separation. Benchmark task definitions are registered once
-- and remain available when every historical result is deleted.

CREATE TABLE IF NOT EXISTS corpus_releases (
  content_hash TEXT PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  version      TEXT NOT NULL,
  track        TEXT NOT NULL CHECK (track IN ('standard', 'woodpecker', 'esoteric')),
  visibility   TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
  description  TEXT,
  item_count   INTEGER NOT NULL,
  metadata_json TEXT NOT NULL,
  active       INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_corpus_releases_track ON corpus_releases(track, visibility, active);

CREATE TABLE IF NOT EXISTS corpus_items (
  content_hash TEXT NOT NULL REFERENCES corpus_releases(content_hash) ON DELETE CASCADE,
  item_id      TEXT NOT NULL,
  sequence     INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (content_hash, item_id),
  UNIQUE (content_hash, sequence)
);
CREATE INDEX IF NOT EXISTS idx_corpus_items_item ON corpus_items(item_id, content_hash);

CREATE TABLE IF NOT EXISTS benchmark_suites (
  content_hash TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  version      TEXT NOT NULL,
  track        TEXT NOT NULL CHECK (track IN ('puzzle', 'woodpecker', 'esoteric')),
  visibility   TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
  source       TEXT,
  item_count   INTEGER NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (name, version)
);

CREATE TABLE IF NOT EXISTS benchmark_suite_items (
  content_hash TEXT NOT NULL REFERENCES benchmark_suites(content_hash) ON DELETE CASCADE,
  item_id      TEXT NOT NULL,
  sequence     INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (content_hash, item_id),
  UNIQUE (content_hash, sequence)
);

ALTER TABLE benchmark_items_v2 ADD COLUMN item_rating INTEGER;
ALTER TABLE benchmark_items_v2 ADD COLUMN item_rating_deviation INTEGER;

ALTER TABLE benchmark_runs_v2 ADD COLUMN puzzle_rating REAL;
ALTER TABLE benchmark_runs_v2 ADD COLUMN puzzle_rating_stderr REAL;
ALTER TABLE benchmark_runs_v2 ADD COLUMN puzzle_rating_n INTEGER NOT NULL DEFAULT 0;
ALTER TABLE benchmark_runs_v2 ADD COLUMN puzzle_rating_bounded INTEGER NOT NULL DEFAULT 0;

-- These v1 mirrors predated durable item streaming and are no longer written.
DROP TABLE IF EXISTS run_answers;
DROP TABLE IF EXISTS runs;
DROP TABLE IF EXISTS puzzles;
