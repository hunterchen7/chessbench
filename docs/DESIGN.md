# ChessBench v2 design

## Invariants

1. Results are comparable only when suite, condition, model variant, and sampling configuration match.
2. Public scoring is points: puzzles sum item credit; games use 1/0.5/0 match points.
3. Models receive no external tools. Legality and grading happen outside the model boundary.
4. No conversation state crosses a puzzle or game boundary.
5. Every paid result becomes durable before the next item starts.
6. Raw visible provider output is retained; hidden chain of thought is not inferred.
7. The hosted data store is exportable as versioned JSON.

## Protocol axes

### Puzzle information

- `raw`: FEN plus a piece inventory.
- `assisted`: raw plus SAN/UCI legal moves.
- `coached`: assisted plus fixed calculation advice.

### Puzzle response protocol

- `move_by_move`: request one solver move, apply the forced reply, then request the next solver move.
- `full_line`: request the complete variation once. This is the Woodpecker track, not a fourth information prompt.

### Puzzle conversation

- `hybrid` (canonical): keep assistant/user messages within one puzzle and re-send the authoritative board and played line on each request.
- `fresh` (ablation): start a new request for every solver move and reconstruct all required state in that prompt.

The agent is reset before every puzzle. Full-line requests have no between-move context.

### Games

`hybrid` is canonical for games: a growing chat plus current FEN, piece inventory, history, and legal moves when enabled. `fresh` and `growing` remain explicit ablations. The session resets before each game.

Legality is orthogonal:

- `free_form`: first illegal move forfeits;
- `retry`: return feedback and allow a bounded number of retries;
- `legal_list`: supply the legal candidates;
- `otb`: the configured cumulative illegal attempt forfeits.

## Model identity

A model variant key includes provider, provider model ID, reasoning effort or exact reasoning-token budget, and maximum output tokens. Different thinking budgets are deliberately separate leaderboard entries. Temperature and prompt condition remain run fields.

OpenRouter receives either `reasoning.effort` or `reasoning.max_tokens`, never both. The provider usage object is the source for token counts and cost.

## Persistence

### Local

`BenchmarkStore` is a SQLite WAL database with `synchronous=FULL`.

- `benchmark_run` owns status and aggregate progress.
- `puzzle_attempt` is unique by `(run_id, puzzle_id)` and stores the result and puzzle snapshot.
- the attempt insert and run counter update share one `BEGIN IMMEDIATE` transaction.
- `sync_delivery` records successful remote item deliveries.

A natural key hashes track, complete model variant, condition, and suite content hash. Reopening an incomplete natural key resumes it; `--force` creates an explicit replicate.

### Cloudflare D1

- `model_variants_v2`: display identity and reasoning/output budgets.
- `benchmark_runs_v2`: manifest, status, aggregate points, usage, and suite fingerprint.
- `benchmark_items_v2`: idempotent item payloads and points.
- `benchmark_events_v2`: lifecycle audit trail.
- `games` and `live_boards`: durable finished games and current live snapshots.
- `game_turn_logs_v2`: normalized request/response attempts, committed in bounded batches.

Run completion is rejected unless `completed_items == total_items`. Item upsert refreshes aggregates from item rows rather than trusting caller totals.

## Hosted API

Read endpoints are public. Mutation endpoints require a constant-time Bearer-token comparison against the Worker secret.

```text
GET  /api/index
GET  /api/runs/:id
GET  /api/puzzles
GET  /api/puzzles/:id
GET  /api/tournaments
GET  /api/tournaments/:id
GET  /api/export?track=&model=&run=&status=

POST /api/ingest/run/start
POST /api/ingest/run/item
POST /api/ingest/run/finish
POST /api/ingest/game
POST /api/live/board
POST /api/ingest/tournament
```

The React app and API share the Worker origin. Hash routing lets Cloudflare assets serve every dashboard route without an additional routing layer.

## Dashboard

- Overview: points-first variant ranking, prompt-mode comparison, costs, and durable run progress.
- Standard: searchable independent puzzles and cross-model answers.
- Woodpecker: separate complete-line leaderboard and solution audit.
- Esoteric: composed-problem genres and verifier outcomes.
- Games: match points, replays, legality outcomes, and collapsible exact transcripts.
- Methods: the scoring and state contracts in plain language.

The global and track-level export controls download complete, versioned JSON. Large item collections are lazy-loaded by route rather than fetched with the initial leaderboard.

## Security and data policy

- Secrets live in ignored `.env`/`.dev.vars` files or Cloudflare secrets.
- Provider tool calls are disabled and returned tool calls are rejected.
- The UI labels visible output as such and does not present it as hidden reasoning.
- Public exports contain benchmark data and provider usage, never API credentials or ingestion tokens.
