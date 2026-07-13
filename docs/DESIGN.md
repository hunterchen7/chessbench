# chessbench — design & feature plan

_Generated from a multi-agent design pass; the roadmap the current build follows._

## Vision

chessbench is a reproducible, condition-explicit chess benchmark whose results become a living, shareable website. The Python core runs models (and humans, and engines) over frozen puzzle/composed/game suites under explicitly declared conditions, and writes every attempt — the raw response, the parsed move, the optional natural-language explanation, legality, cost/latency, and a running Elo-after-each-puzzle trajectory — into a single SQLite database that is the source of truth. A one-command `export` snapshots that database into an immutable, versioned JSON tree, and a self-contained static React SPA turns it into leaderboards (headline and per-category, with confidence intervals), per-model Elo trajectories, a per-puzzle browser where a human can solve the exact position and compare their move and reasoning against every model's move and reasoning, and a tournament/PGN viewer.

The pieces fit as a strict one-way pipeline: a model registry + run plans make "add a model / add a suite / add a condition" a single incremental command that only computes what is missing; the store makes cross-run questions ("how did every model do on THIS puzzle", "who's best at forks") trivial joins; the export makes sharing just hosting files; and the SPA is pure read, so it deploys anywhere with zero ops. Everything downstream — categories, human play, explanations, tournaments — is additive data on the same spine, never a fork of it.

## Master feature list

Tags: priority P0/P1/P2, effort S/M/L. Deduped across the six slices; where slices overlapped (SQLite store, export, explanation capture, sequential Elo, taxonomy) they are merged into one canonical feature.

## Data model & persistence
- **SQLite store + schema.sql + PRAGMA migrator (WAL)** — P0/L. `chessbench/store/`, single file `runs/chessbench.db`, stdlib only. The shared backend for CLI and web export.
- **Run/cell model + per-item puzzle & composed persistence** — P0/M. `run` row = one (model, track, suite_hash, condition) cell; `puzzle_result`/`composed_result` capture raw_response, parsed_move, moves_played, explanation, solved/score, legality, illegal_attempts, failure_reason, solver_plies/plies_correct, latency_ms, tokens, cost. One txn/item; `UNIQUE(run_id,seq)` = idempotent resume.
- **Sequential Elo trajectory (per item)** — P0/M. `elo_after`+CI as canonical MLE-prefix over items[:k] (reuses `rating.puzzle_elo`, converges exactly to headline), plus optional online Glicko overlay. Stored in ascending-rating `seq` order.
- **Static JSON export tree (`chessbench export`)** — P0/M. Emits versioned, content-hashed `index/leaderboard/runs/puzzles/puzzle_index/tournaments/games/taxonomy` JSON. The SPA's only data source.
- **Model registry (`registry/models.json`) + ModelEntry + resolve()** — P0/S. Typed records (key, provider, model_id, family, pricing, context, tags, enabled). Replaces ad-hoc `_build_model` strings.
- **Run rollup + leaderboard.json** — P1/S. `finalize_run` denormalises headline metrics; export keys leaderboard by model × suite × condition × category so the SPA lands instantly.
- **Per-puzzle cross-run index export** — P1/S. `puzzle_index/<puzzle_id>.json` = every model's attempt on the exact puzzle + puzzle content/solution. Powers the compare browser.
- **Game/tournament storage** — P1/M. `tournament/game/game_move/tournament_standing`; whole PGN on `game`, per-ply detail (san/uci/fen_before/eval_cp/cp_loss/explanation/tokens/cost) on `game_move`; `pairing_id` links color-swapped games.

## Model enrollment, plans, cost control
- **`chessbench models {add,list,enable,disable,remove,show}`** — P0/S. Manage the registry; `--from openrouter:<id>` prefills family/context/pricing.
- **One-command incremental `enroll` / `run-model <key> --plan`** — P0/M. Expand plan → cells, skip completed, run the rest, rollup, export. Resumable, idempotent.
- **RunPlan config (`plans/*.json`)** — P0/S. Declares tracks, suites, condition matrix (cartesian or explicit), sampling limits, games spec, budget block. Ships `headline.json` and `ablation.json`.
- **Budget + rate-limit controls** — P0/M. `MeteredModel` wrapper reads `last_cost` (OpenRouter) or estimates tokens×registry pricing (OpenAI/Anthropic) into a thread-safe `BudgetLedger`; `BudgetExceeded` halts cleanly and marks the in-flight cell `partial`; `--concurrency N` ThreadPool fan-out; retry/backoff+jitter on 429/5xx.
- **`chessbench {status,cost,coverage}` reporting** — P1/S. Read-only store queries: per-model cell coverage (done/partial/missing), spend by model/track/day, model×suite gap matrix.
- **`run-plan --models a,b,c` batch enroll** — P2/S. Same plan across several keys under one shared ledger/global cap.

## Games & tournaments
- **Schedule-first tournament core (GameSpec + Scheduler + Runner)** — P0/M. `tasks/schedule.py`; deterministic `game_id` = hash of pairing so re-scheduling reproduces existing ids → incremental/resumable. `round_robin` reimplemented over it; `tournament_elo`/Standing/crosstable unchanged.
- **Opening book / start-FEN diversification** — P0/M. `book.py` curated balanced start FENs. The only way to get >1 distinct game per color-pair at temp 0.
- **Paired-opening color balancing** — P0/S. For each {A,B} and opening emit (A-white,B-black) and (B-white,A-black); games_per_pair = 2·n_openings.
- **Persistent resumable RunStore for games** — P0/M. (Same DB.) Runner skips any spec whose game_id already has a completed row.
- **Incremental add-a-model** — P0/S. Re-run scheduler over enlarged roster, diff vs stored ids, play only the new pairings, refit Elo over all games.
- **Gauntlet-vs-anchor + Stockfish ladder** — P0/M. `GauntletScheduler`: candidates play only pinned Stockfish anchors → O(models) absolute-scale placement.
- **Eval-based resignation & draw adjudication** — P0/M. `resign_cp/resign_plies`, `draw_cp/draw_plies` cut model calls on decided games (the main cost lever).
- **Up-front cost estimator + cap** — P0/M. `cost.py estimate_cost(schedule, price_table)` prints per-model games/calls/tokens/USD; `--max-cost` aborts/trims; live spend from `model.total_cost` stops at cap.
- **SPRT early-stop + games-for-CI** — P1/M. `stats.py`; stop a matchup once decided; plan target-CI game counts.
- **Rating-history trajectory** — P1/S. Refit + append `rating_history` per player after each game/round → tournament Elo-over-time.
- **JSON export + result schema (standings/crosstable/games/history)** — P1/S. Stable schema the SPA/CI consume; PGN export retained.
- **Swiss pairing format** — P2/M. `SwissScheduler` lazily pairs by standings for large fields.

