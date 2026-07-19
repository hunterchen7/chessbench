# Rated puzzle sessions

ChessBench has two complementary Standard puzzle protocols. They answer different questions and must not be
collapsed into one score.

## Rated mix

The primary session approximates ordinary Lichess puzzle training. A model configuration starts as a fresh solver
at rating 1500, rating deviation 500, and volatility 0.09. After every completed puzzle, the harness updates its
Glicko-2 state and selects a new, unseen puzzle within 100 rating points of the current estimate from
`rated-lichess-v1`. Selection is deterministic: a versioned SHA-256 priority over the pool hash, session seed,
sequence number, and puzzle ID chooses one eligible puzzle. The band expands only if it is empty. The seed, pool
hash, eligibility band, rating state before and after every attempt, and selector version are part of the run record.

The measurement pool is pinned in the repository, independently of the deployed database. The full source rows live
in `corpora/pools/rated-lichess-v1.csv.zst`; the manifest and hashes live in
`corpora/pools/rated-lichess-v1.manifest.json`; and the inspectable list of all 100,000 puzzle IDs and frozen ratings
lives in `corpora/pools/rated-lichess-v1.index.json`. D1 is a serving copy of this content-addressed release, not its
source of truth.

### Reproducing a pairing

Given solver rating `r`, the selector uses Python ties-to-even `round(r)` as its target. It starts with every unused
puzzle in the inclusive `[target - 100, target + 100]` band. If that set is empty, it expands the radius in increments
of 100 until at least one unused puzzle is eligible. For each eligible puzzle it computes the SHA-256 digest bytes of
this exact UTF-8 string:

```text
deterministic_rating_band_v1:<pool_hash>:<seed>:<sequence>:<puzzle_id>
```

The puzzle with the lexicographically smallest `(digest bytes, puzzle_id)` tuple wins. After the frozen-puzzle
Glicko-2 outcome update, the sequence increments and the selected ID joins the exclusion set. Thus the committed pool
hash, seed, sequence, solver state, and prior IDs completely determine a pairing.

The database-free reproduction command verifies the committed artifact hashes before selecting:

```bash
python3 scripts/reproduce_rated_selection.py --seed 0 --sequence 0 --rating 1500
```

For later steps, repeat `--exclude PUZZLE_ID` for every earlier selection or pass a newline-delimited file with
`--exclude-file used-puzzles.txt`. The canonical implementation is shared with the benchmark runner in
`chessbench/rated_sessions.py`.

The model is never told that it is being benchmarked, never sees the puzzle rating or themes, retains conversation
state only between moves of one puzzle, and starts a new conversation for every new position. Puzzle ratings and
RD are frozen at the corpus snapshot; model attempts do not mutate the source calibration.

The canonical prompt supplies raw FEN plus explicit piece locations and requests one UCI move. It supplies no legal
move list, coaching, explanation request, puzzle rating, or theme. An illegal or wrong move immediately loses that
puzzle. Correct prefixes still earn diagnostic points, but only a complete solution is a Glicko win.

Puzzle grading accepts the frozen source move at each solver turn. On the final solver turn it also accepts any other
legal move that immediately checkmates. This engine-free exception is identical for human training and model
move-by-move or full-line runs, so a source line cannot arbitrarily reject one of two mating moves. The committed
`corpora/pools/rated-lichess-v1.alternate-mates.json` report enumerates every such position in the 100,000-puzzle
pool and can be reproduced with:

```bash
python3 scripts/audit_rated_alternate_mates.py --check
```

Non-mating alternatives are not inferred from a single engine evaluation. Supporting those requires a separately
versioned engine, analysis budget, equivalence threshold, opponent continuation, and accepted answer graph; without
those pinned inputs, human and model results would not be reproducible.

Sessions run for at least 50 puzzles. They stop once solver RD is at most 77, or at a 100-puzzle safety cap. There
is no consecutive-miss cutoff in the rated protocol. A pause caused by credits or an operator is not completion;
the SQLite checkpoint resumes the identical deterministic path later. Calendar-time RD aging is disabled so two
otherwise identical sessions do not receive different scores merely because one was paused overnight.

### Canonical stopping defaults

New rated sessions use these defaults:

| Setting | Default | Purpose |
|---|---:|---|
| Initial rating | 1,500 | Give each model configuration the same starting state. |
| Initial RD | 500 | Start with high uncertainty. |
| Selection radius | ±100 | Select unused puzzles near the current model rating. |
| Minimum puzzles | 50 | Prevent an early rating from becoming a final rating. |
| Target RD | 77 | Stop when the session has the required precision. |
| Maximum puzzles | 100 | Limit cost when RD decreases slowly. |

The session tests the stopping rule after each complete puzzle. It stops at the first state that meets both conditions:

1. The session has at least 50 completed puzzles.
2. The solver RD is not more than 77.

The session stops at 100 puzzles if it does not meet the RD condition. The result record identifies this safety-cap
termination. The dashboard continues to show the final RD, so the safety cap cannot hide the lower precision.

The command accepts controlled overrides. `--min-puzzles` must be at least 1. `--max-puzzles` must be equal to or
greater than `--min-puzzles`. `--target-rd` must be from 45 through 500. Use overrides only for a separately named
methodology. Do not compare an override directly with the canonical leaderboard result.

