# chessbench

A chess benchmarking suite for LLMs, built on `python-chess` + Stockfish. Three
tracks, all verified end-to-end (baselines need no API key; real models run
through OpenRouter/OpenAI/Anthropic):

1. **Puzzles** — tactical puzzles of varying difficulty, from Lichess (CC0) and
   from our own **contamination-free generator**, with partial credit and
   alternate solutions.
2. **Composed / esoteric problems** — directmate, **selfmate, reflexmate,
   helpmate**, **proof games**, and **endgame studies**, graded by a
   *solver in the loop* (native, no Popeye/Jacobi dependency). No existing LLM
   benchmark does this.
3. **Games** — LLMs playing full games against each other and a Stockfish ladder,
   in different prompt / legality / representation / **context** modes.

The design philosophy: every methodology choice the research found to be
*contested* is a reported **ablation axis**, not a hard-coded default.

## Web app

A dependency-free static site (`webapp/`) turns run records into a browsable
results site: a **leaderboard** (puzzle-Elo ± CI, solved/legal/cost per model &
condition), a **model page** with the **Elo-after-each-puzzle** trajectory chart
(easy → hard), and a **per-puzzle browser** where you render the board, **solve it
yourself**, and see how every model did on that exact puzzle — their move,
optional **explanation**, and a solved/partial/legal-wrong/illegal verdict.

```bash
python -m chessbench puzzles --suite suites/public/tactical-lichess-v1.json \
    --agent openrouter --model openai/gpt-4o-mini --explain \
    --save-run webapp/data/runs/gpt-4o-mini.json     # one run record per model
python -m chessbench export                          # -> webapp/data/index.json
python -m http.server --directory webapp 8787        # open http://localhost:8787
```

Run records (`store.py`) are self-contained JSON (manifest + summary + per-puzzle
move/explanation/categories + sequential Elo). Data flows one way: run → JSON →
static site. *(At scale the design recommends a SQLite spine + React/Vite; this
ships a zero-ops v1 on the same JSON contract.)*

## Why (the gap)

