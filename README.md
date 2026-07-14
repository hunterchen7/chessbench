# ChessBench

ChessBench is a points-first, tool-free benchmark for language models doing chess. It evaluates four distinct capabilities:

| Track | Task | Score |
| --- | --- | --- |
| Standard | Solve tactical positions move by move | Up to 1 point per puzzle; correct prefixes receive fractional credit |
| Woodpecker | Return the complete forced line in one response | Up to 1 point per puzzle; valid full-line prefix credit |
| Esoteric | Selfmates, helpmates, reflexmates, proof games, and studies | Up to 1 verifier-awarded point per problem |
| Games | Play complete games against other variants | Win 1, draw 0.5, loss 0 |

There is no public Elo score. Puzzle difficulty ratings remain metadata for stratification, while leaderboards rank total points under an identical frozen suite and condition.

## Evaluation protocol

The three standard information prompts are:

1. **Raw** — FEN and piece locations.
2. **Assisted** — Raw plus every legal move in SAN and UCI.
3. **Coached** — Assisted plus a fixed chess calculation checklist.

Information and conversation state are independent axes. No state ever crosses puzzle boundaries. Multi-move standard puzzles default to one stateful chat inside a puzzle, with the authoritative current position and played line re-sent on each move. `fresh` context reconstructs every turn in a new request as an ablation. Woodpecker is always a single request.

Games default to `hybrid` context: one growing chat per game plus the authoritative position and history on every turn. Illegal moves can cause an immediate forfeit, receive a bounded retry, be prevented with a legal-move list, or count toward an over-the-board cumulative limit.

Evaluated models receive a neutral chess task. They are never told that the request is a benchmark, evaluation, experiment, leaderboard, or scored attempt. They also receive no chess engine, browser, retrieval, code execution, or other tool. OpenAI-compatible requests send no tools and explicitly use `tool_choice: "none"`; a returned tool call is rejected.

Reasoning effort, exact reasoning-token budget, and output-token cap are part of a model variant's identity. For example, the same provider model at `low`, `high`, and `4096` exact reasoning tokens appears as three distinct rows.

## Durable architecture

```text
Provider API
    │ exact prompt/visible response + usage
    ▼
Python runner ──transaction per completed item──▶ local SQLite outbox
    │                                                │ resumable/idempotent
    │ game snapshots                                ▼
    └──────────────────────────────────────▶ Cloudflare Worker + D1
                                                     │
                                                     ▼
                                             React data dashboard
                                                     │
                                                     └── filtered JSON export
```

Local SQLite uses WAL mode and commits each paid result together with its progress counter. If credits run out or the process is interrupted, rerunning the same model × suite × condition skips completed items. The sync script marks each D1 delivery independently, so failed uploads remain queued.

Cloudflare serves the Vite dashboard and Worker API from one origin. D1 stores normalized run manifests, incremental item results, events, tournaments, live boards, and per-attempt game transcripts. The dashboard index fetches lightweight manifests first and lazy-loads item payloads only on detail routes.

## Stored audit data

Each model request records:

- system prompt when first introduced;
- exact user prompt and visible provider response;
- parsed move, legality, retry attempt, and visible explanation;
- prompt, completion, and reasoning-token counts;
- provider-reported cost.

Provider-hidden chain of thought is not requested for publication, summarized, or reconstructed.

## Local setup

Requirements: Python 3.10+, Node 20+, and pnpm.

```bash
python3 -m pip install -e '.[dev]'
cp .env.example .env
pnpm --dir web install
pnpm --dir server install
pnpm --dir server migrate:local
```

Put provider credentials in `.env`; it is ignored by Git. Never commit live keys.

List or add a model registry entry:

```bash
python3 -m chessbench models list
python3 -m chessbench models add my-model openrouter provider/model-id
```

Run a frozen suite with durable item-level persistence:

```bash
python3 -m chessbench run-model --model my-model --suite suites/headline.json --mode 2
python3 -m chessbench run-model --model my-model --suite suites/headline.json --mode 3 --reasoning high
python3 -m chessbench run-model --model my-model --suite suites/headline.json --mode 4 --reasoning-tokens 4096
```

Mode 4 is written to the Woodpecker track. `--reasoning` and `--reasoning-tokens` are mutually exclusive.

Play and optionally stream a points tournament:

```bash
python3 -m chessbench tournament \
  --models provider/model-a,provider/model-b \
  --provider openrouter --games 4 --context-mode hybrid \
  --legality retry --save runs/tournaments/example.json
```

## Cloudflare sync and deployment

Set `CHESSBENCH_API` and `CHESSBENCH_INGEST_TOKEN` in `.env`, and set the same token as the Worker's `INGEST_TOKEN` secret. Then:

```bash
python3 scripts/sync_cloudflare.py --db runs/chessbench.db
pnpm --dir server migrate:remote
pnpm --dir server deploy
```

The dashboard's **Export JSON** control calls `/api/export`. The endpoint supports `track`, `model`, `run`, and `status` filters and includes its scoring contract in the downloaded document.

## Verification

```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest -q
python3 -m mypy chessbench --ignore-missing-imports
pnpm --dir server typecheck
pnpm --dir web build
```

The benchmark grader uses `python-chess`; models never determine whether their own move was legal.

## Repository map

```text
chessbench/        Python protocols, agents, graders, persistence, providers
registry/          Committed model registry
scripts/           Cloudflare outbox sync and data utilities
server/            Cloudflare Worker, D1 migrations, JSON API
suites/            Frozen suite manifests
tests/             Protocol and persistence tests
web/               React dashboard
```