ChessBench previously used a target RD of 75. Existing runs retain RD 75 in their stored protocol. New runs use RD
77. This change does not modify an old run or its result.

The constants in `chessbench/rated_sessions.py` are the source for the Python API and the command-line defaults:

```text
DEFAULT_RATED_SEED = 0
DEFAULT_RATED_TARGET_RADIUS = 100
DEFAULT_RATED_MIN_PUZZLES = 50
DEFAULT_RATED_MAX_PUZZLES = 100
DEFAULT_RATED_TARGET_DEVIATION = 77.0
```

### Run a canonical session

First, add the provider key to `.env`. Then add or verify the model registry entry:

```bash
python3 -m chessbench models list
python3 -m chessbench models add MODEL_LABEL openrouter PROVIDER/MODEL_ID
```

Run the canonical session:

```bash
python3 -m chessbench rate-model \
  --model MODEL_LABEL \
  --reasoning high
```

The short command uses the canonical pool and all canonical stopping defaults. It captures returned reasoning data,
does not set an output-token cap, writes each completed puzzle to `runs/chessbench.db`, and publishes the final run.

Pin the provider route when provider identity is part of the comparison:

```bash
python3 -m chessbench rate-model \
  --model MODEL_LABEL \
  --seed 0 \
  --reasoning high \
  --target-radius 100 \
  --min-puzzles 50 \
  --max-puzzles 100 \
  --target-rd 77 \
  --capture-reasoning \
  --max-output-tokens 0 \
  --provider-only PROVIDER_SLUG \
  --no-provider-fallbacks \
  --request-timeout 900 \
  --live-sync-every 5
```

Add `--require-provider-parameters` only when the selected endpoint supports every request parameter. Omitting this
flag is part of the model variant. Do not add the flag when you resume a run that started without the flag.

Run additional deterministic selection paths with different seeds:

```bash
for seed in 0 1 2; do
  python3 -m chessbench rate-model \
    --model MODEL_LABEL \
    --seed "$seed" \
    --reasoning high
done
```

Run the same command again after a stop. ChessBench finds the run from its model variant, pool hash, seed, and protocol.
It validates the stored rating path and starts at the first missing puzzle. It does not repeat a completed puzzle.

Changing the seed, reasoning level, provider route, output policy, pool, or stopping values creates a different run.
The stored protocol contains all these values. The JSON export and D1 copy use the same run ID as the SQLite record.

### Use the campaign supervisor

`scripts/supervise_adaptive_runs.py` contains the exact commands for the July 2026 campaign. It restarts stopped
workers and synchronizes active runs every five minutes. The script contains the run IDs from that campaign. Thus,
use it to resume that campaign only. It is not a fresh-run launcher.

For a new campaign, start each seed with `rate-model`. After SQLite creates the new runs, add their run IDs and exact
commands to a new versioned supervisor target list. Commit that target list before the long run starts.

The supervisor is optional. SQLite is authoritative. A terminal, CI worker, or process manager can run the same
`rate-model` command and get the same resume behavior.

A single session is sufficient for a published headline, and its current rating remains visible while it is still
running. When additional seeded sessions exist for the same model configuration, the leaderboard reports their
arithmetic mean and the sample standard deviation across those ratings. Per-session RD remains visible separately:
RD is uncertainty inside one adaptive path, while between-run standard deviation exposes sensitivity to puzzle
selection and nondeterministic model output. Every session remains expandable and linkable so an optional mean
cannot hide a lucky path, an unlucky path, or a provider failure.

Reasoning text and opaque reasoning artifacts are retained in the audit log whenever the provider returns them.
They are not automatically treated as user-visible conversation. In particular, OpenAI encrypted reasoning blocks
returned through OpenRouter Chat Completions are stored but not replayed: later puzzle turns preserve the visible
assistant move and receive a fresh authoritative board plus UCI history. ChessBench has no tool call whose
continuation would require an opaque reasoning block.

Source puzzles with RD below 110 use the full update. For provisional source puzzles, the solver update follows the
Lichess mixed-puzzle weighting: 80% of the computed update on a solve and 30% on a miss. Source puzzle state never
changes. This makes the model rating comparable across runs without allowing benchmark traffic to contaminate the
measurement instrument.

## Theme profile

The profile session measures *where* a model's strength comes from. It draws a fixed quota of random,
rating-matched puzzles from each of twelve broad families:

1. mate;
2. defense;
3. quiet moves;
4. pawn play;
5. endgames;
6. sacrifices;
7. forks;
8. pins and skewers;
9. deflection and removal;
10. discovered attacks;
11. king attacks; and
12. material and tempo.

These families are derived from the original Lichess themes. Membership is multi-label, but the scheduler uses
each puzzle at most once in a session while satisfying the quotas. The theme is **not** named in the prompt;
disclosing it would turn the category into a tactical hint and create a different task.

Each family receives a Bayesian diagnostic estimate and uncertainty interval, shrunk toward that run's overall rating.
The dashboard must show the number of observations and uncertainty interval with every family rating. A radar can
be offered as a compact overview, but the primary view should be a sortable dot/bar chart with confidence intervals
because it makes uncertainty and close comparisons legible. The overall rated-mix score remains the headline;
theme estimates are a diagnostic profile, not twelve additional leaderboard titles. This profile is a future
extension; the canonical v1 rated session currently samples by rating only.
