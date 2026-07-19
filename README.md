# ChessBench

ChessBench measures how language models solve chess without external tools. It stores each prompt, response, move, score, usage record, and provider cost.

The public product has three benchmark surfaces:

| Surface | Task | Headline result |
| --- | --- | --- |
| Standard | Solve tactical positions one move at a time | Adaptive puzzle rating and rating deviation (RD) |
| Esoteric | Solve selfmates, helpmates, proof games, studies, and related compositions | Verifier-awarded points |
| Games | Play complete games against other model configurations | Match points |

The backend also retains an experimental full-line protocol. It is not a current public leaderboard track. See [the suite catalog](docs/SUITES.md) for its Woodpecker-derived releases.

## Primary benchmark

The primary benchmark is an adaptive Standard puzzle session. It uses the pinned 100,000-puzzle `rated-lichess-v1` pool.

The canonical model receives:

- The FEN position.
- Explicit piece locations.
- A request for one UCI move.
- No legal-move list.
- No chess advice.
- No request for an explanation.

Each model configuration starts at rating 1,500 and RD 500. The harness selects deterministic, unused puzzles near the current rating.

| Stop setting | Canonical value |
| --- | ---: |
| Selection radius | ±100 rating points |
| Minimum puzzles | 50 |
| Target RD | 77 |
| Maximum puzzles | 100 |

A complete solve is a Glicko-2 win. A wrong or illegal move is a loss. Correct prefixes earn diagnostic points but do not count as complete solves.

The puzzle rating is a benchmark scale. It is not a human over-the-board Elo rating. See [Rated puzzle sessions](docs/RATED_SESSIONS.md) for the exact selector, update, and stopping contracts.

## Fixed Standard lab

The fixed 250-puzzle suite supports controlled prompt comparisons. New fixed-suite runs use `suites/public/standard-lichess-v3.json`.

| Dashboard method | CLI mode | Information |
| --- | ---: | --- |
| Raw | 1 | FEN and piece locations |
| Assisted | 2 | Raw plus legal UCI moves |
| Coached | 3 | Assisted plus concise calculation advice |
| Deep coached | 5 | Assisted plus the frozen `deep_coach_v1` framework |

Mode 4 is reserved for the experimental full-line protocol. It is not the fourth Standard prompt method.

Each Standard method supports two response styles:

- `--move-only` requests plain-text UCI.
- `--rationale` requests structured JSON with a visible explanation.

Legal candidate lists use UCI only. SAN can reveal checks with `+` and checkmates with `#`, which can disclose puzzle answers.

No state crosses puzzle boundaries. Multi-move puzzles use one conversation within that puzzle by default. The harness sends the authoritative position and played line on each turn.

## Model isolation

The model receives a neutral chess task. The prompt does not say that the task is a benchmark or a scored evaluation.

ChessBench does not give the model an engine, browser, retrieval system, code runner, or other tool. Provider requests omit tool definitions. A returned tool call fails closed.

Reasoning effort and output policy are part of the model configuration. A model at `low` and the same model at `high` appear as different configurations.

ChessBench stores reasoning text and native reasoning artifacts when the provider returns them. Readable reasoning appears in a separate collapsed audit view.

Native reasoning artifacts can continue a supported provider session. OpenAI-family encrypted reasoning from OpenRouter is the exception. ChessBench stores those artifacts for audit but does not replay them.

## Quick start

ChessBench requires Python 3.10 or newer, Node.js 20 or newer, and pnpm.

```bash
python3 -m pip install -e '.[dev]'
cp .env.example .env
pnpm --dir web install
pnpm --dir server install
pnpm --dir server migrate:local
```

Put provider credentials in `.env`. Git ignores this file. Do not commit a live key.

List the registry or add a model:

```bash
python3 -m chessbench models list
python3 -m chessbench models add my-model openrouter provider/model-id
```

Run the canonical adaptive benchmark:

```bash
python3 -m chessbench rate-model \
  --model my-model \
  --reasoning high
```

The command uses seed 0, the ±100 selection radius, the 50-puzzle minimum, target RD 77, and the 100-puzzle cap. Run the same command again to resume its SQLite checkpoint.

Run one fixed-suite comparison cell:

```bash
python3 -m chessbench run-model \
  --model my-model \
  --suite suites/public/standard-lichess-v3.json \
  --mode 1 \
  --move-only \
  --reasoning high
```

Use Modes 1, 2, 3, and 5 with both response styles for the complete fixed-suite matrix.

## Persistence and audit data

