# chessbench backend (Cloudflare Worker + D1)

A JSON API over Cloudflare D1 that ingests the benchmark's run/tournament records,
serves them to the web app, and keeps a **global human-solver leaderboard**. The
built Vite SPA is served from the same origin via the `[assets]` binding, so the
whole thing is one deployment with no CORS in production.

## API

Read (public, permissive CORS):

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/api/health` | liveness |
| GET | `/api/index` | run index (mirrors `index.json`) |
| GET | `/api/runs/:id` | public run document; private-suite items are sealed |
| GET | `/api/corpora/:track` | active result-free public corpus (`standard`, `woodpecker`, `esoteric`) |
| GET | `/api/puzzles` | position bank + per-puzzle model solve stats |
| GET | `/api/puzzles/:id` | one position + how every model answered |
| GET | `/api/puzzles/rated?page=1&per_page=10000` | sortable, filterable page from the active 100k pool (maximum 10,000 rows) |
| GET | `/api/puzzles/random` | random puzzle from the active 100k rated pool; accepts category/rating filters |
| GET | `/api/tournaments` | tournament index |
| GET | `/api/tournaments/:id` | full tournament document |
| GET | `/api/export` | filtered versioned JSON; private-suite items are sealed |
| GET | `/api/human/summary?uid=` | one solver's points and accuracy |
| GET | `/api/human/leaderboard` | top human solvers by points |
| POST | `/api/human/solve` | record a fixed-corpus or rated-pool solve `{uid, puzzle_id, solved, move, handle?}` |
| GET | `/api/human/training?uid=` | load the caller's explicitly saved adaptive training run |
| GET | `/api/human/training/leaderboard` | public saved human puzzle ratings |
| POST | `/api/human/training` | save one named training snapshot; unique username, two-minute cooldown |

Ingest (Bearer `INGEST_TOKEN`):

| Method | Path | Body |
| --- | --- | --- |
| POST | `/api/ingest/corpus` | a result-free public/private corpus bundle |
| POST | `/api/ingest/rated-pool/start` | begin a staged adaptive-pool import |
| POST | `/api/ingest/rated-pool/items` | upload up to 250 indexed pool puzzles |
| POST | `/api/ingest/rated-pool/finish` | verify item count and atomically activate the pool |
| POST | `/api/ingest/suite` | an exact frozen runnable suite |
| POST | `/api/ingest/run/start` | immutable run manifest; validates suite hash and item count |
| POST | `/api/ingest/run/item/chunks` | one bounded, idempotent batch containing a large item's complete chunk set |
| POST | `/api/ingest/run/item/chunk` | backward-compatible single-chunk staging endpoint |
| POST | `/api/ingest/run/item` | one idempotent paid result + full audit payload |
| POST | `/api/ingest/run/finish` | terminal run state and frozen-prior Bayesian Puzzle Elo |
| POST | `/api/ingest/tournament?id=<stem>` | a tournament document |

The same owner token may be used with `?include_private=1` on a run-detail or export request. Without both the
explicit flag and a valid token, private-suite membership, positions, item outcomes, prompts, and transcripts are
never returned. Aggregate points, progress, usage, and the suite content hash remain public.

## First-time setup

```bash
cd server
pnpm install

# 1. Create the D1 database and paste the printed database_id into wrangler.toml
wrangler d1 create chessbench

# 2. Apply the schema (local for `wrangler dev`, remote for prod)
wrangler d1 migrations apply chessbench --local
wrangler d1 migrations apply chessbench --remote

# 3. Set the ingestion secret
wrangler secret put INGEST_TOKEN     # paste a random token

# 4. Build the SPA without local run snapshots, apply migrations, and deploy
pnpm deploy
```

`pnpm deploy` applies remote D1 migrations before publishing the Worker, so a
new API route is never deployed without the schema it requires.

## Loading data

From the repo root, register corpora/suites once, then drain the durable local outbox after or during a run:

```bash
export CHESSBENCH_API=https://chessbench.<subdomain>.workers.dev
export CHESSBENCH_INGEST_TOKEN=<the INGEST_TOKEN>
python3 scripts/build_public_corpus_bundle.py
python3 scripts/sync_registry.py
python3 scripts/sync_rated_pool.py
python3 scripts/sync_cloudflare.py --db runs/chessbench.db
```

### Random puzzle selection

The adaptive pool is stored in dedicated `rated_puzzles` and `rated_puzzle_tags` tables; it does not replace the
small browsable corpus or any frozen benchmark suite. Selection uses a cryptographically random pivot over an
indexed per-puzzle key, so requests are non-deterministic without an expensive `ORDER BY RANDOM()` scan.

```text
GET /api/puzzles/random
GET /api/puzzles/random?rating=1650&radius=200
GET /api/puzzles/random?min_rating=1400&max_rating=1750
GET /api/puzzles/random?category=family:quiet_moves&rating=1800&radius=250
GET /api/puzzles/random?category=theme:fork&rating=1500&exclude=abc12,def34
```

Random selections return the normalized trainer-ready position. The training UI sends the
browser's current Glicko estimate with a 100-point radius, excludes its recent positions,
and draws a fresh random-key pivot for every selection.

### Rated-pool browsing

Rated-pool pages are globally sorted and filtered by the Worker before pagination. Supported sort columns are
`rating`, `rating_deviation`, `popularity`, `plays`, and `puzzle_id`; `direction` is `asc` or `desc`. Optional
filters are `tier`, `theme`, `id_prefix`, `min_rating`, and `max_rating`. Each complete query URL has its own
cache identity, so prefetched pages and previously visited sort/filter combinations can reuse HTTP-cached results.
After the first page supplies the filtered count, background page loads may use `include_total=0` to skip repeating
the count query.

```text
GET /api/puzzles/rated?page=1&per_page=10000
GET /api/puzzles/rated?sort=plays&direction=desc&tier=expert&page=1&per_page=10000
GET /api/puzzles/rated?theme=fork&min_rating=1800&max_rating=2400&page=1&per_page=10000
```

Use either `rating` + `radius` or explicit `min_rating` + `max_rating`. An unprefixed category matching one of the
twelve profile families is treated as `family:<name>`; other unprefixed values are treated as raw Lichess themes.
Up to 100 puzzle IDs can be excluded to prevent repeats within a session. Every response includes a unique
selection ID, pool content hash, effective filters, and the complete frozen puzzle record for durable run logging.

## Local dev

`wrangler dev` serves the API against a local D1. Point the frontend at it with
`VITE_API_BASE=http://localhost:8787/api pnpm dev` in `web/`. With no `VITE_API_BASE`
and no reachable `/api`, the frontend falls back to the static JSON in `web/public/data`.
