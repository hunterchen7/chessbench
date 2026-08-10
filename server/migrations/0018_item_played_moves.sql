-- The run comparison view renders the moves a model actually played, but the
-- payload they live in is chunked out of benchmark_items_v2 whenever a
-- transcript is large (see 0011), so json_extract on payload_json returns NULL
-- for exactly the models that reason the most. Store the moves beside the
-- scalar outcomes: they are a handful of 4-character UCI strings, unlike the
-- prompt/reasoning/raw-response bulk that loads on demand.
ALTER TABLE benchmark_items_v2 ADD COLUMN answer_move TEXT;
ALTER TABLE benchmark_items_v2 ADD COLUMN moves_played_json TEXT;
ALTER TABLE benchmark_items_v2 ADD COLUMN plies_correct INTEGER;
ALTER TABLE benchmark_items_v2 ADD COLUMN solver_plies INTEGER;
