-- tokens/move divided a run's TOTAL completion tokens by a move count, so it
-- charged tokens burned on failed requests and unplayable generations to the
-- moves that were actually played. Store the tokens of the played moves so the
-- ratio describes the same turns on both sides.
ALTER TABLE benchmark_runs_v2 ADD COLUMN move_completion_tokens INTEGER NOT NULL DEFAULT 0;
