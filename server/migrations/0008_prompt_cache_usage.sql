-- Prompt-prefix caching is compute reuse only. Responses are never cached or
-- replayed. Store both provider totals and normalized cache accounting so cost
-- comparisons remain auditable across OpenRouter, OpenAI, and Anthropic.

ALTER TABLE benchmark_runs_v2 ADD COLUMN cache_read_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE benchmark_runs_v2 ADD COLUMN cache_write_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE benchmark_runs_v2 ADD COLUMN uncached_prompt_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE benchmark_runs_v2 ADD COLUMN cache_discount_usd REAL NOT NULL DEFAULT 0;

ALTER TABLE benchmark_items_v2 ADD COLUMN cache_read_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE benchmark_items_v2 ADD COLUMN cache_write_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE benchmark_items_v2 ADD COLUMN uncached_prompt_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE benchmark_items_v2 ADD COLUMN cache_discount_usd REAL NOT NULL DEFAULT 0;

ALTER TABLE game_turn_logs_v2 ADD COLUMN cache_read_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE game_turn_logs_v2 ADD COLUMN cache_write_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE game_turn_logs_v2 ADD COLUMN uncached_prompt_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE game_turn_logs_v2 ADD COLUMN cache_discount_usd REAL NOT NULL DEFAULT 0;
ALTER TABLE game_turn_logs_v2 ADD COLUMN cache_policy TEXT NOT NULL DEFAULT 'provider_default';
ALTER TABLE game_turn_logs_v2 ADD COLUMN cache_session_id TEXT;
