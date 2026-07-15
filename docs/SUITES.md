# ChessBench suite catalog

This is the authoritative inventory of frozen suite files. A **suite** fixes task membership; prompt mode, reasoning
budget, notation, context policy, and legality handling are separate run conditions. Results are comparable only
when both the suite content hash and the complete condition slug match.

## Canonical benchmark suites

These are the suites to use for new model evaluations.

| Track | Suite | Visibility | Items | Content hash | Canonical protocol |
| --- | --- | --- | ---: | --- | --- |
| Standard | `suites/public/standard-lichess-v2.json` | Public | 300 | `sha256:5fe06f759d825898` | Move-by-move; Modes 1–3 × both response styles |
| Standard | `suites/private/standard-heldout-v1.json` | Held-out | 300 | `sha256:0ea544ac7405f5dc` | Move-by-move; certification run after public testing |
| Woodpecker | `suites/public/woodpecker-masters-v1.json` | Public | 125 | `sha256:26c709626e0f4ebd` | Mode 4; complete forced line in one response |
| Woodpecker | `suites/private/woodpecker-masters-heldout-v1.json` | Held-out | 125 | `sha256:5e7e03190877182b` | Mode 4; sealed certification run |
| Esoteric | `suites/public/esoteric-seed-v1.json` | Public | 50 | `sha256:aedbc34a91a528ae` | Genre-specific key, full-line, or interactive verifier |
| Esoteric | `suites/private/esoteric-yacpdb-mvp-v1.json` | Private MVP | 400 | `sha256:f0015eebd7e2ab05` | 50 problems in each of eight genres |
| Esoteric | `suites/private/esoteric-original-mvp-v1.json` | Private generated | 50 | `sha256:066aa9058e8ba4ae` | 10 newly generated problems in each of five genres |

### Standard

`standard-lichess-v2` and `standard-heldout-v1` each contain 50 puzzles in every 400-point band from 600–999
through 2600–2999. They are mutually disjoint and were selected from the complete 2026-07-05 Lichess snapshot.
The model is asked for one solver move at a time. The forced reply is applied by the harness, and state may continue
within that puzzle only. No state crosses puzzle boundaries.

Every Standard suite is evaluated under three independent prompt conditions:

1. **Mode 1 — Raw:** FEN, explicit piece locations, and side to move. Illegal output fails the puzzle.
2. **Mode 2 — Assisted:** Mode 1 plus every legal move in SAN and UCI.
3. **Mode 3 — Coached:** Mode 2 plus the fixed calculation-advice block.

Response style is an orthogonal axis; it does **not** create Modes 4–6. The canonical Standard comparison is the
following 3 × 2 matrix, holding the suite, model variant, context policy, and all other settings constant:

| Board-information mode | `move_only` | `json_rationale` |
| --- | --- | --- |
| Mode 1 — Raw | `explain=false`, `plain_text_v1` | `explain=true`, structured move + visible rationale |
| Mode 2 — Assisted | `explain=false`, `plain_text_v1` | `explain=true`, structured move + visible rationale |
| Mode 3 — Coached | `explain=false`, `plain_text_v1` | `explain=true`, structured move + visible rationale |

`move_only` asks only for a move (or a tagged line where applicable) in plain text. `json_rationale` is the existing
structured contract. Chess points are graded from the parsed move independently of response-format compliance.
The complete condition slug includes `plain-text-v1` or `json-rationale` plus the exact structured protocol, so
the dashboard and database never silently pool the two styles.

The canonical puzzle context policy is `hybrid`: one conversation within a puzzle, with the authoritative position
and played line re-sent each turn. `fresh` is an explicit ablation, not another suite.

### Woodpecker

`woodpecker-masters-v1` and its held-out counterpart each contain 25 titled-player-game puzzles in five 400-point
bands from 1000–1399 through 2600–2999. Every puzzle has at least three solver moves and a source-game URL. They are
mutually disjoint from one another and from the corresponding Standard releases.

Mode 4 is a one-request full-line protocol. It currently supplies FEN plus piece locations, legal SAN/UCI moves, and
the fixed coaching block, then requests the complete solution—including forced opponent replies—as a UCI array.
There is no between-move conversation state because the model answers once.

### Esoteric

The public `esoteric-seed-v1` development suite contains 50 verifier-checked compositions:

| Genre | Items |
| --- | ---: |
| Directmate | 16 |
| Helpmate | 10 |
| Selfmate | 9 |
| Proof game | 7 |
| Reflexmate | 4 |
| Series directmate | 3 |
| Series helpmate | 1 |

The private YACPDB MVP contains exactly 50 each of directmate, selfmate, reflexmate, helpmate, series directmate,
series helpmate, proof game, and study. Its six Popeye-supported composition genres carry Popeye certificates and
native-verifier confirmation. Proof games are replay-verified. Study outcomes are still marked source-claimed and
must not be presented as engine-certified results.