## Prompting & explanations
- **Reply-format Condition axis (BARE/TAGGED/JSON + ExplainMode)** — P0/S. Orthogonal axes `reply_format`, `explain(off|optional|require)`, `capture_reasoning`, `judge_explanations`. HEADLINE stays bare/off (byte-identical to today; existing hashes untouched).
- **Explanation-aware parser `extract_reply()`** — P0/M. Returns `{move, move_token, explanation, confidence, reasoning, format_ok}`; tries JSON → tagged → today's legal-token fallback. Legality still python-chess only. `extract_move` kept for composed/line tracks.
- **Prompt rendering for explanations** — P0/S. Format-aware trailer in `build_puzzle_prompt`/`game_system_prompt`; resolves the MINIMAL "no explanation" contradiction.
- **Explanation fields on results + MoveContext back-channel** — P0/M. Per-solver-ply `explanations/confidences/reasonings/raw_responses` on `PuzzleResult`; same on the game move log; threaded via existing `MoveContext` (no Agent-protocol change).
- **Heuristic explanation scoring** — P1/M. No-API faithfulness signals (mentions chosen move/dest square, mentions real theme, on-topic) at grade time.
- **Web per-puzzle explanation display** — P1/M. Move + right/wrong badge + explanation + confidence bar + collapsible CoT; optional calibration column on leaderboard.
- **LLM-judge explanation faithfulness** — P2/L. Opt-in judge scores reasoning↔move faithfulness and reasoning↔real-tactic; batched, cached, off hot path.
- **Provider-level CoT capture (ModelReply)** — P2/M. Widen Model boundary to return visible text + native reasoning (Anthropic thinking, OpenAI reasoning); isolated behind optional type.

## Taxonomy & esoteric coverage
- **`taxonomy.py` faceted Category registry + `data/taxonomy.json`** — P0/M. Nine facets (track/genre/motif/mate/phase/tier/length/material/condition); motif/mate ids mirror Lichess theme strings for 1:1 mapping.
- **`tag()` derivation + backfill** — P0/M. Pure `tag_puzzle`/`tag_composed` → sorted namespaced ids; one-shot backfill writes `tags` onto every item and re-freezes suites. Deterministic, unit-tested.
- **Difficulty tiers + composed tier heuristic** — P0/S. Six rating bands novice→master; `tier_for_rating` (puzzles), `composed_tier(kind,n)` (composed).
- **Per-category suite builder** — P0/M. `Suite.category` + `build_category_suites(facets,min_items)`; each category with enough items → frozen content-hashed suite, tier-stratified; public/private split preserved.
- **Per-category leaderboard aggregation** — P0/M. `CategoryLeaderboard` joining tagged per-item results × models → solve-rate + Wilson CI + puzzle-Elo per category; `leaderboard --category motif:fork`.
- **Mate-pattern & phase detectors** — P1/M. Geometric detectors so contamination-free generated items still get mate:/phase: tags.
- **Extend StipulationKind / AnswerShape** — P1/M. helpstalemate, selfstalemate, series_selfmate/reflexmate, retro_lastmove, min_mate, construction; new retro/count/construction answer shapes.
- **New native solvers (stalemate-goal, series-selfmate, longer n)** — P1/L. In `solvers/`, no Popeye dependency.
- **Category taxonomy in export + web facet filter/pages** — P1/L. Facet sidebar + category selector generated from the registry with live counts; `browse?tag=…&tier=…` AND-across/OR-within.
- **Soundness-checked brute-force discovery pipeline** — P1/L. `scripts/discover_composed.py`; emit only sound problems (unique key/solution). Auto-tags.
- **Stockfish directmate harvest** — P1/M. #2–#5 from mateInN FENs + mate-score search; validate each.
- **Retro/last-move, min-mate/construction, tablebase studies, PDB import, reserved fairy facet** — P2 (L/M/M/M/S). Longer-tail esoteric coverage and curated hard problems.

## Web app
- **Static export command** — (same as data-model export) P0/M.
- **Leaderboard page(s) with per-setting Elo + CIs** — P0/M. Sortable table per suite×condition; puzzle-Elo error-bar cell, solve-rate Wilson CI, mean score, legal%. Suite/condition tabs + category dropdown.
- **Model detail page + Elo-after-each-puzzle trajectory chart** — P0/M. Recharts line of running Elo vs puzzle index (easy→hard) with CI band + solved/failed markers; per-category bars, bucket curve, failure breakdown, cost/latency.
- **Per-puzzle browser: human solve + LLM comparison** — P0/L. react-chessboard from FEN, chess.js validates the solution line (partial credit, retry/reset/show-solution); right rail = every model's move (SAN+UCI), correctness badge, explanation, hover-to-arrow. Human attempts in localStorage/IndexedDB.
- **Puzzle index / filter list** — P1/S. Filter by tier/category/source/solved-by-N; entry point for next-puzzle nav.
- **Tournament viewer: crosstable + standings** — P1/M. W/D/L, illegal-forfeits, game-Elo+CI, optional anchor; head-to-head heatmap linking to games.
- **Game viewer with PGN replay** — P1/M. Step-through board, move list, autoplay, termination, per-move legality/eval sparkline.
- **Sequential-Elo climb + human puzzle-Elo on shared board** — P1/M+S. Rating-ascending "climb", recompute prefix Elo per attempt; humans appear on the leaderboard via a JS port of `puzzle_elo`.
- **Practice mode (non-rated)** — P1/M. Takebacks, hints, engine-eval; excluded from Elo.
- **Optional FastAPI+SQLite sidecar (authoritative human regrade + shared leaderboard)** — P2/L. `step_puzzle`/`grade_puzzle` reused as source of truth; JS grader pinned by golden vectors; opt-in shared submissions re-graded server-side. Same JSON shapes, swapped via `VITE_DATA_BASE`.
- **Comparison filtering & multi-model move overlays** — P2/S.

