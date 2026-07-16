# ChessBench

ChessBench is a points-first, tool-free benchmark for language models doing chess. It evaluates four distinct capabilities:

The exact canonical, previous, and diagnostic suite inventory is maintained in
[docs/SUITES.md](docs/SUITES.md).

| Track | Task | Score |
| --- | --- | --- |
| Standard | Solve tactical positions move by move | Up to 1 point per puzzle; correct prefixes receive fractional credit |
| Woodpecker | Return the complete forced line in one response | Up to 1 point per puzzle; valid full-line prefix credit |
| Esoteric | Selfmates, helpmates, reflexmates, proof games, and studies | Up to 1 verifier-awarded point per problem |
| Games | Play complete games against other variants | Win 1, draw 0.5, loss 0 |

Leaderboards rank total points under an identical frozen suite and condition. The dashboard also reports a secondary puzzle-performance rating with a 95% confidence interval, fitted from complete solves against the source puzzle ratings. It is diagnostic—not the official score, not a head-to-head game rating, and not directly comparable to a human over-the-board Elo.

## Evaluation protocol

The three standard board-information prompts are:

1. **Raw** — FEN and piece locations.
2. **Assisted** — Raw plus every legal move in UCI coordinate notation.
3. **Coached** — Assisted plus fixed, non-prescriptive chess calculation considerations.

Canonical puzzle prompts never put SAN in a legal-candidate list. SAN appends `+` to checks and `#` to checkmates,
so a move such as `Qh7#` would disclose a mate-in-one answer. Candidate lists, requested answers, and within-puzzle
move history use UCI under prompt contract `uci_candidates_v1`; that version is included in every condition slug.

Response style is a separate axis. It never changes the Mode 1–3 numbering:

| | Move only | JSON + rationale |
| --- | --- | --- |
| Mode 1 — Raw | `plain_text_v1` | structured move + visible rationale |
| Mode 2 — Assisted | `plain_text_v1` | structured move + visible rationale |
| Mode 3 — Coached | `plain_text_v1` | structured move + visible rationale |

The `move_only` ablation uses `explain=false` and requests only a plain-text move. The `json_rationale` style uses
`explain=true` and the current structured contract:

```json
{"move":"e2e4","rationale":"A concise explanation of why the move is best."}
```

Woodpecker uses the corresponding `{"moves":[...],"rationale":"..."}` shape under `json_rationale`, or a tagged
move line with no explanation under `move_only`. Moves are scored independently
from the rationale. A recoverable move in malformed JSON still receives its chess score while the response is
recorded as a format failure.

Information and conversation state are independent axes. No state ever crosses puzzle boundaries. Multi-move standard puzzles default to one stateful chat inside a puzzle, with the authoritative current position and played line re-sent on each move. `fresh` context reconstructs every turn in a new request as an ablation. Woodpecker is always a single request.

Games default to `hybrid` context: one growing chat per game plus the authoritative position and history on every turn. Illegal moves can cause an immediate forfeit, receive a bounded retry, be prevented with a legal-move list, or count toward an over-the-board cumulative limit.

Evaluated models receive a neutral chess task. They are never told that the request is a benchmark, evaluation, experiment, leaderboard, or scored attempt. They also receive no chess engine, browser, retrieval, code execution, or other tool. OpenAI-compatible requests omit `tools`, `plugins`, and `tool_choice` entirely—there is therefore nothing to invoke, and xAI rejects an orphaned `tool_choice` when no tool list exists. A returned tool call is rejected fail-closed.

The default `prompt_prefix_v1` policy enables provider-side prompt-prefix computation reuse for stateful, multi-turn puzzles and games. It never caches or replays a response. Every puzzle still has a fresh message list and distinct opaque routing key; each player in a game has a separate key. One-shot Woodpecker and composed-problem requests skip explicit cache writes. Raw provider usage plus normalized cache reads, writes, uncached prompt tokens, discounts, and cost are retained per turn and aggregated into exports.

Reasoning effort, exact reasoning-token budget, and output-token cap are part of a model variant's identity. For example, the same provider model at `low`, `high`, and `4096` exact reasoning tokens appears as three distinct rows.