The private original MVP contains 10 each of directmate, selfmate, reflexmate, single-solution helpmate, and unique
three-ply proof game. The first four genres are independently solved by Popeye and checked by the native verifier.

### Games

Games are a track, but not currently a frozen suite JSON. A game experiment is fixed by its participant variants,
condition, seed, games per pairing, maximum plies, and opening policy. The built-in optional opening book contains
10 starting positions and colors alternate. The canonical context policy is `hybrid`; legality policy is recorded
as `free_form`, `retry`, `legal_list`, or `otb`. Scoring is 1 point for a win, 0.5 for a draw, and 0 for a loss.
Response style is recorded separately from the Mode 1–3 board-information preset, enabling the same 3 × 2 game
ablation without changing mode numbers.

### Canonical response-style commands

Run one frozen Standard suite through the complete six-cell matrix:

```bash
python3 -m chessbench run-model --model my-model --suite suites/public/standard-lichess-v2.json --mode 1 --move-only
python3 -m chessbench run-model --model my-model --suite suites/public/standard-lichess-v2.json --mode 1 --rationale
python3 -m chessbench run-model --model my-model --suite suites/public/standard-lichess-v2.json --mode 2 --move-only
python3 -m chessbench run-model --model my-model --suite suites/public/standard-lichess-v2.json --mode 2 --rationale
python3 -m chessbench run-model --model my-model --suite suites/public/standard-lichess-v2.json --mode 3 --move-only
python3 -m chessbench run-model --model my-model --suite suites/public/standard-lichess-v2.json --mode 3 --rationale
```

The same axis applies to games; for example, compare otherwise identical Mode 2 matches with `--move-only` and
`--rationale`. The latter is the default, but the explicit flag is preferred in published experiment scripts.

## Supported previous releases

These remain reproducible for old results but are superseded for new headline evaluations.

| Suite | Items | Content hash | Status |
| --- | ---: | --- | --- |
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
| `suites/public/standard-smoke-v1.json` | 12 | `sha256:6a13da8035f65a2c` | Two puzzles in each Standard rating band |
| `suites/public/woodpecker-smoke-v1.json` | 10 | `sha256:4a2fb14e424a258c` | Two puzzles in each master-game rating band |
| `suites/public/esoteric-smoke-v1.json` | 7 | `sha256:70fb0097ee520bae` | One problem in every public esoteric genre |

## Initial model smoke-test plan

Before paying for full canonical runs, use a bounded subset to verify provider compatibility, structured response
parsing, reasoning accounting, checkpoint/resume behavior, the public suite graders, JSON export, and Cloudflare
sync. The first pass evaluates both `openai/gpt-5.6-luna` and `anthropic/claude-haiku-4.5` through OpenRouter with
normalized reasoning effort `low`. The output protocol cap is 2,048 tokens; it is not a dollar budget or an
early-stop rule.

| Track | Suite/configuration | Prompt modes | Evaluations per model |
| --- | --- | --- | ---: |
| Standard | `standard-smoke-v1` | Modes 1, 2, and 3; `json_rationale` first pass | 36 puzzle attempts |
| Woodpecker | `woodpecker-smoke-v1` | Mode 4 | 10 full-line attempts |
| Esoteric | `esoteric-smoke-v1` | Mode 3 | 7 genre-specific attempts |
| Games | Normal starting position; no opening book | Modes 1, 2, and 3 | 2 games per mode, colors alternating |

This is 53 puzzle/composition evaluations per model. Because Standard is move-by-move, its 12 fixtures contain
32 possible solver turns; the puzzle and composition portion makes at most 113 model requests per model (226 total)
if every Standard line reaches every turn, plus however many turns the six games require. Games use `hybrid`
context, a 200-ply ceiling, and two independent player conversations. Each player receives the authoritative current
position and public move history but never the other player's raw response or rationale.

For this match matrix, Mode 1 uses `free_form`, so one illegal move forfeits; Modes 2 and 3 provide the legal-move
list. The separate `retry` and `otb` legality policies remain explicit game ablations and are not silently mixed into
these six games.

After that compatibility pass, repeat Standard Modes 1–3 with `--move-only` to fill the other three cells before
reporting response-style effects. Treat this as a paired ablation, never as three additional information modes.

As a durability check, interrupt and resume at least one suite run and verify that already-persisted item IDs are
skipped in canonical suite order. Only after every smoke cell passes should the same two variants continue through
the full public matrix: Standard under Modes 1–3, Woodpecker under Mode 4, and Esoteric under Mode 3. Held-out suites
are last, and their item payloads remain sealed in public dashboard reads and exports.
