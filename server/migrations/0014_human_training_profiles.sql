-- Explicitly saved browser training runs. The anonymous uid acts as the owner
-- key, while handles are public and unique without regard to case.

CREATE TABLE IF NOT EXISTS human_training_profiles (
  uid               TEXT PRIMARY KEY,
  handle            TEXT NOT NULL COLLATE NOCASE UNIQUE,
  rating            REAL NOT NULL,
  rating_deviation  REAL NOT NULL,
  volatility        REAL NOT NULL,
  attempts          INTEGER NOT NULL,
  solved            INTEGER NOT NULL,
  session_json      TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  last_saved_ms     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_human_training_rating
  ON human_training_profiles(rating DESC, rating_deviation ASC, attempts DESC);

-- Fixed-size counters: keys are overwritten when their window rolls over, so
-- this table does not grow once the set of active uid/IP keys stabilizes.
CREATE TABLE IF NOT EXISTS human_training_save_limits (
  rate_key         TEXT PRIMARY KEY,
  window_start_ms  INTEGER NOT NULL,
  saves            INTEGER NOT NULL
);
