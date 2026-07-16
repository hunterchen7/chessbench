# Esoteric corpus curation

ChessBench's headline esoteric corpus is an editorial data release, not the
first set of positions that a solver accepts. Mechanical soundness is the
admission gate; human-assessed quality and benchmark value determine selection.

The release target is 50 public problems and 10–25 held-out problems in each of
eight genres: selfmate, reflexmate, helpmate, series-selfmate,
series-helpmate, seriesmate, retro/proof game, and artistic directmate. A full
release therefore contains at least 400 public problems and 80 private
problems. Endgame studies and ordinary game tactics are outside this release.

## Evidence record and artifacts

The runnable `ComposedProblem` remains the compact execution format. A separate
`chessbench.esoteric_curation_record.v1` record carries the evidence needed to
decide whether that task belongs in the benchmark. It includes every field in
the corpus handoff: normalized position and stipulation, full solution tree,
variations, twins and intended duals, difficulty, themes and central idea,
selection rationale, original publication and award metadata, source/database
identifiers, validation certificates, independent replay, visibility, scores,
review status, rejection reasons, and curator notes. It also records a rights
status and basis; database availability is not treated as permission to
redistribute a source scan or transcription.

One build writes:

- the full candidate pool;
- the accepted public set;
- the held-out reserve;
- explicit rejections and reasons;
- pending and structurally invalid review queues;
- an exact/mirror/near-position report; and
- exact decision counts plus genre/theme/difficulty distributions.

Candidate, rejected, pending, and reserve records default to ignored
`data/private/` storage. Only approved, independently verified,
rights-cleared records can enter the public artifact.

## Source priority