## Architecture

## End-to-end architecture

Three tiers, one direction of data flow. The benchmark core never knows the web app exists; the web app never touches SQLite.

```
┌─────────────────────────────────────────────────────────────────────┐
│  BENCHMARK CORE (Python, existing + new)                             │
│  registry.py ─ resolve(model_key) ─▶ MeteredModel(Model, ledger)     │
│  plan.py ─ RunPlan.expand() ─▶ [Cell(model,track,suite_hash,cond)]   │
│  tasks/{puzzles,composed,games,schedule}.py ─ run only missing cells │
│  rating.py (unchanged) ─ puzzle_elo / tournament_elo (+ CI)          │
└───────────────────────────────┬─────────────────────────────────────┘
                                 │ writes one txn per item (idempotent)
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  PERSISTENT STORE  runs/chessbench.db  (stdlib sqlite3, WAL, gitignored) │
│  SOURCE OF TRUTH. Tables: model, run(=cell), puzzle_result,          │
│  composed_result, tournament, game, game_move, category,            │
│  item_category, rating_history, explanation_score                    │
└───────────────────────────────┬─────────────────────────────────────┘
                                 │ chessbench export (immutable, hashed)
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  SHARED READ FORMAT  webapp/public/data/*.json  (versioned tree)     │
│  index · leaderboard · runs/<id> · puzzle_index/<pid> ·             │
│  puzzles/<hash> · tournaments/<id> · games/<id> · taxonomy           │
└───────────────────────────────┬─────────────────────────────────────┘
                                 │ fetch ./data/*.json (static)
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  WEB APP  webapp/ (Vite + React 18 + TS, hash router)                │
│  Leaderboard · ModelDetail(trajectory) · PuzzleBrowser(human solve   │
│  + LLM compare) · Tournament crosstable · Game PGN viewer            │
│  chess.js (rules) · react-chessboard (board) · Recharts (charts)     │
│  ── OPTIONAL P2 ── FastAPI sidecar reuses step_puzzle/grade_puzzle   │
│     as authoritative grader for RATED human attempts; same JSON shapes│
└─────────────────────────────────────────────────────────────────────┘
```

### Repo layout (single repo, two roots)

```
chessbench/                     # Python benchmark core (existing pkg extended)
  rating.py suite.py conditions.py report.py agents.py types.py   # existing, mostly unchanged
  core/{board,engine,metrics}.py
  tasks/{puzzles,composed,games,tournament,runner,schedule}.py    # schedule.py NEW
  models/{base,openai_compat,anthropic}.py
  registry.py            # NEW  model registry (registry/models.json)
  store/                 # NEW  sqlite store: __init__.py, schema.sql, migrate.py
  plan.py budget.py cost.py stats.py book.py taxonomy.py          # NEW
  export.py             # NEW  DB -> static JSON tree
  server.py            # NEW (P2) FastAPI grader sidecar
  __main__.py           # extended: enroll/run-model/run-plan/models/export/status/cost/discover
registry/models.json    # committed model registry
plans/{headline,ablation}.json
data/{taxonomy.json, books/opening_suite_8ply.json}
suites/{public,private}/*.json  (+ manifest.json)
runs/chessbench.db      # gitignored source of truth
webapp/                 # separate static SPA
  public/data/          # export target (gitignored except a tiny sample)
  src/{pages,components,lib}/
scripts/{backfill_tags,discover_composed,dump_grade_vectors}.py
```

### Data flow, run → store → web

1. `chessbench run-model gpt-4o --plan plans/headline.json` → `registry.resolve` wraps the model in `MeteredModel` (cost + retry/backoff over a shared `BudgetLedger`), `plan.expand()` yields Cells, `store.has_cell()` skips completed ones, the existing `run_puzzles`/`round_robin` execute the rest, each item is written in one transaction (`UNIQUE(run_id,seq)` makes resume idempotent), `finalize_run` denormalises the headline rollup and computes the sequential-Elo trajectory.
2. `chessbench export --out webapp/public/data` snapshots the DB into the immutable, content-hashed JSON tree (this is the only seam the SPA sees).
3. The SPA fetches `./data/*.json` relative to itself, so `webapp/dist` runs unchanged on GitHub Pages, S3, or `python -m http.server`. Sharing = committing/hosting the JSON.

### Stack choices (decisive)