## Puzzle corpora

The checked-in releases contain fast development seeds and the first full-dump public collections:

| Corpus | Items | Admission rule |
| --- | ---: | --- |
| `standard-seed-v1` | 100 | 20 positions in each of five 400-point rating bands |
| `woodpecker-seed-v1` | 60 | 12 per band, at least two solver moves, disjoint from Standard |
| `standard-public-v1` | 240 | 40 positions in each of six bands from 600–2999 |
| `woodpecker-public-v1` | 120 | 20 per band, at least two solver moves, disjoint from Standard |
| `standard-lichess-v2` | 325 | 300-item calibrated core plus 25 adaptively gated 3000+ puzzles |
| `woodpecker-masters-v1` | 135 | 50 Easy, 50 Medium, 35 Hard; long titled-game lines with a separate historical review bank |
| `esoteric-seed-v1` | 50 | Native-verifier-passing non-study compositions with unique starting positions |

The Standard and scored Woodpecker source positions come from the CC0 Lichess puzzle database. The v2 curator streams
all 6,057,356 puzzles in the 2026-07-05 snapshot and freezes mutually disjoint public and held-out suites. Its
Woodpecker material is restricted to puzzles from titled-player games. The older seed uses the repository's 500-row
fixture. Esoteric combines a checked-in development seed with private YACPDB imports and freshly generated
compositions certified by Popeye plus the native verifier. See
[the private-corpus MVP](docs/private-corpus-mvp.md) for the sealed release workflow.

