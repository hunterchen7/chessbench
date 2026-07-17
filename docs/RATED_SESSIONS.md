# Rated puzzle sessions

ChessBench has two complementary Standard puzzle protocols. They answer different questions and must not be
collapsed into one score.

## Rated mix

The primary session approximates ordinary Lichess puzzle training. A model configuration starts as a fresh solver
at rating 1500 with high uncertainty. After every completed puzzle, the harness updates its rating and selects a
new, unseen puzzle near the current estimate from `rated-lichess-v1`. Selection is random but seeded and fully
logged. The seed, corpus hash, rating state before and after every attempt, and candidate-selection probabilities
are part of the run record.

The model is never told that it is being benchmarked, never sees the puzzle rating or themes, retains conversation
state only between moves of one puzzle, and starts a new conversation for every new position. Puzzle ratings and
RD are frozen at the corpus snapshot; model attempts do not mutate the source calibration.

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

Each family receives a Bayesian Puzzle Elo estimate and rating deviation, shrunk toward that run's overall rating.
The dashboard must show the number of observations and uncertainty interval with every family rating. A radar can
be offered as a compact overview, but the primary view should be a sortable dot/bar chart with confidence intervals
because it makes uncertainty and close comparisons legible. The overall rated-mix score remains the headline;
theme ratings are a diagnostic profile, not twelve additional leaderboard titles.
