-- Reconstructable game conversations without duplicating the full growing
-- context on every ply. Provider-hidden chain-of-thought is deliberately not
-- stored; visible responses and reasoning-token counts are.

CREATE TABLE IF NOT EXISTS game_turn_logs_v2 (
  game_id            TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  ply                INTEGER NOT NULL,
  attempt            INTEGER NOT NULL,
  color              TEXT NOT NULL,
  system_prompt      TEXT,
  prompt             TEXT,
  raw_response       TEXT NOT NULL,
  parsed_move        TEXT,
  legal              INTEGER NOT NULL,
  explanation        TEXT,
  prompt_tokens      INTEGER NOT NULL DEFAULT 0,
  completion_tokens  INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens   INTEGER NOT NULL DEFAULT 0,
  cost_usd           REAL NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  PRIMARY KEY(game_id, ply, attempt)
);
CREATE INDEX IF NOT EXISTS idx_game_turn_logs_game ON game_turn_logs_v2(game_id, ply, attempt);
