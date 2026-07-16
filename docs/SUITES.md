# ChessBench suite catalog

This is the authoritative inventory of frozen suite files. A **suite** fixes task membership; prompt mode, reasoning
budget, notation, context policy, and legality handling are separate run conditions. Results are comparable only
when both the suite content hash and the complete condition slug match.

## Canonical benchmark suites

These are the suites to use for new model evaluations.

| Track | Suite | Visibility | Items | Content hash | Canonical protocol |
| --- | --- | --- | ---: | --- | --- |
| Standard | `suites/public/standard-lichess-v4.json` | Public | 250 | `sha256:f14685f412bbcbd7` | Ten rating bands × 25; type-balanced; rating ascending; four methods × both response styles |
| Standard | `suites/private/standard-heldout-v1.json` | Held-out | 325 | `sha256:8ad476ffdb5808c3` | Move-by-move; certification run after public testing |
| Woodpecker | `suites/public/woodpecker-masters-v1.json` | Public | 135 | `sha256:20e309892363e42e` | Mode 4; complete forced line in one response |
| Woodpecker | `suites/private/woodpecker-masters-heldout-v1.json` | Held-out | 135 | `sha256:a6c964a27efa45ad` | Mode 4; sealed certification run |
| Esoteric | `suites/public/esoteric-seed-v2.json` | Public | 51 | `sha256:b6e7e9fdb5c1ba36` | Genre-specific key or full-line verifier; exact dashboard catalogue membership |
| Esoteric | `suites/private/esoteric-yacpdb-mvp-v1.json` | Private MVP | 450 | `sha256:6b3af48d566249c2` | 50 problems in each of nine mechanical categories |
| Esoteric | `suites/private/esoteric-original-mvp-v1.json` | Private generated | 50 | `sha256:066aa9058e8ba4ae` | 10 newly generated problems in each of five genres |

### Standard

The working `standard-lichess-v4` release contains exactly 25 tasks in each of ten human-readable difficulty bands:
600–899, 900–1199, 1200–1499, 1500–1799, 1800–2099, 2100–2399, 2400–2599, 2600–2799, 2800–2999, and 3000–3199.
The narrower upper bands preserve more resolution where model performance begins to fail. Execution remains rating
ascending with puzzle ID as the deterministic tie-breaker.

Within each band, selection aims for four mate, four defensive, four quiet, four pawn/promotion, four endgame, and
five general tactical positions. Because Lichess themes overlap, the builder assigns one primary family using a
documented precedence order. Diversity never bypasses the source-quality gates: core items require more than 500
plays, RD below 100, popularity of at least 90, and a source-game URL; 3000–3199 items keep the play and URL rules
while allowing RD below 110 and popularity of at least 85. When a qualified family is scarce, the target adapts.
The frontier contains the only eligible mate plus five defensive, five quiet, four pawn/promotion, four endgame,
and six general tactical tasks. Every v4 task comes from a distinct source game and is disjoint by source game from
the Woodpecker and evaluator-held Standard releases.

V3 remains immutable because historical runs refer to its 325-item content hash. V4 is still the working MVP suite;
its name will not be incremented again until a deliberately stable release is cut. The held-out v1 certification
suite remains frozen at 325 in the meantime, and public/private results must never be pooled by name alone.
The model is asked for one solver move at a time. The forced reply is applied by the harness, and state may continue
within that puzzle only. No state crosses puzzle boundaries.

Every Standard suite can be evaluated under four independent prompt conditions:

1. **Mode 1 — Raw:** FEN, explicit piece locations, and side to move. Illegal output fails the puzzle.
2. **Mode 2 — Assisted:** Mode 1 plus every legal move in UCI coordinate notation.
3. **Mode 3 — Coached:** Mode 2 plus the fixed calculation-advice block.
4. **Method 4 — Deep coached:** Mode 2 plus the fixed 925-word `deep_coach_v1` calculation framework.

The stable CLI identifier for Deep coached is `--mode 5`, because `--mode 4` already denotes the separately scored
Woodpecker full-line protocol. The web UI presents Deep coached as the fourth Standard method.