A [research sweep](#references) found frontier LLMs are far weaker at chess than
specialist models (no LLM beats the ~1600-Elo Maia engine; puzzle accuracy for
GPT-4.1/Claude-3.7 ~7%), and that the "right" way to prompt/score is
model-class-dependent and contested. Yet **no existing LLM benchmark tests
esoteric composed problems**, controls for **training-data contamination**, or
sweeps the prompting axes on the same models. chessbench targets exactly those gaps.

## Install

```bash
pip install -e .            # runtime: python-chess. Stockfish must be on PATH.
pip install -e '.[dev]'     # + pytest, mypy
# LLM providers are optional; OpenRouter needs no SDK (stdlib HTTP):
export OPENROUTER_API_KEY=...      # or OPENAI_API_KEY / ANTHROPIC_API_KEY
```

## The three tracks

### 1. Puzzles

```bash
# Baselines (no key) prove the pipeline + grading:
python -m chessbench puzzles --agent stockfish --limit 150      # solves ~all
python -m chessbench puzzles --agent random    --limit 150      # ~0%

# A real model under the headline (free-form, unaided) condition:
python -m chessbench puzzles --agent openrouter --model openai/gpt-4o-mini --limit 100

# Our own fresh, contamination-free puzzles:
python scripts/generate_puzzles.py --count 30 --out data/generated_puzzles.json
python -m chessbench puzzles --data data/generated_puzzles.json --agent openrouter
```

- **Grading** validates every move with `python-chess`, accepts **multiple/alternate
  solution lines**, accepts any mate on a line's final ply, and gives **partial
  credit** (`plies_correct / solver_plies`) on multi-move puzzles.
- **Report**: solve rate + Wilson CI, mean partial score, **rating-bucketed
  accuracy + implied rating**, first-attempt legal %, per-theme breakdown.
- **Sourcing**: Lichess (`data/sample_puzzles.csv`; bigger sets via
  `scripts/download_puzzles.py`), quality-curation (`curate_lichess`), and the
  Stockfish generator (`tasks/generate.py`) that mines "only move" tactics from
  random positions — fresh, so they cannot be in pretraining data.

### 2. Composed / esoteric problems

```bash
python -m chessbench composed --solver oracle                       # 6/6 (grader check)
python -m chessbench composed --solver openrouter --model openai/gpt-4o-mini
```

| Genre | Stipulation | Answer | Graded by |
|---|---|---|---|
| Directmate | `#n` | key move | forced-mate search |
| Selfmate | `s#n` | key move | forced-mate search |
| Reflexmate | `r#n` | key move | forced-mate search (reflex move-gen) |
| Helpmate | `h#n` | full 2n-ply line | replay + checkmate |
| Series-directmate | `ser-#n` | move sequence | replay (opponent passes; no check until the mate) |
| Series-helpmate | `ser-h#n` | move sequence | replay (n check-free moves, then opponent mates) |
| Proof game | reach position in n plies | move sequence | replay from start |
| Endgame study | win / draw | interactive play | vs engine defender (win must be *converted* to mate) |

Solvers live in `chessbench/solvers/` and are **unit-tested against independent
brute force** — the bundled `data/composed_problems.json` was built by
`scripts/build_composed_fixtures.py`, which cross-validates every problem with
the same solver that grades models.

### 3. Games

```bash
python -m chessbench play --white stockfish --black random --games 4 --sf-skill 3
python -m chessbench play --white openrouter --black openrouter \
    --white-model openai/gpt-4o-mini --black-model google/gemini-2.0-flash-001 \
    --games 6 --context-mode hybrid --prompt-style coached --legality otb --pgn-out out.pgn
```

Full adjudication (checkmate / stalemate / insufficient / repetition / 50-move /
ply-cap / illegal-forfeit), alternating-color matches, match Elo, PGN export.

## Elo & leaderboards

Two Elo estimators ([rating.py](chessbench/rating.py)), both maximum-likelihood on
the logistic (Elo) model, both returning a 95% CI:

- **Puzzle-Elo** — a performance rating from puzzle results: each puzzle rated R
  is a game the model wins iff it solves it, `P(solve)=1/(1+10^((R-θ)/400))`
  (the Lichess puzzle-rating model), solved by MLE. Every puzzle run reports it.
- **Game-Elo** — from head-to-head games via MAP Bradley-Terry (draws = half, a
  weak prior for identifiability, optional **fixed engine anchors** to set an
  absolute scale).

```bash
# Puzzle-Elo leaderboard on ONE frozen suite (identical items = fair comparison),
# swept across a setting -> Elo per setting:
python -m chessbench leaderboard --suite suites/public/tactical-lichess-v1.json \
    --provider openrouter --models "openai/gpt-4o-mini,meta-llama/llama-3.3-70b-instruct" \
    --legalities "free_form,legal_list" --include-baselines

# Game-Elo from an LLM-vs-LLM round-robin, anchored to a known Stockfish Elo:
python -m chessbench tournament --provider openrouter \
    --models "openai/gpt-4o-mini,meta-llama/llama-3.3-70b-instruct" \
    --games 2 --legality otb --include-random --anchor-elo 1500 --sf-skill 1 --pgn-out t.pgn
```

Example game-Elo (anchored): `stockfish(sk1) 1500*` · `random 1389±426` ·
`llama-3.3-70b 961±542` · `gpt-4o-mini 523±784 (0/6, all illegal-forfeits)` — the
known result that a *legal* random mover beats weak LLMs falls straight out.

## Benchmark suites — same puzzles for every model

A **suite** freezes an exact, content-hashed, rating-stratified set of items so
every model is scored on **identical puzzles** (the basis for a fair leaderboard).

```bash
python -m chessbench suite --source data/sample_puzzles.csv --name tactical-lichess-v1 \
    --visibility public --per-bucket 20 --out suites/public/tactical-lichess-v1.json
python -m chessbench puzzles --suite suites/public/tactical-lichess-v1.json --agent openrouter --model ...
```

**Public vs private (the held-out split).**
- **Public** suites (`suites/public/`, committed) are shareable and reproducible —
  and are sourced from **Lichess, whose Glicko-2 ratings are calibrated from
  millions of solves**, so difficulty is trustworthy. Risk: their positions can
  leak into training data or be gamed, so treat public scores as an upper bound.
- **Private** suites (`suites/private/`, **gitignored**) are the held-out,
  contamination-free measurement, built from the Stockfish **generator** (fresh
  positions that never appeared anywhere). Their ratings are heuristic today;
  engine-ladder calibration to Lichess-comparable ratings is on the roadmap.

Suites embed their items and a `content_hash`; loading verifies the hash so a run
can't silently evaluate a tampered set.

## Help modes & adding models

Runs default to **Mode 2 (hand-holding)** — the legal moves are provided. Three
preset modes dial the help (`--mode {1,2,3}`); games use the same modes plus game
history:

| Mode | What the model gets |
|---|---|
| 1 (raw) | FEN + piece list |
| **2 (default)** | + **legal moves in SAN and UCI** |
| 3 (coached) | + tips (look for checks/captures/threats, calculate, check every piece) |

Add a model once, then run it through suites incrementally:

```bash
python -m chessbench models add --label my-model --provider openrouter --model-id vendor/model
python -m chessbench models                                  # list the registry
python -m chessbench run-model --model my-model --suite suites/public/tactical-public-v1.json --explain
# ^ builds the model, runs the suite under Mode 2, saves a run record; re-running
#   skips the model×suite×condition cell if it already exists (incremental).
python -m chessbench category-leaderboard --dim tier         # per-category rankings
```

Suites ship in two sizes: a **100-puzzle public** suite (Lichess, calibrated
ratings) and a **1000-puzzle private** suite (generated, contamination-free,
gitignored).

## The ablation axes (`chessbench/conditions.py`)

| Axis | Values | Note |
|---|---|---|
| `legality` | `free_form` · `retry` · `legal_list` · `otb` | an **OTB↔online** spectrum: online = illegal impossible (list) or rejected+retried; OTB = illegal allowed, Nth illegal forfeits; free-form = 1st illegal fails (headline) |
| `representation` | `fen` · `fen_ascii` · `fen_unicode` · `piece_list` · `pgn` | how the board is shown (FEN is tokenization-brittle; ASCII/piece-list hedge) |
| `notation` | `san` · `uci` | SAN faces the model (dominant in pretraining); UCI is internal scoring |
| `prompt_style` | `minimal` · `coached` · `cot` · `few_shot` | `coached` = an explicit "find checks/captures/threats" checklist |
| `context_mode` (games) | `fresh` · `growing` · `hybrid` | what the model carries between moves; `fresh` (board+full history re-injected each turn) is the reproducible default |

The **headline** condition is deliberately minimal (`free_form`, `fen_ascii`,
`san`, `minimal`, temp 0) — scaffolds are reported as *deltas*, never baked in.

## Architecture

```
chessbench/
  types.py            # shared typed vocabulary (Message, Literal outcomes/stipulations)
  core/               # board (strict move parse/legality/render), engine (Stockfish), metrics
  models/             # Model protocol + ScriptedModel; OpenAI/OpenRouter (stdlib) + Anthropic
  conditions.py       # THE ABLATION AXES + prompt rendering
  agents.py           # position -> move: Random / FirstLegal / Stockfish / LLM(Game)Agent
  solvers/            # stipulations (directmate/selfmate/reflexmate/helpmate/series), proofgame, studies
  tasks/              # puzzles, generate, composed, games, tournament, runner
  rating.py           # MLE puzzle-Elo + Bradley-Terry game-Elo (with CIs)
  suite.py            # frozen, content-hashed benchmark suites (public/private)
  report.py           # aggregation -> leaderboard with error bars
  __main__.py         # CLI (puzzles | play | composed | suite | leaderboard | tournament)
```

Standalone Python (not a framework plugin) so the solver-in-the-loop and the
model interface stay first-class. `mypy chessbench --ignore-missing-imports` is
clean and the core avoids `Any`.

## Testing

```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest    # 46 tests
mypy chessbench --ignore-missing-imports             # clean
```
> This machine has a broken global `pytest-postgresql` plugin; the env var above
> disables third-party plugin autoload. Engine-dependent tests skip if Stockfish
> is absent.

Verified end-to-end: Stockfish oracle solves puzzles 150/150 and the generated
set; solvers agree with independent brute force (oracle 6/6, random 0/6, and
Stockfish converts the study while random does not); on real models,
gpt-4o-mini is 24% legal free-form vs 100% with a legal-move list, and solves the
composed mate-in-1 but none of the harder esoterics.

## Contamination warning

Public Lichess puzzles and famous games are near-certainly in pretraining data, so
a model may *recall* rather than *compute*. Prefer the **generated** puzzles
(fresh random positions) for clean measurement; treat public-puzzle numbers as an
upper bound.

## Roadmap

- [x] Puzzle track (Lichess + generated + curation; partial credit; alternates)
- [x] Composed/esoteric track (directmate, selfmate, reflexmate, helpmate, series-movers, proof game, study)
- [x] Game track (LLM-vs-LLM / vs-engine; fresh/growing/hybrid; OTB/online legality; match Elo)
- [x] OpenRouter/OpenAI/Anthropic providers; typed, mypy-clean
- [x] Frozen public/private suites + leaderboard (same items for every model)
- [x] Puzzle-Elo (MLE) + game-Elo (round-robin, engine-anchored) with CIs; per-setting Elo
- [ ] Engine-ladder calibration to give private/generated puzzles Lichess-comparable ratings
- [ ] Retrograde beyond proof games (last-move / shortest-proof-game solving)
- [ ] Persisted/accumulating leaderboard store + web view; SPRT early-stopping in tournaments
- [ ] Per-move centipawn/accuracy reporting; the full representation×legality×notation×context ablation study

## References

DeepMind ChessBench (arXiv:2402.04494), Karvonen Chess-GPT (arXiv:2403.15498),
ChessArena (arXiv:2509.24239), LLM Chess (arXiv:2512.01992), ChessQA
(arXiv:2510.23948), Acher "[Debunking the Chessboard](https://blog.mathieuacher.com/GPTsChessEloRatingLegalMoves/)",
dynomight "[more chess](https://dynomight.net/more-chess/)", Toshniwal "Learning
Chess Blindfolded" (arXiv:2102.13249), [Lichess accuracy formulas](https://lichess.org/page/accuracy).

License: MIT (code). Bundled Lichess puzzles: CC0.
