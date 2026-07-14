-- Record adherence to the move+rationale JSON contract independently from
-- chess legality. A malformed response can still contain a recoverable move.

ALTER TABLE game_turn_logs_v2 ADD COLUMN response_format_valid INTEGER;
ALTER TABLE game_turn_logs_v2 ADD COLUMN response_format_error TEXT;

ALTER TABLE benchmark_items_v2 ADD COLUMN response_format_valid INTEGER;
ALTER TABLE benchmark_runs_v2 ADD COLUMN response_format_items INTEGER NOT NULL DEFAULT 0;
ALTER TABLE benchmark_runs_v2 ADD COLUMN response_format_valid_items INTEGER NOT NULL DEFAULT 0;
