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
| GET | `/api/puzzles` | position bank + per-puzzle model solve stats |
| GET | `/api/puzzles/:id` | one position + how every model answered |
| GET | `/api/tournaments` | tournament index |
| GET | `/api/tournaments/:id` | full tournament document |
| GET | `/api/export` | filtered versioned JSON; private-suite items are sealed |
| GET | `/api/human/summary?uid=` | one solver's count + Elo |
| GET | `/api/human/leaderboard` | top human solvers by Elo |
| POST | `/api/human/solve` | record a solve `{uid, puzzle_id, solved, handle?}` |

Ingest (Bearer `INGEST_TOKEN`):

| Method | Path | Body |
| --- | --- | --- |
| POST | `/api/ingest/run` | a run document from `store.py` |
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

# 4. Build the SPA so [assets] has something to serve, then deploy
(cd ../web && pnpm build)
wrangler deploy
```

## Loading data

From the repo root, after a benchmark run:

```bash
export CHESSBENCH_API=https://chessbench.<subdomain>.workers.dev
export CHESSBENCH_INGEST_TOKEN=<the INGEST_TOKEN>
python scripts/push_to_backend.py
```

## Local dev

`wrangler dev` serves the API against a local D1. Point the frontend at it with
`VITE_API_BASE=http://localhost:8787/api pnpm dev` in `web/`. With no `VITE_API_BASE`
and no reachable `/api`, the frontend falls back to the static JSON in `web/public/data`.