SAN candidates are intentionally excluded: `+` marks check and `#` marks checkmate, which would directly leak
forcing and mate-in-one answers. Canonical requested answers and within-puzzle history are also UCI. The prompt
version `uci_candidates_v1` is embedded in the complete condition slug.

Response style is an orthogonal axis. The canonical Standard comparison is the following 4 × 2 matrix, holding the
suite, model variant, context policy, and all other settings constant:

| Board-information mode | `move_only` | `json_rationale` |
| --- | --- | --- |
| Mode 1 — Raw | `explain=false`, `plain_text_v1` | `explain=true`, structured move + visible rationale |
| Mode 2 — Assisted | `explain=false`, `plain_text_v1` | `explain=true`, structured move + visible rationale |
| Mode 3 — Coached | `explain=false`, `plain_text_v1` | `explain=true`, structured move + visible rationale |
| Method 4 — Deep coached (`--mode 5`) | `explain=false`, `plain_text_v1` | `explain=true`, structured move + visible rationale |

`move_only` asks only for a move (or a tagged line where applicable) in plain text. `json_rationale` is the existing
structured contract. Chess points are graded from the parsed move independently of response-format compliance.
The complete condition slug includes `plain-text-v1` or `json-rationale` plus the exact structured protocol, so
the dashboard and database never silently pool the two styles.

The canonical puzzle context policy is `hybrid`: one conversation within a puzzle, with the authoritative position
and played line re-sent each turn. `fresh` is an explicit ablation, not another suite.

### Woodpecker

Woodpecker is organized as a training set, not an Elo ladder. The public and held-out releases each contain 50 Easy,
50 Medium, and 35 Hard positions. Lichess ratings and RD remain
provenance where available, but headline scoring is points and section difficulty is editorial.

The Lichess portion contains 25 titled-player-game puzzles in five internal 400-point source strata from 1000–1399
through 2600–2999, plus 10 scarce 3000–3199 frontier positions. Core items require more than 500 plays, RD below
100, popularity of at least 85, a source-game URL, and at least three solver moves. The Hard frontier retains the
play and line-length requirements while allowing RD below 120 and popularity of at least 80. Public and held-out
Lichess membership is mutually disjoint and also disjoint from Standard.

