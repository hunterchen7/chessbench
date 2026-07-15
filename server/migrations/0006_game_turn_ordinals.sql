-- A chess board ply is not a unique turn-envelope identifier.  A legal move at
-- ply N can be followed by an illegal/forfeit record while the board is still at
-- ply N, and both records can have retry attempt 0.  Preserve those useful
-- semantic columns, but key each normalized response by its deterministic
-- game-global ordinal.

CREATE TABLE game_turn_logs_v2_next (
  game_id            TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  turn_ordinal       INTEGER NOT NULL,
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
  response_format_valid INTEGER,
  response_format_error TEXT,
  PRIMARY KEY(game_id, turn_ordinal)
);

-- Existing rows were unique by (game_id, ply, attempt), so that ordering gives
-- every historical response a stable, collision-free ordinal without dropping
-- or rewriting any of its audit fields.
INSERT INTO game_turn_logs_v2_next
  (game_id, turn_ordinal, ply, attempt, color, system_prompt, prompt,
   raw_response, parsed_move, legal, explanation, prompt_tokens,
   completion_tokens, reasoning_tokens, cost_usd, created_at,
   response_format_valid, response_format_error)
SELECT
  game_id,
  ROW_NUMBER() OVER (PARTITION BY game_id ORDER BY ply, attempt) - 1,
  ply,
  attempt,
  color,
  system_prompt,
  prompt,
  raw_response,
  parsed_move,
  legal,
  explanation,
  prompt_tokens,
  completion_tokens,
  reasoning_tokens,
  cost_usd,
  created_at,
  response_format_valid,
  response_format_error
FROM game_turn_logs_v2;

DROP TABLE game_turn_logs_v2;
ALTER TABLE game_turn_logs_v2_next RENAME TO game_turn_logs_v2;

CREATE INDEX idx_game_turn_logs_game
  ON game_turn_logs_v2(game_id, turn_ordinal);
CREATE INDEX idx_game_turn_logs_ply
  ON game_turn_logs_v2(game_id, ply, attempt, turn_ordinal);