- **Store:** stdlib `sqlite3`, single file `runs/chessbench.db`, WAL mode, `PRAGMA user_version` migrator. No server, no new dependency. Chosen because the two marquee web features (per-puzzle cross-model browser, per-category leaderboards) are cross-run joins that are one `SELECT` in SQL and O(files) scans over JSONL.
- **Registry:** committed `registry/models.json` (stdlib json, matches the repo's zero-dep ethos and is programmatically upsertable by `models add`).
- **Web read format:** versioned static JSON tree with `schema_version`, content-hashed and immutable.
- **Web app:** Vite + React 18 + TypeScript, hash router (zero-config static hosting), Recharts, chess.js, **react-chessboard (MIT)** over chessground (GPL) to keep repo distribution unencumbered.
- **Human grader (P2):** FastAPI reusing the Python grader (`step_puzzle`/`grade_puzzle`) so humans and LLMs are graded byte-identically; a ~40-line chess.js port drives instant offline UX and is pinned to Python by generated golden vectors.
- **No new hard runtime deps** anywhere in the core (sqlite3, json, hashlib, tomllib all stdlib; PyYAML optional). The SPA's deps are dev-only npm.

## Phased plan

Build order is chosen so every later slice writes into a spine that already exists, and so the first thing shippable is the thing being asked for (a shareable results website).

## Phase 0 — The spine: store + registry + capture plumbing (build FIRST)
Everything else is downstream of persistence, so this comes first.
- `chessbench/store/` (schema.sql + `PRAGMA user_version` migrator, WAL) with `model`, `run`(=cell), `puzzle_result`, `composed_result`, `category`, `item_category`.
- `registry/models.json` + `registry.py` (`ModelEntry`, `resolve()`), replacing `_build_model`.
- Capture plumbing: add `raw_response`, `explanation`, `latency_ms`, `Usage` to `PuzzleResult`/`MoveRecord`; add sibling fields to `MoveContext`; have the runner read the providers' already-tracked `last_usage`/`last_cost` and write one row per item in a transaction.
- **Why first:** the store is the shared read model for *every* other feature (web, categories, human compare, tournaments). Without it results stay ephemeral JSONL and the two marquee web features are impossible.

## Phase 1 — Incremental enroll+run + budget + rollup/export
- `plan.py` (RunPlan, cartesian condition expansion) + `plans/headline.json`.
- `chessbench enroll` / `run-model --plan` with `store.has_cell()` skip, `finalize_run` rollup, and item-level resume.
- `budget.py` (`MeteredModel`, `BudgetLedger`, retry/backoff, `--concurrency`).
- `chessbench export` → the versioned JSON tree (index + leaderboard + runs + puzzle_index).
- **Why here:** turns the store into something you can actually populate cheaply and repeatedly, and produces the JSON contract the SPA is written against. After this phase you can price a model on `--limit 20`, then scale.

## Phase 2 — Web app v1 (the deliverable)
- Vite + React + TS scaffold, hash router, `VITE_DATA_BASE=./data`.
- Leaderboard (Elo+CI, suite/condition tabs), ModelDetail with the **sequential Elo trajectory** chart (MLE-prefix computed at export, SPA just plots).
- Per-puzzle browser with react-chessboard human solve + chess.js validation + localStorage, and the LLM comparison rail (needs explanation capture from Phase 0/3).
- Puzzle index/filter list.
- **Why here:** this is the headline ask — a shareable, zero-ops results site — and it only needs Phases 0–1. Ship `webapp/dist` on GitHub Pages.

## Phase 3 — Explanations end-to-end
- Reply-format Condition axes (BARE/TAGGED/JSON, ExplainMode); `extract_reply()` superseding `extract_move` in `LLMAgent`/`LLMGameAgent`; format-aware prompt trailer.
- Per-ply explanation storage (already has columns) + heuristic scoring; web explanation/confidence display.
- **Why here:** the puzzle browser's "why" column and the calibration story need it, but HEADLINE stays bare/off so nothing before this phase changes.

## Phase 4 — Taxonomy + per-category leaderboards
- `taxonomy.py` + `data/taxonomy.json`, `tag()` + backfill script, tiers.
- `build_category_suites`, `CategoryLeaderboard`, `leaderboard --category`, export of `taxonomy.json` + per-category rollups.
- Web facet sidebar + category pages/filters.
- **Why here:** categories ride on stored per-item results (Phase 0) and enrich the leaderboard/browser (Phase 2) without blocking them.

## Phase 5 — Games & tournaments
- `schedule.py` (GameSpec/Scheduler/Runner) with deterministic ids; `book.py`; paired-opening balancing; game storage; incremental add-a-model.
- Eval-based adjudication, `cost.py` estimator/cap, gauntlet-vs-Stockfish anchor; then `stats.py` (SPRT, games-for-CI) and rating-history.
- Web tournament crosstable + PGN game viewer.
- **Why later:** tournaments are the most expensive and most self-contained track; they reuse `tournament_elo` and the same store, and the web viewers are additive pages.

## Phase 6 — Human-vs-LLM depth + esoteric long tail (P2)
- FastAPI grader sidecar (`step_puzzle`/`grade_puzzle` refactor + golden vectors), opt-in shared leaderboard with server re-grade, practice mode.
- New solvers/answer shapes, discovery pipeline, directmate harvest, tablebase studies, PDB import, LLM-judge faithfulness, provider-level CoT capture.
- **Why last:** all optional polish/scale; none blocks a complete, shareable benchmark.

## Customization guide

Everything a user tunes is data or a flag — no code edits for the common cases.

## Add a model
Edit `registry/models.json` (or `chessbench models add --key gpt-4o --provider openrouter --model-id openai/gpt-4o --price-in 2.5 --price-out 10`, or `--from openrouter:<id>` to auto-fill family/context/pricing). Then `chessbench enroll gpt-4o --plan plans/headline.json` upserts and runs in one shot. It appears in the leaderboard as soon as it's in `index.json`; no UI change. `enabled:false` parks a model without deleting its results. Pricing fallback in `price_prompt/price_completion` covers providers that don't return per-call cost.

## Add / choose suites
Add a suite path to `plan.suites`; its `content_hash` makes it a distinct set of cells (public Lichess-rated and private contamination-free suites coexist). Editing items changes the hash → treated as a new, un-run cell, so stale results are never silently reused. `chessbench suite build` freezes a suite; `build_category_suites(facets=..., min_items=...)` auto-emits per-category suites.

## Pick conditions / settings
Widen the lists in `plan.conditions` (`legality`, `representation`, `notation`, `prompt_style`, plus the new `reply_format`/`explain`) to sweep an ablation — each combination is a new cell, existing cells stay. Or give an explicit `conditions` list of full slugs for a hand-picked matrix. HEADLINE (`Condition()`) is bare/off and byte-identical to today. Explanation capture: `--explain optional|require --reply-format tagged|json|bare --capture-reasoning --judge-explanations --judge-model <id>` (TAGGED recommended for parse-robustness). Enabling explanations produces a new slug (`…__explain-tagged`) so it never collides with headline runs.

## Set budgets & throughput
`plan.budget`: `max_spend_usd` hard-caps a run (or a whole `run-plan` batch under one shared ledger), `concurrency` fans independent puzzles through a ThreadPool, `max_retries`/`backoff_base_s` tune rate-limit resilience. Set the cap low first to price a model on `--limit 20`, then raise. `chessbench cost --by model|track|day` and `chessbench status` show spend and coverage before you launch.

## Games economics
`plan.games`: `games_per_pair` (= 2·n_openings), `openings` (`startpos` | `book:Nply` | curated JSON in `data/books/`), `pairing` (`incremental` only-new vs `full`), Stockfish `anchor` (skill+Elo) for absolute scale, and adjudication (`resign_cp/resign_plies`, `draw_cp/draw_plies`, null to disable). Format is `round_robin|gauntlet|swiss`; gauntlet-vs-anchor is O(models) for cheap placement. Stopping: `target_ci` (auto game count) or `sprt` (early stop per matchup). At temp 0, the opening book is the only source of game diversity — that's the primary cost/variance dial.

## Add esoteric problems
Extend `StipulationKind`/`AnswerShape` and wire the `_ANSWER_SHAPE`/`_LABEL`/`_STIPULATION_HELP` tables + `grade_composed` dispatch; add a verifier in `solvers/`. Source items via `scripts/discover_composed.py --genre helpmate --n 3 --pieces 5 --count 50` (emits only sound problems, auto-tagged), the Stockfish directmate harvest, the tablebase study generator, or `scripts/import_pdb.py` (records source+attribution+license). `composed_tier(kind,n)` maps genre+length to a difficulty band.

## Add categories / taxonomy
Categories are data. Edit `data/taxonomy.json` (or the `CATEGORIES` literal) to add/rename/re-parent a category or remap `aliases`, or edit the `TIERS` table to shift rating bands — then re-run `scripts/backfill_tags.py`. Suites, per-category leaderboards, and the web facet sidebar pick it up automatically via the tag join; a brand-new facet appears in the sidebar with live counts, no code change. Mate/phase detectors are a registry of small predicate functions — add one to detect a new named mate on contamination-free items.

## Web app customization
`VITE_DATA_BASE` (default `./data`) points the SPA at the static bundle or the optional FastAPI sidecar with no code change. Board piece-set/colors live in `src/theme.ts`. Leaderboard state (suite/condition/category) is URL-encoded so any view is a shareable link. New page/track = a page under `src/pages`, a route in `routes.tsx`, and a matching export writer.

## Data schema

Canonical persisted schemas. SQLite is the source of truth (`runs/chessbench.db`); the JSON export is a derived read format. `run` unifies the two slice proposals: it is both a run manifest and the incremental "cell" (unique on model×track×suite×condition), so `has_cell()`/resume and rich manifest metadata coexist.

## SQLite DDL (source of truth)

```sql
-- model registry mirror (registry/models.json is the editable source)
CREATE TABLE model (
  model_id TEXT PRIMARY KEY,          -- stable slug/key, e.g. "openai/gpt-4o" or "gpt-4o"
  display_name TEXT NOT NULL, provider TEXT NOT NULL, api_name TEXT NOT NULL,
  kind TEXT NOT NULL,                 -- llm|engine|baseline
  params TEXT, price_prompt REAL, price_completion REAL,
  meta TEXT, created_at TEXT NOT NULL);  -- params/meta = JSON

-- run == cell (incremental unit) + manifest
CREATE TABLE run (
  run_id TEXT PRIMARY KEY,            -- ULID (manifest) ; cell identity is the UNIQUE below
  kind TEXT NOT NULL,                 -- puzzle|composed|game|tournament
  model_id TEXT REFERENCES model(model_id),   -- NULL for multi-model tournaments
  suite_name TEXT, suite_version TEXT, suite_hash TEXT, suite_visibility TEXT,
  condition TEXT,                     -- Condition.slug() incl. explain suffix
  condition_json TEXT, engine_cfg TEXT,       -- frozen dicts as JSON
  temperature REAL, max_tokens INTEGER, seed INTEGER,
  git_commit TEXT, chessbench_version TEXT,
  started_at TEXT NOT NULL, finished_at TEXT,
  status TEXT NOT NULL,               -- running|complete|failed|partial
  n_items INTEGER, n_done INTEGER DEFAULT 0,
  -- denormalized rollup (finalize_run)
  solve_rate REAL, mean_score REAL,
  puzzle_elo REAL, puzzle_elo_lo REAL, puzzle_elo_hi REAL,
  legal_rate REAL, total_cost REAL, total_tokens INTEGER, notes TEXT,
  UNIQUE (kind, model_id, suite_hash, condition));   -- the cell key -> has_cell()

-- per-item puzzle result (+ sequential Elo trajectory)
CREATE TABLE puzzle_result (
  run_id TEXT NOT NULL REFERENCES run(run_id),
  seq INTEGER NOT NULL,              -- ascending puzzle_rating (charts directly)
  exec_index INTEGER,               -- actual execution order (audit/latency drift)
  puzzle_id TEXT NOT NULL, puzzle_rating INTEGER, puzzle_rd INTEGER,
  themes TEXT, category_ids TEXT, fen TEXT NOT NULL,       -- JSON arrays
  raw_response TEXT, parsed_move TEXT, moves_played TEXT, explanation TEXT, confidence REAL,
  solved INTEGER NOT NULL, score REAL NOT NULL,
  first_move_legal INTEGER, all_moves_legal INTEGER,
  illegal_attempts INTEGER DEFAULT 0, failure_reason TEXT,
  solver_plies INTEGER, plies_correct INTEGER,
  latency_ms INTEGER, prompt_tokens INTEGER, completion_tokens INTEGER, cost REAL,
  elo_after REAL, elo_after_lo REAL, elo_after_hi REAL, elo_after_bounded INTEGER,
  glicko_r REAL, glicko_rd REAL, created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, seq));
CREATE INDEX idx_presult_puzzle ON puzzle_result(puzzle_id);   -- per-puzzle browser
CREATE INDEX idx_presult_run    ON puzzle_result(run_id, seq); -- trajectory scan
-- composed_result: same shape minus rating cols; adds stipulation, n, answer_shape, solution(JSON)

-- games / tournaments
CREATE TABLE tournament (
  tournament_id TEXT PRIMARY KEY, name TEXT, format TEXT,   -- round_robin|gauntlet|swiss
  condition TEXT, config_json TEXT, engine_anchor TEXT, anchor_elo REAL,
  created_at TEXT, status TEXT);
CREATE TABLE game (
  game_id TEXT PRIMARY KEY,          -- deterministic: sha1(tourney|white|black|opening|slug|repeat)
  run_id TEXT REFERENCES run(run_id), tournament_id TEXT REFERENCES tournament(tournament_id),
  round INTEGER, pairing_id TEXT,    -- links the two color-swapped games
  white_model_id TEXT, black_model_id TEXT,
  opening_id TEXT, opening_eco TEXT, opening_name TEXT, start_fen TEXT,
  condition TEXT, result TEXT, termination TEXT, adjudicated INTEGER DEFAULT 0, ply_count INTEGER,
  white_illegal INTEGER DEFAULT 0, black_illegal INTEGER DEFAULT 0, pgn TEXT NOT NULL,
  white_cost REAL, black_cost REAL, white_tokens INTEGER, black_tokens INTEGER,
  started_at TEXT, finished_at TEXT);
CREATE TABLE game_move (
  game_id TEXT NOT NULL REFERENCES game(game_id), ply INTEGER NOT NULL, side TEXT NOT NULL,
  model_id TEXT, san TEXT, uci TEXT, fen_before TEXT,
  raw_response TEXT, explanation TEXT, confidence REAL,
  illegal_attempts INTEGER DEFAULT 0, first_legal INTEGER, eval_cp INTEGER, cp_loss INTEGER,
  latency_ms INTEGER, prompt_tokens INTEGER, completion_tokens INTEGER, cost REAL,
  PRIMARY KEY (game_id, ply));
CREATE TABLE tournament_standing (
  tournament_id TEXT NOT NULL, model_id TEXT NOT NULL,
  games INTEGER, wins INTEGER, draws INTEGER, losses INTEGER, illegal_forfeits INTEGER, score REAL,
  elo REAL, elo_lo REAL, elo_hi REAL, rank INTEGER,
  PRIMARY KEY (tournament_id, model_id));
CREATE TABLE rating_history (
  tournament_id TEXT, model_id TEXT, after_games INTEGER,
  rating REAL, stderr REAL, PRIMARY KEY (tournament_id, model_id, after_games));

-- taxonomy
CREATE TABLE category (
  category_id TEXT PRIMARY KEY,       -- "motif:fork","mate:backRankMate","tier:expert","genre:selfmate"
  axis TEXT NOT NULL,                 -- track|genre|motif|mate|phase|tier|length|material|condition
  parent_id TEXT REFERENCES category(category_id), label TEXT NOT NULL, description TEXT,
  source TEXT);                       -- lichess|derived|native|curated
CREATE TABLE item_category (
  item_kind TEXT, item_id TEXT, category_id TEXT REFERENCES category(category_id),
  PRIMARY KEY (item_kind, item_id, category_id));

-- explanation quality (populated later)
CREATE TABLE explanation_score (
  run_id TEXT, seq INTEGER, judge_model TEXT,
  present INTEGER, mentions_move INTEGER, mentions_theme INTEGER, on_topic INTEGER, heuristic REAL,
  faithfulness REAL, correctness REAL, rubric TEXT,
  PRIMARY KEY (run_id, seq, judge_model));
```

Sequential Elo: present items sorted ascending `puzzle_rating` (ties by `puzzle_id`) = `seq`. Canonical `elo_after[k] = rating.puzzle_elo(items[:k+1]).rating` with CI from `.ci95()`; `elo_after[n-1]` equals the run's headline `puzzle_elo` exactly; railed prefixes store the bound and set `elo_after_bounded=0`. Optional online Glicko-1 overlay (`glicko_r/glicko_rd`, opponent = puzzle_rating, outcome = score) for a smooth "live" curve. Both stored so the SPA does no math.

## JSON export tree (derived read format)

```
webapp/public/data/
  index.json          # {schema_version, generated_at, chessbench_version, models[], suites[], runs[], tournaments[]}
  taxonomy.json       # CATEGORIES grouped by facet + live counts
  leaderboard.json    # rollup keyed by model × suite × condition × category
  runs/<run_id>.json  # manifest + trajectory[] pre-sorted by seq
  puzzles/<suite_hash>.json         # puzzle content+solutions+categories (solve UI)
  puzzle_index/<puzzle_id>.json     # every model's attempt on this exact puzzle
  tournaments/<id>.json  games/<game_id>.json
```

Representative shapes:

```jsonc
// runs/<id>.json trajectory entry
{"seq":0,"puzzle_id":"001wb","puzzle_rating":1076,"themes":["mate","mateIn1"],
 "categories":["mate:backRankMate","phase:middlegame","tier:beginner"],
 "solved":false,"score":0.0,"parsed_move":"e2e4","moves_played":["e2e4"],
 "explanation":"Threatens…","confidence":0.6,"first_move_legal":false,"failure_reason":"illegal",
 "elo_after":300,"elo_after_lo":-24,"elo_after_hi":689,"glicko_r":1350,"glicko_rd":300,
 "latency_ms":812,"cost":0.00012}

// puzzle_index/<puzzle_id>.json
{"puzzle_id":"001wb","fen":"…","solution":["a1a8"],"rating":1076,"rd":74,
 "themes":["mate","mateIn1"],"categories":["mate:backRankMate"],"game_url":"https://lichess.org/…",
 "attempts":[{"model_id":"openai/gpt-4o-mini","run_id":"01J…","condition":"free_form__fen_ascii__san__minimal",
   "solved":false,"score":0.0,"parsed_move":"e2e4","moves_played":["e2e4"],
   "explanation":"…","confidence":0.6,"first_move_legal":false,"failure_reason":"illegal","latency_ms":812}]}

// leaderboard.json row
{"model":"openai/gpt-4o-mini","suite":"tactical-lichess-v1","condition":"free_form__fen_ascii__san__minimal",
 "category":null,"n":66,"solved":1,"solve_rate":0.015,"solve_ci":[0.003,0.081],
 "mean_score":0.02,"legal_rate":0.379,"elo":332,"elo_ci":[-24,689],"elo_bounded":true}

// tournaments/<id>.json
{"tournament_id":"rr-2026-07","format":"round_robin","condition":"…",
 "standings":[{"model":"gpt-4o","wins":9,"draws":4,"losses":5,"illegal_forfeits":1,
   "score":11.0,"elo":1712,"elo_ci":[1637,1787]}],
 "crosstable":{"gpt-4o|claude":[3,2,1]},   // W,D,L row vs col
 "rating_history":[{"model":"gpt-4o","after_games":10,"rating":1680,"stderr":70}],
 "games":[{"game_id":"a1b2…","white":"gpt-4o","black":"claude","opening_id":"ruy_lopez",
   "result":"1-0","termination":"resign_adj","adjudicated":true,"plies":54}]}
```

## Registry (`registry/models.json`) + human attempt (client)

```jsonc
// registry/models.json entry
{"key":"gpt-4o","label":"GPT-4o","provider":"openrouter","model_id":"openai/gpt-4o",
 "family":"gpt-4o","pricing":{"prompt_per_mtok":2.5,"completion_per_mtok":10.0},
 "context_tokens":128000,"tags":["frontier","openai"],"enabled":true,"added_at":"2026-07-13"}

// HumanAttempt (localStorage/IndexedDB; superset of PuzzleResult so it feeds puzzle_elo directly)
{"attempt_id":"…","profile_id":"…","puzzle_id":"001wb","suite_id":"…","category":["motif:fork"],
 "mode":"rated","condition":{"legality":"free_form","notation":"san","representation":"fen_ascii"},
 "moves_played":["a1a8"],"solved":true,"score":1.0,"first_move_legal":true,"all_moves_legal":true,
 "illegal_attempts":0,"solver_plies":1,"plies_correct":1,"failure_reason":null,
 "ms_to_first_move":4200,"ms_total":4200,"per_ply_ms":[4200],"hints_used":0,"takebacks":0,
 "ts_start":"…","ts_end":"…","client_version":"…","grader":"js"}
```

## Key decisions


**Store backend: SQLite vs JSONL-on-disk vs a hosted DB?**  
→ SQLite (stdlib sqlite3), single file runs/chessbench.db, WAL mode, as the single source of truth; export an immutable static JSON tree as the shared read format.  
_All five relevant slices independently converged on this. The two marquee web features (per-puzzle cross-model browser, per-category leaderboards) are cross-run joins that are one SELECT in SQL and O(files) rescans over JSONL. SQLite adds no dependency and no server, gives transactional/idempotent/resumable per-item appends via UNIQUE(run_id,seq), and the shareability objection is fully answered by the static JSON export. Keep the optional --log JSONL as a raw debug sidecar._

**How is the incremental 'cell' modeled — a separate cell table (slice 3) or the run manifest (slice 1)?**  
→ Unify them: one `run` row IS the cell, with UNIQUE(kind, model_id, suite_hash, condition) providing has_cell()/skip and the manifest columns providing provenance. Add item-level resume (skip puzzle_ids already in puzzle_result) on top of cell-level skip.  
_Two tables for one concept invites drift. The run manifest already needs model/suite/condition/status; making that the cell key means enroll, resume, coverage, and export all read one row. Item-level resume is cheap and prevents a partially-run cell from restarting mid-suite after a Ctrl-C or budget halt._

**Web app: static SPA vs SPA + backend?**  
→ Static SPA (Vite + React 18 + TS, hash router) reading a versioned JSON bundle for v1; an OPTIONAL FastAPI+SQLite sidecar (P2) only for authoritative human regrade and a shared human-vs-LLM leaderboard, behind VITE_DATA_BASE.  
_Data is read-mostly and produced offline by expensive batch runs; the headline ask is a shareable zero-ops artifact (GitHub Pages / python -m http.server). The one thing static JSON can't do — cross-device persistence + faked-solve prevention — is exactly what the sidecar adds, and it reuses identical JSON shapes so it's drop-in, not a rewrite._

**Board library: chessground vs react-chessboard?**  
→ react-chessboard (MIT).  
_chessground has marginally nicer UX but is GPL, which encumbers distribution of a bundled frontend. react-chessboard is MIT, has drag/click input and custom pieces/arrows sufficient for the solve + compare + overlay UX, and pairs cleanly with chess.js for local legality/dests._

**Sequential Elo trajectory: MLE-prefix vs online Glicko?**  
→ Canonical = MLE-prefix (re-run rating.puzzle_elo on each easy→hard prefix), computed at export; store an optional online Glicko-1 overlay as a toggle.  
_MLE-prefix is order-independent per prefix and its final point equals the run's headline puzzle_elo exactly, so the chart and the leaderboard number never disagree. Cost is O(n^2) but n is hundreds → <100ms. Glicko-1 (no volatility) is a cheap, smoother 'learning-curve' visual but a different estimator, so it stays an overlay, not the reported number._

**Explanation response contract: default TAGGED, JSON, or bare?**  
→ Support all three as a reply_format axis; default to TAGGED (MOVE:/WHY:/CONFIDENCE:) when explaining; keep HEADLINE bare/off.  
_The existing extractor robustly pulls a move from free text via tagged-answer + legal-token scan. TAGGED keeps a single deterministic MOVE: anchor while leaving WHY: free, so reasoning models can think first with a near-zero parse-failure rate. Strict JSON is brittle for reasoning models at temp>0. Move legality stays python-chess-only, so the benchmark's core measurement is never weakened._

**Model registry format: JSON vs TOML vs YAML?**  
→ registry/models.json (stdlib json), managed via `models add`/`sync`.  
_JSON matches the repo's zero-dependency, data-driven ethos and the existing data/ files, and is trivial to upsert programmatically. TOML (tomllib) and YAML (PyYAML optional) are both viable but add nothing over JSON here; JSON keeps one format across registry, taxonomy, and suites._

**Game diversity at temperature 0?**  
→ temp=0 by default; get diversity from a content-hashed opening book of balanced start FENs (paired openings, both colors), not from raising temperature.  
_At temp 0 every game between the same two models from the same start is byte-identical, so the book is the only way to get independent games while preserving reproducibility. Paired openings (A-white/B-black and B-white/A-black on the same opening) also give standard paired-comparison variance reduction. Expose temperature as an explicit, documented variance dial for those who want it._

**Tournament format priority?**  
→ Ship round-robin (definitive small field) and gauntlet-vs-Stockfish-anchor (O(models) absolute-scale placement) first; Swiss is P2.  
_Three formats are three Schedulers over one store. RR + gauntlet cover the near-term need (rank a small field, cheaply place new models on an absolute scale via pinned anchors). Swiss only matters once the field is too large for RR, so it's deferred without blocking anything._

**Cost control mechanism?**  
→ MeteredModel wrapper reading real last_cost (OpenRouter) or tokens×registry pricing (OpenAI/Anthropic) into a thread-safe BudgetLedger that raises BudgetExceeded at max_spend; plus adjudication and an up-front estimator for games.  
_Puts a hard, resumable cap on spend (in-flight cell marked partial, resumes next run) and prices a run before committing. Eval-based resignation/draw adjudication cuts model calls on already-decided games — the dominant per-game cost lever for LLM tournaments._

**Does explain=require or confidence affect the move score / Elo?**  
→ No — keep move-accuracy and explanation-quality strictly orthogonal; a missing/poor explanation is flagged in explanation_score but never docks the move or the Elo. Treat confidence as descriptive (calibration column) for now.  
_The benchmark's core signal is move correctness; conflating it with explanation compliance would poison comparability across conditions and against historical runs. Confidence-weighted Elo can be revisited later as an explicit opt-in, not a default._

**What gets committed vs gitignored (public/private split)?**  
→ Gitignore runs/chessbench.db (private-suite leakage risk); commit/host only sanitized public exports; export defaults to public-only with an explicit --include-private gate.  
_Private contamination-free suites must not leak into shared artifacts. The DB is the working source of truth (local), the JSON export is the deliberately-scoped shareable snapshot._


## Risks

## Cost
- LLM tournaments are O(models^2) × plies × growing-context tokens — the single biggest spend. Mitigations: gauntlet-vs-anchor (O(models)), eval-based resignation/draw adjudication, SPRT early-stop, up-front `cost.py` estimator + hard `max_spend_usd` cap with resumable partial cells. Still, GROWING context grows ~quadratically in plies and tokenizers differ per provider, so the estimate can be materially off — do a short empirical tokens/ply calibration pass before a big run.
- Puzzle sweeps over a wide condition matrix multiply cost by the cartesian product. Mitigation: price on `--limit 20` first, `chessbench cost`/`status` before launching, shared ledger across a batch.
- OpenAI/Anthropic don't return per-call cost, so spend there is estimated from tokens × a possibly-stale registry pricing table. Mitigation: `models add --from` to refresh pricing; accept small drift for non-OpenRouter providers.

## Scale
- MLE-prefix trajectory is O(n^2) per run; fine at hundreds of puzzles, degrades on very large suites — cap n or memoize, and keep the Glicko O(1) overlay as the fallback visual.
- Per-puzzle sharded JSON (one file per puzzle × attempts) can become many thousands of small files as models × puzzles grow, hurting cold-load and hosting. Mitigation: choose per-suite bundling vs per-puzzle sharding by expected model×puzzle count; consider a hybrid (bundle small suites, shard large ones).
- SQLite is single-writer; concurrent runs writing the same DB can contend. WAL + one writer per process is fine; document that parallel `run-model` invocations should target separate cells or serialize writes.

## Contamination
- Public Lichess-rated puzzles are likely in training data, inflating scores; private generated suites avoid it but have no Glicko anchor, so their difficulty tiers are heuristic (`composed_tier`). Mitigation: keep public/private split first-class, gitignore the DB, gate private results out of exports by default, and calibrate composed tiers empirically from model solve rates once runs exist.
- Suite content-hashing prevents silently reusing stale results when items change (edited suite = new hash = new cell), which is a correctness safeguard, not just hygiene.
- Curated PDB/YACPDB imports may themselves be in training data and carry licensing/attribution obligations — restrict curated (possibly-contaminated) problems to public suites, never private, and record source+license.

## Human data
- Fairness: a human rated attempt is one-shot while a model may run under RETRY/LEGAL_LIST — Elos aren't comparable unless the human is pinned to the compared model's condition. Decide and enforce a canonical human condition per comparison.
- Anti-cheat: server re-grading stops faked solves but not a human using an engine in another tab; the shared leaderboard is honor-system unless a timed, no-eval, attested rated mode is added. Local grader trust: only rated *shared* attempts round-trip to Python; local-only Elo trusts the JS port, which must stay pinned to Python by golden vectors or the whole comparison silently diverges.
- Privacy: human attempts are local/pseudonymous by default; sharing is opt-in and sends minimal fields only. Keep display names out of anything until sharing is explicitly enabled.

## Maintenance
- The JSON export is a versioned contract between two codebases (Python core, TS SPA); a schema change that skips `schema_version` bumps breaks the SPA silently. Enforce `schema_version` checks and keep a tiny committed sample bundle for CI.
- The chess.js JS grader is a re-implementation of subtle Python grading logic (viable-line pruning, partial credit, mate-on-final-ply); drift poisons human-vs-LLM comparisons. Pin it with generated golden vectors asserted in CI; make server-side Python the authority for anything rated.
- Growing surface area (registry, plans, store, taxonomy, schedulers, SPA) risks under-tested seams. Keep the existing 62-test suite green (defaults unchanged), and add tests for: store idempotent resume, extract_reply across formats, tag() determinism, and tournament resumability. Optional-dependency creep (PyYAML, Syzygy, chessground) is avoided by defaulting to stdlib/JSON/MIT choices.