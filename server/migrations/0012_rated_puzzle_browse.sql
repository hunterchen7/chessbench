-- The public rated-pool browser walks the active 100k pool in a stable order.
-- Cover the ORDER BY and tie-breaker so page reads do not require a temp sort.

CREATE INDEX IF NOT EXISTS idx_rated_puzzles_browse
  ON rated_puzzles(content_hash, rating, puzzle_id);