1. **[FIDE Albums](https://www.wfcc.ch/fide-albums/).** Use the album index and section results as the first
   discovery layer. WFCC describes Albums as three-year collections of the
   best and most representative compositions. Current sections include
   helpmates, selfmates, and retro/proof games; three judges score each entry
   and eight points qualify a problem. Album inclusion is strong quality
   evidence, not a redistribution licence.
2. **[WFCC competitions](https://www.wfcc.ch/competitions/composing/) and published awards.** Preserve the event, section,
   judge, placement, award text, and stable results URL for WCCI, WCCT, official
   tourneys, memorials, and national awards.
3. **[YACPDB](https://www.yacpdb.org/).** Use structured search to discover and normalize candidates, then
   cross-check the original publication. Upstream order or identifier is not a
   quality ranking.
4. **[Die Schwalbe PDB](https://pdb.dieschwalbe.de/) and periodicals.** Use them for original-publication
   recovery, versions, twins, and anticipation leads. The
   [Problemist archive](https://www.theproblemist.org/mags.pl?page=volumes&type=tp)
   is a priority specialist periodical source. Preserve which fact came from
   which source.
5. **Arthurit and specialist books.** Import all available headers, but retain
   records privately until original-source and rights review is complete.
6. **Original generation.** Generate against a named mechanism or geometry,
   not only a random material template. New work still needs Popeye cook
   testing, a separate replay/verifier, thematic annotation, and human review.

Source URLs and retrieval receipts must be stable enough for a second curator
to reproduce the identification. If composer, publication, date, stipulation,
or diagram cannot be confirmed, the problem stays pending.

## Admission gates

A public problem must satisfy all of these gates:

1. The FEN, side to move, stipulation, twins, and historical constraints are
   normalized and checked against the source diagram.
2. Popeye (with version and output hash) reports the intended solution and no
   cook. If Popeye does not support the genre, a named exact solver and its raw
   certificate take its place.
3. A logically independent verifier replays the result. For adversarial genres
   it checks every defense; for cooperative genres it checks every published
   solution; for proof games it checks exact length and the target position.
4. `complete_solution_tree.completeness` is `solver-complete` or
   `source-complete-and-replayed`. A key move by itself never passes.
5. Exact duplicates are resolved. File mirrors and high-overlap positions are
   manually checked as possible versions or anticipations; a geometric match
   is only a lead, never an automatic originality verdict.
6. Public redistribution rights have a recorded basis.
7. A human curator approves the record, supplies a central idea and rationale,
   and gives at least 14/20 overall with no score below 2/5.

Failed mechanical validation is a rejection. Missing provenance, rights,
annotation, or specialist review is pending work rather than a rejection.
Rejections use controlled reasons such as `cooked`, `dual-unintended`,
`unsound`, `duplicate`, `anticipated`, `ordinary-game-tactic`,
`incomplete-solution`, `provenance-unresolved`, `rights-not-cleared`,
`theme-duplicate`, or `low-benchmark-value`, followed by a curator note.

## Curation scores

Each dimension is scored from 0 to 5. Solver success is not one of the score
dimensions.

| Dimension | 0–1 | 2–3 | 4–5 |
| --- | --- | --- | --- |
| Quality | Broken, crude, or serious construction weakness | Sound and coherent, with some economy or thematic unity | Economical, polished, memorable, or award/Album-calibre construction |
| Originality | Known duplicate/anticipation or no review | Familiar mechanism with an individual rendering | Strongly distinctive synthesis, verified against plausible versions |
| Clarity | Theme is incidental or obscured by unthematic play | Theme is readable after analysis | Mechanism is precise, unified, and easy to explain without giving away the key |
| Benchmark value | Mostly normal-chess pattern recall or trivial search | Tests one unfamiliar rule or useful planning mode | Forces a sharp objective shift, has discriminating branches, and supports exact grading |

The public threshold is necessary, not sufficient. Final selection also limits
concentration by composer, publication, primary theme, period, material, and
stipulation length.

## Difficulty

Difficulty is assigned from solving complexity, then calibrated with blinded
human and model pilots. It is not a synonym for stipulation length.

- **Easy:** the unfamiliar rule is the main obstacle; there are few essential
  branches, a direct goal construction, or a short constrained route.
- **Medium:** a quiet key, three or more meaningful defenses/solutions,
  changed play, tempo choice, or one non-obvious historical constraint matters.
- **Hard:** several interacting mechanisms, substantial branching, long
  route/tempo planning, multiple thematic solutions, or coupled retro
  constraints defeat straightforward forward search.

The report exposes distributions rather than hiding editorial imbalance. For a
50-problem genre, the review target is roughly 15 easy, 20 medium, and 15 hard;
exceptions require a note. No composer should normally contribute more than
three public entries to one genre, and no single primary theme should exceed
20% of a genre.

## Genre review prompts

- **Selfmate:** What resource makes Black's mating move compulsory? Record
  every defense, self-block, unpin, interference, line opening, zugzwang, and
  changed continuation.
- **Reflexmate:** Would the play work without compulsory mate-in-one? Tag
  semi-reflex conditions explicitly and reject examples where the reflex rule
  is ornamental.
- **Helpmate:** Preserve all thematic solutions and twins. Distinguish real
  model-mate, tempo, unpin, self-block, switchback, clearance, or promotion
  content from merely cooperative legality.
- **Series-selfmate / series-helpmate / seriesmate:** Record the convention for
  check during the series, every pass-equivalent transition, route, tempo, and
  the final compelled or cooperative mate.
- **Retro/proof game:** Store castling and en-passant rights, retractions,
  capture and promotion accounting, parity/tempo claims, exact shortest
  length, and every unique-history assertion needed for grading.
- **Artistic directmate:** Require distinctly compositional content such as
  Allumwandlung, Excelsior, Grimshaw, Novotny, correction, changed mates,
  switchbacks, model mates, quiet keys, or multiple underpromotions. Positions
  sourced from played games do not qualify merely because the answer is mate.

## Rebuild workflow

Bootstrap the current private YACPDB MVP into evidence records without
inventing missing annotations:

```sh
python3 scripts/bootstrap_esoteric_review.py \
  corpora/private/esoteric-yacpdb-mvp-v1.json
```

Curate one or more record pools and build all artifacts:

```sh
python3 scripts/curate_esoteric.py \
  data/curated/esoteric/seed-selfmate-kopaev-1996.json \
  data/private/esoteric/candidate-pool.json
```

Use `--fail-on-target-gap` for a release build. The command must fail until all
eight public and reserve quotas are actually met.

## Owner-supplied selfmate

The provisional FEN is exact. An exact diagram search returned one YACPDB
record: **Vyacheslav Georgievich Kopaev, Suomen Shakki, March 1996, identifier
2899, s#2, YACPDB 438993**.

Published play:

```text
1.Rcc3! ~ 2.Qxh5+ Nf3#
1...h4 2.Qg4+ Nf3#
1...Qxf5 (Qf7) 2.Rd5+ Nd3#
1...Qe8 2.Rd7+ Nd3#
1...Qh6 (Qg6) 2.Rd6+ Nd3#
```

Popeye 4.101 reports the unique key `c4c3`; its combined output SHA-256 is
`1f9a5e17c64946e140ba111c4e31441f991998719b6fabac1b999c4a14c938fa`.
The native verifier independently finds the same unique key, checks all 28
legal Black replies after it, and an independent replay confirms all 43
terminal mating lines. The complete evidence is checked in at
`data/curated/esoteric/seed-selfmate-kopaev-1996.json`.

Its rubric value is the combination of a quiet key, defense-dependent changed
continuations, and two related Black battery-opening mates (`...Nf3#` and
`...Nd3#`). The project owner explicitly approved it for the public development
catalogue on 2026-07-16, so it is the first v2 record to pass the public gate.

## Current count

The private YACPDB MVP now contains 450 mechanically admitted tasks: 50 in each
of its nine supported categories. Excluding 50 studies leaves 400 candidates
across the eight target genres, including the newly supported 50
series-selfmates. Adding the owner-supplied seed gives a 401-record review pool:
one accepted public record, 210 pending records, and 190 structurally incomplete
records, with zero private quality reserves and zero editorial rejections. The
remaining candidates are not silently promoted from mechanical admission to a
quality judgment. The generated 50-problem MVP likewise remains a smoke-test
source until each record passes this rubric. Aggregate progress is frozen in
`corpora/manifests/esoteric-benchmark-v2-curation-status.json` without exposing
private membership.
