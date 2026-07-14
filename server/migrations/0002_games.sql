-- Incremental game streaming: instead of one atomic tournament doc written at the
-- very end (lost entirely if the run dies mid-way), games are streamed in as they
-- finish and the in-progress board is snapshotted per move. A tournament is durable
-- after every completed game, and the web viewer can watch it live.

-- Metadata for a tournament that is streaming or has streamed (distinct from the
-- final `tournaments` doc, which is written once the Bradley-Terry fit is known).
CREATE TABLE IF NOT EXISTS live_tournaments (
  tid            TEXT PRIMARY KEY,
  created        TEXT,
  condition_slug TEXT,
  players_json   TEXT,          -- JSON array of player labels
  status         TEXT,          -- 'live' while streaming, 'final' once the full doc lands
  updated        TEXT
);

-- One row per completed game, streamed in as it finishes.
CREATE TABLE IF NOT EXISTS games (
  game_id     TEXT PRIMARY KEY, -- `${tid}#${idx}`
  tid         TEXT NOT NULL,
  idx         INTEGER,
  white       TEXT,
  black       TEXT,
  result      TEXT,
  termination TEXT,
  plies       INTEGER,
  pgn         TEXT,
  start_fen   TEXT,
  moves_json  TEXT,             -- JSON array of move records
  updated     TEXT
);
CREATE INDEX IF NOT EXISTS idx_games_tid ON games (tid, idx);

-- The single in-progress game per tournament, overwritten per move.
CREATE TABLE IF NOT EXISTS live_boards (
  tid        TEXT PRIMARY KEY,
  game_json  TEXT,              -- {white, black, start_fen, fen, plies, moves:[...]}
  updated    TEXT
);