The original [*Woodpecker Method* by Axel Smith and Hans Tikkanen](https://www.simonandschuster.com/books/Woodpecker-Method/Axel-Smith/9781784830540)
trains by solving a fixed puzzle set repeatedly and faster. ChessBench borrows the one-shot full-line recall pressure,
but does not train a model across cycles or share state between repetitions.

The historical curation lab contains 426 public candidate positions spanning 1851–2024: 26 hand-curated classics
plus 400 engine-mined positions from distinct source games. Another 100 engine-mined positions are held out by
source game under the ignored private-data path. The reproducible acquisition lock covers 42 direct-PGN packs and
2,702 parsed games; every mined line is seven UCI plies, passes a fixed-node MultiPV score-gap gate, and retains its
source-artifact SHA-256. These remain **candidates, not scored tasks**: legal replay and fixed-node stability do not
replace best-defense, alternate-branch, overlap, and human editorial review. The Deep Blue–Kasparov 1997 game-two
position is deliberately visible in the lab but excluded from exact-line scoring because modern review disputes the
traditional continuation. See [the historical-game source and review plan](docs/HISTORICAL_CORPUS.md).

Each file in `corpora/public/` includes source URLs, license, snapshot label, deterministic selection parameters,
item-level data, validation statistics, and a tamper-evident content hash. The matching files in `suites/public/`
are the execution artifacts. See [corpora/README.md](corpora/README.md) for the release policy.

Rebuild the seed release or create a larger deterministic Lichess source pool:

```bash
python3 scripts/build_corpora.py
python3 scripts/download_puzzles.py --per-bucket 5000 \
  --snapshot YYYY-MM-DD --out data/lichess_pool_YYYY-MM-DD.csv
python3 scripts/build_corpora.py \
  --tactical-source data/lichess_pool_YYYY-MM-DD.csv \
  --lichess-snapshot YYYY-MM-DD --release public-v1 \
  --include-master --skip-esoteric \
  --standard-per-band 40 --woodpecker-per-band 20
```

Run each frozen collection:

```bash
python3 -m chessbench puzzles --suite suites/public/standard-lichess-v2.json --mode 2
python3 -m chessbench puzzles --suite suites/public/woodpecker-masters-v1.json --mode 4
python3 -m chessbench composed --suite suites/public/esoteric-seed-v1.json
```

The dashboard corpus is built independently from result files, so resetting runs never deletes the tasks:

```bash
python3 scripts/build_public_corpus_bundle.py
python3 -m chessbench export \
  --runs-dir web/public/data/runs \
  --out web/public/data/index.json
```

The export command deterministically indexes puzzle, esoteric/composed, and tournament files beneath the same
`data/` directory. It ignores `index.json`, malformed JSON, and documents with the wrong run schema.

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

Local SQLite uses WAL mode and commits each paid result together with its progress counter. An OS-released executor lock prevents two local processes from issuing the same next paid call for one natural-key run; even an abrupt process death releases it immediately. If credits run out or the process is interrupted, rerunning the same model × suite × condition skips completed items. The sync script marks each D1 delivery independently, so failed uploads remain queued.

Cloudflare serves the Vite dashboard and Worker API from one origin. D1 stores normalized run manifests, incremental item results, events, tournaments, live boards, and per-attempt game transcripts. The dashboard index fetches lightweight manifests first and lazy-loads item payloads only on detail routes.

## Stored audit data

Each model request records:

- system prompt when first introduced;
- exact user prompt and visible provider response;
- parsed move, legality, retry attempt, visible rationale, and JSON-format validity;
- prompt, completion, and reasoning-token counts;
- provider-reported cost.

The model-authored rationale is displayed as an explanation, not represented as faithful hidden chain of thought.
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

Run a paired response-style ablation without changing the information mode:

```bash
python3 -m chessbench run-model --model my-model --suite suites/headline.json --mode 2 --move-only
python3 -m chessbench run-model --model my-model --suite suites/headline.json --mode 2 --rationale
```

For the full Standard 3 × 2 matrix, repeat that pair under Modes 1, 2, and 3. The complete condition slug records
`plain-text-v1` versus `json-rationale` and the exact structured protocol, so results cannot be pooled accidentally.

The frozen Luna/Haiku low-reasoning public campaign contains 20 durable cells
and 4,640 model-item evaluations across Standard, Woodpecker, and Esoteric. Its
exact matrix, dry-run validation, and resumable launcher are documented in
[`docs/CAMPAIGNS.md`](docs/CAMPAIGNS.md).
The paired public game campaign adds six color-balanced conditions across Modes
1–3 and both response styles; its launcher is
`scripts/run_public_game_campaign.py`.

Play and optionally stream a points tournament:

```bash
python3 -m chessbench tournament \
  --models provider/model-a,provider/model-b \
  --provider openrouter --games 4 --context-mode hybrid \
  --mode 2 --move-only --save runs/tournaments/example-move-only.json
```

Use the same command with `--rationale` for the paired JSON + rationale game condition.
During `--stream`, local SQLite remains authoritative and paid play continues if
Cloudflare is temporarily unavailable. Rerunning the identical command replays
every completed game and the latest in-progress board idempotently before play
resumes. A failed final-document upload exits nonzero only after the complete
local tournament JSON has been saved, so the next run publishes it without new
model calls.

## Cloudflare sync and deployment

Set `CHESSBENCH_API` and `CHESSBENCH_INGEST_TOKEN` in `.env`, and set the same token as the Worker's `INGEST_TOKEN` secret. Register exact corpora/suites before syncing results:

```bash
pnpm --dir server migrate:remote
pnpm --dir server deploy
python3 scripts/sync_registry.py
python3 scripts/sync_cloudflare.py --db runs/chessbench.db
```

During credential migration the Worker may also accept `INGEST_TOKEN_V2`; this lets a new local outbox client sync
without invalidating an existing ingestion client. Keep only the credentials that are actively needed.

The dashboard's **Export JSON** control calls `/api/export`. The endpoint supports `track`, `model`, `run`, and
`status` filters and includes its scoring contract in the downloaded document. Public exports contain complete
public-suite items but only aggregate scores and fingerprints for private suites. The benchmark owner can request
an audited raw export with `include_private=1` and the ingestion Bearer token.

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
corpora/           Versioned source collections, provenance, selection, QA reports
registry/          Committed model registry
scripts/           Cloudflare outbox sync and data utilities
server/            Cloudflare Worker, D1 migrations, JSON API
suites/            Frozen suite manifests
tests/             Protocol and persistence tests
web/               React dashboard
```
