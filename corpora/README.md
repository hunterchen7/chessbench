# ChessBench corpus releases

Corpora are curated data releases, not run outputs. Every public corpus is self-contained and content-addressed;
every model is eventually evaluated on the matching frozen suite.

## Current releases

| File | Track | Items | Source |
| --- | --- | ---: | --- |
| `public/standard-seed-v1.json` | Standard | 100 | Lichess CC0 local seed pool |
| `public/woodpecker-seed-v1.json` | Woodpecker | 60 | Lichess CC0 local seed pool |
| `public/standard-public-v1.json` | Standard | 240 | Lichess CC0, 2026-07-05 full dump |
| `public/woodpecker-public-v1.json` | Woodpecker | 120 | Lichess CC0, 2026-07-05 full dump |
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

Private held-out releases should use post-cutoff generated positions, stay outside Git, and keep only their
manifest/hash public. Esoteric expansion should prioritize historically sourced problems with author, publication,
year, stipulation, and explicit redistribution rights; unverifiable or ambiguously licensed collections do not enter
the benchmark.
