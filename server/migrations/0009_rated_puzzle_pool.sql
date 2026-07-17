-- Large adaptive puzzle pools live separately from small browsable corpora and
-- exact frozen suites. A pool is staged in batches, verified by item count, and
-- only then made active, so a failed import cannot replace the working pool.

CREATE TABLE IF NOT EXISTS rated_puzzle_pools (
  content_hash  TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  version       TEXT NOT NULL,
  item_count    INTEGER NOT NULL,
  metadata_json TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (name, version)
);
CREATE INDEX IF NOT EXISTS idx_rated_puzzle_pools_active
  ON rated_puzzle_pools(active, updated_at DESC);

CREATE TABLE IF NOT EXISTS rated_puzzles (
  content_hash     TEXT NOT NULL REFERENCES rated_puzzle_pools(content_hash) ON DELETE CASCADE,
  puzzle_id        TEXT NOT NULL,
  rating           INTEGER NOT NULL,
  rating_deviation INTEGER NOT NULL,
  popularity       INTEGER NOT NULL,
  plays            INTEGER NOT NULL,
  random_key       INTEGER NOT NULL,
  payload_json     TEXT NOT NULL,
  PRIMARY KEY (content_hash, puzzle_id)
);
CREATE INDEX IF NOT EXISTS idx_rated_puzzles_random_rating
  ON rated_puzzles(content_hash, random_key, rating);

-- Tags are normalized for indexed lookup. Values are namespaced, for example
-- `family:quiet_moves`, `theme:quietMove`, and `phase:endgame`.
CREATE TABLE IF NOT EXISTS rated_puzzle_tags (
  content_hash TEXT NOT NULL,
  puzzle_id    TEXT NOT NULL,
  tag          TEXT NOT NULL,
  rating       INTEGER NOT NULL,
  random_key   INTEGER NOT NULL,
  PRIMARY KEY (content_hash, puzzle_id, tag),
  FOREIGN KEY (content_hash, puzzle_id)
    REFERENCES rated_puzzles(content_hash, puzzle_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_rated_puzzle_tags_lookup
  ON rated_puzzle_tags(content_hash, tag, random_key, rating);
