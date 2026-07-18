-- Keep global sorts for the virtual rated-pool browser on covering indexes.
-- The primary key already covers puzzle_id ordering, while 0012 covers rating.

CREATE INDEX IF NOT EXISTS idx_rated_puzzles_browse_rd
  ON rated_puzzles(content_hash, rating_deviation, puzzle_id);
CREATE INDEX IF NOT EXISTS idx_rated_puzzles_browse_popularity
  ON rated_puzzles(content_hash, popularity, puzzle_id);
CREATE INDEX IF NOT EXISTS idx_rated_puzzles_browse_plays
  ON rated_puzzles(content_hash, plays, puzzle_id);
CREATE INDEX IF NOT EXISTS idx_rated_puzzle_tags_browse_rating
  ON rated_puzzle_tags(content_hash, tag, rating, puzzle_id);
