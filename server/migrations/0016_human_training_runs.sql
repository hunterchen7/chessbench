-- Human training scores behave like arcade entries: a display handle can appear
-- on many independent runs, while a stable run id makes re-saving idempotent.

ALTER TABLE human_training_profiles RENAME TO human_training_profiles_legacy;

CREATE TABLE human_training_profiles (
  run_id            TEXT PRIMARY KEY,
  uid               TEXT NOT NULL,
  handle            TEXT NOT NULL COLLATE NOCASE,
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

INSERT INTO human_training_profiles (
  run_id, uid, handle, rating, rating_deviation, volatility, attempts, solved,
  session_json, created_at, updated_at, last_saved_ms
)
SELECT 'legacy:' || uid, uid, handle, rating, rating_deviation, volatility,
       attempts, solved, session_json, created_at, updated_at, last_saved_ms
  FROM human_training_profiles_legacy;

DROP TABLE human_training_profiles_legacy;

CREATE INDEX idx_human_training_rating
  ON human_training_profiles(rating DESC, rating_deviation ASC, attempts DESC);

CREATE INDEX idx_human_training_uid
  ON human_training_profiles(uid, updated_at DESC);

CREATE INDEX idx_human_training_handle
  ON human_training_profiles(handle COLLATE NOCASE, updated_at DESC);
