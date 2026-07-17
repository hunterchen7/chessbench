-- Large benchmark item audit payloads can exceed D1's per-value SQLite limit.
-- Keep benchmark_items_v2.payload_json for existing/small rows and store large
-- payloads as independently retryable chunks.  The item row contains a small,
-- versioned reference and is only published after every chunk is present.

CREATE TABLE IF NOT EXISTS benchmark_item_payload_chunks (
  run_id          TEXT NOT NULL REFERENCES benchmark_runs_v2(run_id) ON DELETE CASCADE,
  item_id         TEXT NOT NULL,
  payload_sha256  TEXT NOT NULL,
  chunk_index     INTEGER NOT NULL,
  chunk_count     INTEGER NOT NULL,
  payload_chunk   TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  PRIMARY KEY (run_id, item_id, payload_sha256, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_benchmark_item_payload_chunks_item
  ON benchmark_item_payload_chunks(run_id, item_id, payload_sha256, chunk_index);
