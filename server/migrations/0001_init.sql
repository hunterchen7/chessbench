-- chessbench backend schema (Cloudflare D1 / SQLite).
-- Mirrors the JSON data contract in chessbench/store.py so the same run and
-- tournament documents can be ingested verbatim, while adding normalized tables
-- for the cross-cutting queries the site needs (per-puzzle model answers, the
-- global human-solver leaderboard).

-- One row per puzzle run (model × condition × suite). doc_json is the full
-- run document (items + themes + condition); summary_json is the headline block.
CREATE TABLE IF NOT EXISTS runs (
  run_id         TEXT PRIMARY KEY,
  model          TEXT NOT NULL,
  provider       TEXT,
  kind           TEXT,
  condition_slug TEXT,
  suite          TEXT,
  temperature    REAL,
  created        TEXT,
  summary_json   TEXT NOT NULL,
  doc_json       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_model ON runs (model);
CREATE INDEX IF NOT EXISTS idx_runs_created ON runs (created);

-- The position bank, deduplicated across runs by puzzle id.
CREATE TABLE IF NOT EXISTS puzzles (
  puzzle_id       TEXT PRIMARY KEY,
  rating          INTEGER,
  fen             TEXT,
  setup_san       TEXT,
  solver_is_white INTEGER,
  solution_json   TEXT,
  solution_first  TEXT,
  themes_json     TEXT,
  categories_json TEXT,
  game_url        TEXT
);
CREATE INDEX IF NOT EXISTS idx_puzzles_rating ON puzzles (rating);

-- One row per (run, puzzle): how a given model answered a given puzzle.
CREATE TABLE IF NOT EXISTS run_answers (
  run_id             TEXT NOT NULL,
  puzzle_id          TEXT NOT NULL,
  model              TEXT NOT NULL,
  condition_slug     TEXT,
  solved             INTEGER,
  score              REAL,
  first_move_legal   INTEGER,
  failure_reason     TEXT,
  answer_move        TEXT,
  answer_explanation TEXT,
  seq_elo            REAL,
  PRIMARY KEY (run_id, puzzle_id)
);
CREATE INDEX IF NOT EXISTS idx_answers_puzzle ON run_answers (puzzle_id);

-- Full tournament documents (standings + games + crosstable) plus a light index.
CREATE TABLE IF NOT EXISTS tournaments (
  tid            TEXT PRIMARY KEY,
  created        TEXT,
  condition_slug TEXT,
  n_players      INTEGER,
  n_games        INTEGER,
  winner         TEXT,
  doc_json       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tournaments_created ON tournaments (created);

-- Anonymous human solves (uid is a client-generated opaque id). We keep the best
-- outcome per (uid, puzzle) and rate humans with the same MLE puzzle-Elo as models.
CREATE TABLE IF NOT EXISTS human_solves (
  uid       TEXT NOT NULL,
  puzzle_id TEXT NOT NULL,
  solved    INTEGER NOT NULL,
  updated   TEXT,
  PRIMARY KEY (uid, puzzle_id)
);
CREATE INDEX IF NOT EXISTS idx_human_uid ON human_solves (uid);

-- Optional display handle a human can claim for the leaderboard.
CREATE TABLE IF NOT EXISTS human_profiles (
  uid     TEXT PRIMARY KEY,
  handle  TEXT,
  updated TEXT
);
