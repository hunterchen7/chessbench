# ChessBench corpus releases

Corpora are curated data releases, not run outputs. Every public corpus is self-contained and content-addressed;
every model is eventually evaluated on the matching frozen suite.

See [the authoritative suite catalog](../docs/SUITES.md) for exact execution paths, content hashes, prompt
protocols, private suites, superseded releases, and diagnostic-only files.

## Current releases

| File | Track | Items | Source |
| --- | --- | ---: | --- |
| `public/standard-seed-v1.json` | Standard | 100 | Lichess CC0 local seed pool |
| `public/woodpecker-seed-v1.json` | Woodpecker | 60 | Lichess CC0 local seed pool |
| `public/standard-public-v1.json` | Standard | 240 | Lichess CC0, 2026-07-05 full dump |
| `public/woodpecker-public-v1.json` | Woodpecker | 120 | Lichess CC0, 2026-07-05 full dump |
| `public/standard-lichess-v2.json` | Standard | 325 | 300 calibrated core + 25 adaptively gated 3000+ puzzles |
| `public/woodpecker-masters-v1.json` | Woodpecker | 135 | 50 Easy, 50 Medium, 35 Hard; titled-player source games |
| `public/esoteric-seed-v1.json` | Esoteric | 50 | Lichess CC0 + ChessBench original |

These are development-quality seed corpora. The 500-row tactical fixture predates snapshot tracking, so its exact
upstream release date is unknown and honestly recorded that way. It must not be renamed as the headline corpus.

“Woodpecker” describes the full-line recall/calculation protocol. No positions or solution text were copied from
the copyrighted *Woodpecker Method* book; this collection uses CC0 Lichess positions.

## Admission gates

A corpus build fails unless:

1. every source has a URL, license, license URL, and snapshot label;
2. item IDs and task positions are unique;
3. every orthodox setup and solution move is legal;
4. every Woodpecker line contains at least two solver moves;
5. every included composition passes its genre-specific native verifier;
6. the stored validation report is successful; and
7. the file's content hash matches its complete contents.

Standard and Woodpecker are disjoint in the seed release. This keeps track totals independent. A future explicitly
named paired-protocol suite may intentionally reuse items to isolate the effect of move-by-move versus full-line
prompting; it must not be mixed into either headline total.

## Full-dump receipt and release path

Public v1 was built from the 2026-07-05 Lichess snapshot. The sampler scanned 6,057,356 rows, found 4,710,588
meeting its quality/rating filters, and retained 250 stable-priority positions in each of thirteen 200-point bands.
The committed [source receipt](sources/lichess-puzzles-2026-07-05.json) records every parameter and the intermediate
pool hash. `scripts/download_puzzles.py` gives bounded memory without first-row bias.

The v2 curator works directly against the complete compressed snapshot. The checked-in
`sources/lichess-analysis-2026-07-05.json` records all 6,057,356 rows and the actual candidate populations.
`scripts/curate_lichess.py` produces four mutually disjoint releases: public and held-out Standard suites plus
public and held-out titled-player Woodpecker suites. The calibrated core requires at least three solver moves, a
source-game URL, a `master`, `masterVsMaster`, or `superGM` tag, more than 500 plays, and rating deviation below 100.
The scarce 3000–3199 frontier is intentionally smaller and judged separately: Standard admits 25 positions at
RD <110 and popularity ≥85; Woodpecker admits 10 at RD <120 and popularity ≥80. Both still require more than 500
plays. This adaptive rule preserves genuinely difficult material without pretending it is as tightly estimated as
the broad core.

Woodpecker membership is presented in editorial Easy, Medium, and Hard sections. Ratings and RD are retained as
source provenance where Lichess supplies them, but are not the track's scoring system. The
[Deep Blue–Kasparov 1997 game-two position](https://www.kasparov.com/timeline-event/deep-blue/) after 45.Ra6 stays
in the historical review bank rather than the exact-line leaderboard: modern analysis validates `45…Qe3`, but not
the traditional continuation as best play throughout.

`data/curated/candidates/` holds additional famous-game leads with legal UCI replay and explicit line provenance.
Those banks are deliberately not canonical suites. `scripts/validate_historical_candidates.py` checks their
structure and legality; `scripts/review_historical_candidates.py` can produce a pinned, fixed-node engine receipt,
after which a human review must still approve branches and alternate solutions.

Held-out contents and their 256-bit selection seed stay outside Git. Only membership-free corpus/suite manifests are
published from `corpora/manifests/`. A Lichess held-out split prevents benchmark-specific tuning but is only
semi-private because its source pool is public; sealed certification suites should use post-cutoff generated or
newly commissioned problems.

Esoteric private-MVP imports may retain unreviewed source rights, but they must remain in ignored private storage and
carry source IDs so they can be removed or replaced. Generated originals require both the native verifier and an
independent Popeye certificate before admission.