The [Deep Blue–Kasparov 1997 game-two position](https://www.kasparov.com/timeline-event/deep-blue/) after 45.Ra6
remains a featured Hard candidate, not a scored exact-line item. A pinned Stockfish 18 review finds `45…Qe3` first
among all 31 legal moves, but prefers `47.Qd7+` or `47.Qc7+` to the traditional `47.h4` continuation. It will only
enter a leaderboard suite with first-move or branch-aware grading.

Mode 4 is a one-request full-line protocol. It supplies FEN plus piece locations, legal UCI moves, and
the fixed coaching block, then requests the complete solution—including forced opponent replies—as a UCI array.
There is no between-move conversation state because the model answers once.

The training method described in [*The Woodpecker Method* by Axel Smith and Hans Tikkanen](https://www.simonandschuster.com/books/Woodpecker-Method/Axel-Smith/9781784830540)
repeats the same large puzzle set in progressively less time. ChessBench does not perform model training or carry
state across repetitions; it borrows the full-line recall/calculation shape for a single-response evaluation.

The non-scoring historical bank under `data/curated/candidates/` now exposes metadata for 426 positions: 26
hand-curated classics plus 400 engine-mined positions from different source games. A disjoint 100-position reserve
is split by source-game fingerprint and remains under the ignored private-data path. The generated positions use
seven-ply UCI display lines, pinned Stockfish 18 at 50,000 nodes with MultiPV 5, one position per source game, and
distinct tactical versus quiet-move score-gap gates. Legal replay and fixed-node evidence are necessary but
insufficient for promotion: exact-line tasks still require branch-aware engine and human review. The complete
acquisition, overlap, difficulty, and promotion policy is documented in
[`docs/HISTORICAL_CORPUS.md`](HISTORICAL_CORPUS.md).

### Esoteric

The public `esoteric-seed-v2` development suite contains 51 verifier-checked compositions. It preserves the 50
v1 tasks and adds the fully sourced Kopaev selfmate `yacpdb-438993`, with a Popeye certificate, exhaustive native
verification, complete solution tree, publication provenance, and explicit project-owner approval:

| Genre | Items |
| --- | ---: |
| Directmate | 16 |
| Helpmate | 10 |
| Selfmate | 10 |
| Proof game | 7 |
| Reflexmate | 4 |
| Series directmate | 3 |
| Series helpmate | 1 |

The private YACPDB MVP contains exactly 50 each of directmate, selfmate, reflexmate, helpmate, series selfmate,
series directmate, series helpmate, proof game, and study. Its seven Popeye-supported composition genres carry
Popeye certificates and native-verifier confirmation. Proof games are replay-verified. Study outcomes are still
marked source-claimed and must not be presented as engine-certified results. These are mechanical candidates; the
separate quality-set status is recorded in `corpora/manifests/esoteric-benchmark-v2-curation-status.json`.

The private original MVP contains 10 each of directmate, selfmate, reflexmate, single-solution helpmate, and unique
three-ply proof game. The first four genres are independently solved by Popeye and checked by the native verifier.

### Games

Games are a track, but not currently a frozen suite JSON. A game experiment is fixed by its participant variants,
condition, seed, games per pairing, maximum plies, and opening policy. The built-in optional opening book contains
10 starting positions and colors alternate. The canonical context policy is `hybrid`; legality policy is recorded
as `free_form`, `retry`, `legal_list`, or `otb`. Scoring is 1 point for a win, 0.5 for a draw, and 0 for a loss.
Response style is recorded separately from the four Standard prompt methods, enabling the same 4 × 2 game
ablation without conflating response format with prompt assistance.

### Canonical response-style commands

Run one frozen Standard suite through the complete eight-cell matrix:

```bash
python3 -m chessbench run-model --model my-model --suite suites/public/standard-lichess-v4.json --mode 1 --move-only
python3 -m chessbench run-model --model my-model --suite suites/public/standard-lichess-v4.json --mode 1 --rationale
python3 -m chessbench run-model --model my-model --suite suites/public/standard-lichess-v4.json --mode 2 --move-only
python3 -m chessbench run-model --model my-model --suite suites/public/standard-lichess-v4.json --mode 2 --rationale
python3 -m chessbench run-model --model my-model --suite suites/public/standard-lichess-v4.json --mode 3 --move-only
python3 -m chessbench run-model --model my-model --suite suites/public/standard-lichess-v4.json --mode 3 --rationale
python3 -m chessbench run-model --model my-model --suite suites/public/standard-lichess-v4.json --mode 5 --move-only
python3 -m chessbench run-model --model my-model --suite suites/public/standard-lichess-v4.json --mode 5 --rationale
```

The same axis applies to games; for example, compare otherwise identical Mode 2 matches with `--move-only` and
`--rationale`. The latter is the default, but the explicit flag is preferred in published experiment scripts.

## Supported previous releases

These remain reproducible for old results but are superseded for new headline evaluations.

| Suite | Items | Content hash | Status |
| --- | ---: | --- | --- |
| `suites/public/standard-lichess-v3.json` | 325 | `sha256:a8cd0d9483229abe` | Previous canonical suite; v2 membership in rating order |
| `suites/public/standard-lichess-v2.json` | 325 | `sha256:611c4c22e955ece8` | Same membership as v3; historical puzzle-ID execution order |
| `suites/public/standard-public-v1.json` | 240 | `sha256:5520347416337d14` | Previous full-dump Standard release |
| `suites/public/woodpecker-public-v1.json` | 120 | `sha256:f66bc33d2d4d7897` | Previous full-dump Woodpecker release |
| `suites/public/standard-seed-v1.json` | 100 | `sha256:a4d6750bdb729857` | Fast development seed |
| `suites/public/woodpecker-seed-v1.json` | 60 | `sha256:21c6ae46eb9ccc4f` | Fast development seed |

## Legacy and diagnostic suites

These files predate the corpus-release contract or exist only for calibration and smoke tests. Do not add their
results to a canonical leaderboard.

| Suite | Visibility | Items | Content hash | Purpose |
| --- | --- | ---: | --- | --- |
| `suites/public/tactical-public-v1.json` | Public | 96 | `sha256:dbc5236e81094e35` | Legacy dashboard baseline |
| `suites/public/tactical-lichess-v1.json` | Public | 66 | `sha256:14f9991dc0aecab2` | Legacy Lichess subset |
| `suites/reasoning-mini-v1.json` | Public | 24 | _missing_ | Unfrozen reasoning smoke test |
| `suites/private/tactical-generated-v1.json` | Private | 12 | `sha256:89ea2198c463d05d` | Generator smoke test |
| `suites/private/tactical-private-v1.json` | Private | 1,000 | `sha256:510a0dd0400b2e30` | Superseded generated set |
| `suites/private/tactical-private-cal-v1.json` | Private | 1,000 | `sha256:ea8c9b5d565a02a6` | Superseded calibration set |

The following content-addressed integration suites are intentionally tiny but derived from canonical public
parents. They test paid provider calls and every public suite grader without claiming headline scores:

| Suite | Items | Content hash | Coverage |
| --- | ---: | --- | --- |
| `suites/public/standard-smoke-v1.json` | 14 | `sha256:63ca1208b6c74ec6` | Historical Standard v2-derived smoke suite, frozen in ID order |
| `suites/public/standard-smoke-v2.json` | 14 | `sha256:67c948d7899cfe43` | Historical Standard v3-derived smoke suite, rating-ascending |
| `suites/public/standard-smoke-v3.json` | 20 | `sha256:65463c83a64a0cfe` | Active Standard v4-derived smoke suite; two tasks per rating band |
| `suites/public/woodpecker-smoke-v1.json` | 6 | `sha256:486f9b5e854c299d` | Two scored Lichess puzzles per editorial section |
| `suites/public/esoteric-smoke-v2.json` | 7 | `sha256:607064f731e3dba3` | One problem in every public esoteric genre |

## Initial model smoke-test plan

Before paying for full canonical runs, use a bounded subset to verify provider compatibility, structured response
parsing, reasoning accounting, checkpoint/resume behavior, the public suite graders, JSON export, and Cloudflare
sync. The first pass evaluates both `openai/gpt-5.6-luna` and `anthropic/claude-haiku-4.5` through OpenRouter with
normalized reasoning effort `low`. The output protocol cap is 2,048 tokens; it is not a dollar budget or an
early-stop rule.

| Track | Suite/configuration | Prompt modes | Evaluations per model |
| --- | --- | --- | ---: |
| Standard | `standard-smoke-v3` | Modes 1, 2, 3, and 5; `json_rationale` first pass | 80 puzzle attempts |
| Woodpecker | `woodpecker-smoke-v1` | Mode 4 | 6 full-line attempts |
| Esoteric | `esoteric-smoke-v2` | Mode 3 | 7 genre-specific attempts |
| Games | Normal starting position; no opening book | Modes 1, 2, 3, and 5 | 2 games per method, colors alternating |

This is 93 puzzle/composition evaluations per model. Because Standard is move-by-move, its 20 fixtures contain
69 possible solver turns; the puzzle and composition portion makes at most 289 model requests per model (578 total)
if every Standard line reaches every turn, plus however many turns the eight games require. Games use `hybrid`
context, a 200-ply ceiling, and two independent player conversations. Each player receives the authoritative current
position and public move history but never the other player's raw response or rationale.

For this match matrix, Mode 1 uses `free_form`, so one illegal move forfeits; Modes 2, 3, and 5 provide the legal-move
list. The separate `retry` and `otb` legality policies remain explicit game ablations and are not silently mixed into
these six games.

After that compatibility pass, repeat all four Standard methods with `--move-only` to fill the other four cells before
reporting response-style effects. Treat this as a paired ablation, never as additional prompt methods.

As a durability check, interrupt and resume at least one suite run and verify that already-persisted item IDs are
skipped in canonical suite order. Only after every smoke cell passes should the same two variants continue through
the full public matrix: Standard under Modes 1, 2, 3, and 5, Woodpecker under Mode 4, and Esoteric under Mode 3. Held-out suites
are last, and their item payloads remain sealed in public dashboard reads and exports.
