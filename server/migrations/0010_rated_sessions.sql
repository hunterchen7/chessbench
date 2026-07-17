-- Adaptive rated sessions have a versioned protocol and retain their final
-- Glicko state/termination verbatim. Fixed suites continue using the existing
-- aggregate columns and Bayesian performance estimator.

ALTER TABLE benchmark_runs_v2 ADD COLUMN protocol_json TEXT;
ALTER TABLE benchmark_runs_v2 ADD COLUMN summary_json TEXT;

CREATE INDEX IF NOT EXISTS idx_benchmark_runs_protocol
  ON benchmark_runs_v2(json_extract(protocol_json, '$.kind'), status, completed_at);
