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

The model is never told that it is being benchmarked, never sees the puzzle rating or themes, retains conversation
state only between moves of one puzzle, and starts a new conversation for every new position. Puzzle ratings and
RD are frozen at the corpus snapshot; model attempts do not mutate the source calibration.

The canonical prompt supplies raw FEN plus explicit piece locations and requests one UCI move. It supplies no legal
move list, coaching, explanation request, puzzle rating, or theme. An illegal or wrong move immediately loses that
puzzle. Correct prefixes still earn diagnostic points, but only a complete solution is a Glicko win.

Sessions run for at least 50 puzzles. They stop once solver RD is at most 75, or at a 100-puzzle safety cap. There
is no consecutive-miss cutoff in the rated protocol. A pause caused by credits or an operator is not completion;
the SQLite checkpoint resumes the identical deterministic path later. Calendar-time RD aging is disabled so two
otherwise identical sessions do not receive different scores merely because one was paused overnight.

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