```text
Provider API
    │
    ▼
Python runner ── one transaction per completed item ──▶ SQLite outbox
                                                          │
                                                          ▼
                                                Cloudflare Worker + D1
                                                          │
                                                          ▼
                                                   React dashboard
```

SQLite uses write-ahead logging and commits each paid result with its progress state. A stopped command resumes at the first missing item.

The local database is the execution authority. D1 is the production serving database. Uploads are idempotent, and failed uploads remain in the outbox.

Each request can retain:

- The exact system and user prompts.
- The visible provider response.
- Parsed moves, legality, retries, and score.
- Visible explanations and available reasoning records.
- Prompt, completion, reasoning, and cache-token usage.
- Provider-reported cost.

## Results and repository artifacts

Production dashboard pages read run data from D1. Detailed static run JSON files are local offline exports, not production assets.

Do not commit SQLite databases, supervisor logs, or full reasoning transcripts. Commit a compact campaign artifact instead.

The July 2026 public adaptive campaign uses:

- `campaigns/adaptive-public-2026-07.json` for the ordered run manifest.
- `artifacts/adaptive-public-2026-07.json` for compact ratings, RD, usage, cost, and termination data.

Rebuild that artifact from SQLite:

```bash
python3 scripts/export_rated_campaign.py \
  --spec campaigns/adaptive-public-2026-07.json \
  --out artifacts/adaptive-public-2026-07.json
```

Create an offline result bundle only when local static testing requires it:

```bash
python3 -m chessbench run-model \
  --model my-model \
  --suite suites/public/standard-lichess-v3.json \
  --mode 1 \
  --move-only \
  --reasoning high \
  --export-only \
  --out-dir web/public/data/runs

python3 -m chessbench export \
  --runs-dir web/public/data/runs \
  --out web/public/data/index.json
```

The deployed build excludes `web/public/data/runs`. Public result-free corpus files remain available as an offline fallback.

## Cloudflare deployment

Cloudflare Workers serves the Vite dashboard and the JSON API from one origin. D1 stores public benchmark data.

For a Cloudflare Workers Builds connection, use these settings:

- Production branch: `main`.
- Root directory: `/server/`.
- Build command: `pnpm install --frozen-lockfile && pnpm --dir ../web install --frozen-lockfile && pnpm --dir ../web build:deploy`.
- Deploy command: `pnpm exec wrangler deploy`.

The deploy build removes detailed static run snapshots before Wrangler uploads the assets.

Apply migrations and register benchmark data explicitly:

```bash
pnpm --dir server migrate:remote
python3 scripts/sync_registry.py
python3 scripts/sync_rated_pool.py
python3 scripts/sync_cloudflare.py --db runs/chessbench.db
```

Set `CHESSBENCH_API` and `CHESSBENCH_INGEST_TOKEN` for result sync. Set the same token as the Worker `INGEST_TOKEN` secret.

For a manual deployment, run `pnpm --dir server deploy`. This command builds the site, removes raw run assets, applies migrations, and deploys the Worker.

## Documentation

- [Rated puzzle sessions](docs/RATED_SESSIONS.md) defines the primary adaptive benchmark.
- [Suite catalog](docs/SUITES.md) lists canonical, previous, diagnostic, and legacy suites.
- [Campaigns](docs/CAMPAIGNS.md) defines published fixed campaigns.
- [System design](docs/DESIGN.md) explains benchmark and storage decisions.
- [Esoteric corpus](docs/ESOTERIC_CORPUS.md) explains composed-problem sourcing and verification.
- [Historical corpus](docs/HISTORICAL_CORPUS.md) explains the candidate-position review bank.
- [Frontier probes](docs/FRONTIER_PROBES.md) records bounded frontier-model checks.
- [Legacy inventory](docs/LEGACY.md) identifies retained compatibility surfaces and one-time utilities.

## Verification

```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest -q
python3 -m mypy chessbench --ignore-missing-imports
pnpm --dir server test
pnpm --dir server typecheck
pnpm --dir web lint
pnpm --dir web build:deploy
```

The `PYTEST_DISABLE_PLUGIN_AUTOLOAD` setting avoids unrelated global pytest plugins. The project tests do not require those plugins.

## Repository map

```text
artifacts/         Compact, reviewable campaign results
campaigns/         Ordered campaign and run manifests
chessbench/        Python protocols, graders, providers, and persistence
corpora/           Versioned source collections and rated-pool artifacts
docs/              Canonical methodology and maintenance notes
registry/          Model registry
scripts/           Curation, execution, export, and sync utilities
server/            Cloudflare Worker, D1 schema, and JSON API
suites/            Frozen executable suite manifests
tests/             Python protocol and persistence tests
web/               React dashboard and result-free offline fixtures
```
