# Historical-game provenance pools for ChessBench Woodpecker

Research date: 2026-07-15

## Recommendation

Use two source tiers, and keep source acquisition separate from benchmark publication:

1. **Publication-cleared primary pool:** Lichess official broadcasts (CC BY-SA 4.0) plus the small CC0 `ChessPGN` collection. These are the lowest-risk sources for a public historical Woodpecker suite.
2. **Private-MVP discovery pool:** PGN Mentor, TWIC, Lichess World Championship studies, and BritBase. They are excellent provenance/index sources, but their download pages do not grant a broad redistribution license (TWIC explicitly says personal use only). For now, use their game scores to locate positions, strip every annotation/comment/NAG/variation, store the source URL, and do not redistribute their raw archives.

The important product distinction is: a source game can enter the mining queue automatically, but **no engine-mined position can enter either a public or private benchmark automatically**. Every promoted item must pass legality, deep-engine stability, overlap, provenance, and human editorial review gates.

## The Deep Blue–Kasparov position

The remembered game is almost certainly **Deep Blue–Kasparov, 1997 rematch, Game 2**, played 4 May 1997. Kasparov resigned after `45.Ra6`. The historically reported resource is `45...Qe3! 46.Qxd6 Re8`, with the idea of perpetual check. Kasparov's own site gives the complete score and describes the reported drawing line: [Kasparov — Man vs Machine](https://www.kasparov.com/timeline-event/deep-blue/).

- Start position (Black to move after `45.Ra6`): `1r6/5kp1/RqQb1p1p/1p1PpP2/1Pp1B3/2P4P/6P1/5K2 b - - 14 45`
- Historical key move: `b6e3` (`45...Qe3`)
- Proposed Woodpecker band: **Hard**
- Proposed objective: **best defensive resource**, not “win material”
- Provenance label: `Deep Blue–Kasparov, New York 1997, match game 2, after 45.Ra6`
- Reveal-after-attempt note: Kasparov resigned; contemporary analysis reported a perpetual-check draw.

There is an important ground-truth wrinkle. A local Stockfish 18 check (single-thread/default hash, 45 seconds, depth 42/seldepth 88) still chose `45...Qe3`, but evaluated the position about **+0.82 for White**, not a forced draw. Modern-engine commentary also disputes the old “forced draw” verdict. Therefore this should not be encoded as an exact, single-PV “forced draw” until a pinned high-node analysis and human master review settle the accepted continuation tree.

Recommended benchmark treatment:

- include it in the editorial queue now as `historical-deep-blue-1997-g2-45`;
- award first-move points for `b6e3` only after the high-node review confirms it remains uniquely best;
- grade later moves by an approved branch tree/evaluation-preservation threshold, not one brittle Stockfish PV;
- label the historical claim separately from the modern adjudication;
- never auto-promote it merely because a source calls it a draw.

## Source matrix

| Source | Coverage and size | Format / cadence | Stated license or terms | Recommendation |
|---|---|---|---|---|
| [Lichess official broadcast database](https://database.lichess.org/) | 1,146,297 official-broadcast games, Jan 2020–Jun 2026; 78 monthly files, 670 MB compressed as of research date | Monthly `.pgn.zst`; download list and SHA-256 manifest | **CC BY-SA 4.0** specifically for broadcast games | Primary modern tournament/WCC source; public-safe with attribution/share-alike compliance |
| [Lichess World Championships index](https://lichess.org/page/world-championships) | Maintained studies covering the generally accepted open WCC lineage, 1886–2024; also a partial women's WCC list and “Apocrypha” | Study-export PGN API; page is manually maintained and studies may change | Page encourages API mining, but no explicit license for study annotations was found | Excellent historical index; ingest mainline scores only, strip study comments/annotations, snapshot hashes |
| [PGN Mentor archive](https://www.pgnmentor.com/files.html) | Site says over 1 million GM games; event archive reaches back to London 1851; individual WCC files 1886–2024; Candidates/Interzonals and famous tournaments; Kasparov player file has 2,128 games | Individual `.pgn` event files and zipped player files; players updated Jul 2026, openings Jan 2026; event cadence irregular | Files called “completely free,” but site is copyright 64 Squares and no reusable-data license is stated | Best broad historical discovery pool for private MVP; do not mirror raw corpus publicly without permission |
| [The Week in Chess archive](https://theweekinchess.com/twic) | Weekly international tournament coverage since issue 1 on 17 Sep 1994; issue 1653 contains 7,961 games; archive lists issue-by-issue counts | Weekly zipped PGN, generally every Monday; no official one-click free bulk archive | **“Free for personal use only. All rights are reserved.”** | Private discovery/reference only; do not use as a redistributable public corpus without written permission |
| [ChessPGN](https://github.com/brianerdelyi/ChessPGN) | 149 selected classic game scores: 60 Fischer games and 89 Tal games, chosen as companions to famous books | Two small PGNs in Git; static (last commit 2023-05-30) | **CC0-1.0** repository license; maintainer explicitly distinguishes game moves from copyrighted commentary | Strong public-safe “famous classic” seed. Use only game scores and original ChessBench editorial notes, not book prose |
| [BritBase](https://www.saund.org.uk/britbase/) | British events from pre-1920 to present, British Championships, Hastings, Gibraltar, Isle of Man, Varsity matches, and player collections; frequently updated; e.g. 1995 British Championship page has 228 main-event games plus 21 subsidiary games | Per-event downloadable PGN; ongoing corrections and historical additions | “All materials” copyright John Saunders. Its published annotation policy avoids intellectual-property annotations, but no broad reuse license is stated | Valuable niche/history pool for private MVP; link to event page, strip annotations, request permission before public redistribution |
| [Chess Super-Tournaments Analyzed](https://huggingface.co/datasets/drmehmetismail/Chess-Super-Tournaments-Analyzed) | 485 MB, 1K–10K files/items according to HF; includes 387 MB Sesse archive through 31 Dec 2024 and super-tournament analyses | Annotated PGN/PV archives; irregular updates; MIT dataset card | **MIT** is stated for the dataset/repo; upstream event-score and Sesse permission scope still deserve attribution review | Use as a *candidate/reference index* and cross-check only. Recompute all lines with pinned ChessBench engine settings |

### Actual download and API endpoints

#### 1. Lichess official broadcasts

- Landing page and authoritative counts/license: `https://database.lichess.org/`
- Plain download list: `https://database.lichess.org/broadcast/list.txt`
- Checksums: `https://database.lichess.org/broadcast/sha256sums.txt`
- Monthly URL pattern: `https://database.lichess.org/broadcast/lichess_db_broadcast_YYYY-MM.pgn.zst`
- Current example: `https://database.lichess.org/broadcast/lichess_db_broadcast_2026-06.pgn.zst`

The monthly name is stable but not intrinsically content-addressed. Record the publisher SHA-256 and also write the blob to ChessBench R2 under its own SHA-256 key.

Broadcast PGNs include a `GameURL` header for direct provenance. Preserve it. Do not collapse the broadcast license into Lichess's general CC0 database statement; the page explicitly assigns broadcasts CC BY-SA 4.0.

#### 2. Lichess World Championship studies

- Curated index: `https://lichess.org/page/world-championships`
- Example 1886 study: `https://lichess.org/study/beM3pwZa`
- PGN export API pattern: `https://lichess.org/api/study/{studyId}.pgn`
- Example export: `https://lichess.org/api/study/beM3pwZa.pgn`

The index says these studies contain every game from official WCC matches and should be easy to data-mine via the API. Study contents can be edited, so every fetch must be snapshotted and hashed. Keep only the mainline move score and factual headers unless a separate content license is verified.

#### 3. PGN Mentor

- Master download page: `https://www.pgnmentor.com/files.html`
- World Championship example: `https://www.pgnmentor.com/events/WorldChamp2024.pgn`
- Stable viewer landing page for attribution: `https://www.pgnmentor.com/events/WorldChamp2024/`
- Earliest WCC example: `https://www.pgnmentor.com/events/WorldChamp1886.pgn`
- Famous tournament example: `https://www.pgnmentor.com/events/NewYork1857.pgn`
- Kasparov collection: `https://www.pgnmentor.com/players/Kasparov.zip`

The direct event files are plain PGN; player collections are ZIPs. Since files may be corrected in place, record `retrieved_at`, HTTP metadata, byte length, and SHA-256. Link the user to the event viewer where possible; otherwise link the master page and display exact event/round/player/date headers.

#### 4. TWIC

- Archive/terms: `https://theweekinchess.com/twic`
- Issue URL pattern: `https://theweekinchess.com/zips/twic{issue}g.zip`
- Current example: `https://theweekinchess.com/zips/twic1653g.zip`
- Event-level files from the last year: `https://theweekinchess.com/a-year-of-pgn-game-files`

Issue numbers are append-only in practice, but corrected ZIPs are possible; snapshot and hash them. The archive's personal-use-only term makes this private-MVP input, not an automatic public data dependency.

#### 5. ChessPGN (immutable revision)

- Repository: `https://github.com/brianerdelyi/ChessPGN`
- Clone: `https://github.com/brianerdelyi/ChessPGN.git`
- Pinned commit used for this report: `d5931a52bb673bcf2f0bd22f1933f6a1fa773dc9`
- Fischer 60 raw file: `https://raw.githubusercontent.com/brianerdelyi/ChessPGN/d5931a52bb673bcf2f0bd22f1933f6a1fa773dc9/My%20Memorable%2060.pgn`
- Tal 89 raw file: `https://raw.githubusercontent.com/brianerdelyi/ChessPGN/d5931a52bb673bcf2f0bd22f1933f6a1fa773dc9/Life%20and%20Games%20of%20Mikhail%20Tal.pgn`
- License: `https://github.com/brianerdelyi/ChessPGN/blob/d5931a52bb673bcf2f0bd22f1933f6a1fa773dc9/LICENSE`

The repository intentionally contains the scores, not book annotations. Treat the book association as a high-value candidate signal; do not copy prose, diagrams, exercise ordering, or analysis from the books.

#### 6. BritBase

- Archive: `https://www.saund.org.uk/britbase/`
- What's new: `https://britbase.co.uk/britbase/whatsnew.html`
- Example event page: `https://www.saund.org.uk/britbase/pgn/199508bcf-viewer.html`
- Example PGN: `https://www.saund.org.uk/britbase/pgn/199508bcf.pgn`
- Hastings index: `https://saund.org.uk/britbase/hastings.htm`

BritBase explicitly performs corrections and updates old events, so URLs are not immutable. Preserve the event page URL and source hash for every derived position.

#### 7. Pre-analyzed super-tournaments (reference only)

- Git repository: `https://github.com/drmehmetismail/Chess-Tournaments-Stats-Database.git`
- Hugging Face files: `https://huggingface.co/datasets/drmehmetismail/Chess-Super-Tournaments-Analyzed/tree/main`
- Sesse archive directory: `https://huggingface.co/datasets/drmehmetismail/Chess-Super-Tournaments-Analyzed/tree/main/Sesse-as-of-31-Dec-2024`
- PV ZIP: `https://huggingface.co/datasets/drmehmetismail/Chess-Super-Tournaments-Analyzed/resolve/main/Sesse-as-of-31-Dec-2024/Sesse_PV.zip?download=true`
- All-lines archive: `https://huggingface.co/datasets/drmehmetismail/Chess-Super-Tournaments-Analyzed/resolve/main/Sesse-as-of-31-Dec-2024/All_games_all_lines.tar.zst?download=true`

Before production use, replace `main` with the full Hugging Face revision SHA returned by its API. Its existing PVs are leads, never benchmark truth.

## Licensing and provenance risks

1. **Do not equate “downloadable” or “free” with redistributable.** PGN Mentor is freely downloadable but has no explicit data license; TWIC expressly limits use to personal use; BritBase asserts copyright.
2. **Game scores and annotations are different.** The bare sequence of moves is often treated as factual, but copyright/database-right rules vary by jurisdiction. Human annotations, variations, prose, diagrams, and curated book exercise ordering are clearly higher-risk. Strip them at ingest and write original ChessBench explanations.
3. **Database rights can attach to collections even where individual game scores are facts.** A public release assembled substantially from one EU/UK database deserves counsel or source permission. Diversifying sources and publishing only a small, independently analyzed position set reduces but does not eliminate this risk.
4. **CC BY-SA obligations follow derived/public uses.** Preserve Lichess attribution, license URI, and source `GameURL`; review whether the exported benchmark data itself must be shared under compatible terms.
5. **MIT/GPL/CC0 labels on code or a downstream repository do not necessarily relicense every upstream game or annotation inside it.** Keep a field-level provenance ledger.
6. **Corrections happen.** PGN Mentor, TWIC, studies, and BritBase can change in place. No run should depend on an unpinned network response.
7. **Source links may leak private-suite answers.** Store full provenance internally, but reveal private source-game URLs only after an evaluation is finalized or the item is retired.

For the private MVP, this is a reasonable research posture, not legal advice. A public commercial launch should include a focused rights review and, ideally, permission from PGN Mentor/TWIC/BritBase for any meaningful reuse.

## Reproducible curation pipeline

### Stage 0 — Source manifest and immutable acquisition

Create a versioned manifest with one record per remote artifact:

```yaml
source_id: lichess-broadcast-2026-06
landing_url: https://database.lichess.org/
download_url: https://database.lichess.org/broadcast/lichess_db_broadcast_2026-06.pgn.zst
license_spdx: CC-BY-SA-4.0
license_url: https://creativecommons.org/licenses/by-sa/4.0/
retrieved_at: 2026-07-15T00:00:00Z
expected_sha256: <publisher checksum>
```

Fetch once, verify the publisher checksum where available, calculate ChessBench's SHA-256, and store the exact bytes at `r2://source-blobs/sha256/{hash}`. Persist HTTP `ETag`, `Last-Modified`, byte length, decompressor version, and fetch log. Downstream jobs accept a blob hash, never a live URL.

### Stage 1 — Normalize without importing authored analysis

Stream archives through `python-chess`:

- parse only legal standard-chess games;
- preserve factual headers: Event, Site, Date, Round, White, Black, Result, ratings/titles when present;
- retain mainline moves only;
- delete comments, NAGs, clock/eval annotations, authored variations, diagrams, and prose;
- produce canonical UCI mainlines;
- calculate `game_fingerprint = sha256(initial_fen + canonical_uci_mainline)`;
- preserve source blob hash, byte/game offset, landing URL, download URL, and per-game URL (`GameURL` when available).

Quarantine malformed or ambiguous games; never silently repair a move score.

### Stage 2 — Game and position deduplication

Deduplicate in two layers:

1. Exact game fingerprint; then a secondary header/name/date match for duplicated scores with spelling differences.
2. Position fingerprint using the first four FEN fields (piece placement, side, castling, en-passant), plus a short UCI continuation fingerprint.

Split by **source game**, not puzzle. No two positions from the same game may be divided between public and private suites. Prefer at most one benchmark position per game to avoid state/content familiarity.

### Stage 3 — Exclude canonical Lichess overlap before analysis

Build an exclusion set from every public and private canonical Lichess puzzle:

- stored puzzle FEN;
- the actual prompt FEN after applying Lichess's first setup move (Lichess documents that the CSV FEN is before the opponent move and the solution begins at move two);
- normalized first-four-field FEN keys;
- Lichess puzzle IDs and game URLs;
- short solution fingerprints (e.g. first 6–10 UCI plies).

Reject a historical candidate if its prompt position matches either suite, even if it came from another PGN source or has a different name. Run the same check again at release time so an updated canonical suite cannot create overlap.

### Stage 4 — Two-pass Stockfish mining

Pin and record:

- Stockfish exact version/commit and binary SHA-256;
- NNUE file hashes;
- `Threads=1` for determinism;
- Hash size;
- Syzygy table hashes and probe settings;
- node budget (preferred over wall-clock time);
- MultiPV count and contempt/draw settings;
- python-chess and operating-system versions.

Pass A is a relatively cheap scan over plies after the opening (normally ply 20 onward):

- MultiPV 3–5 at ~100k–250k nodes;
- candidate if the best move has a material WDL/evaluation margin over the runner-up;
- candidate if the played move causes a large WDL swing (missed tactic);
- candidate if a unique move preserves a draw/win while alternatives lose it (defensive resource);
- candidate if a forcing best line lasts roughly 3–16 plies and is tactically coherent.

Pass B re-analyzes only finalists:

- MultiPV 5 at at least 3–10 million nodes per critical position (larger for “Hard” and defensive resources);
- extend every opponent branch whose score is within a configured equivalence window;
- use Syzygy truth for eligible endgames;
- repeat on a clean process and require stable first move, WDL class, and accepted branch set;
- optionally cross-check finalists with a second engine family, but Stockfish's pinned result remains the declared adjudicator.

Store centipawn and WDL values, not just SAN text. All model-facing legal moves and expected responses remain UCI to avoid SAN `+/#` leakage.

### Stage 5 — Generate a branch-aware answer key

An exact single PV is too brittle for many real-game positions. Build a small accepted move graph:

- solver move is accepted when it is engine-equivalent under the suite's declared WDL/cp threshold;
- opponent node includes every credible best defense within the response window;
- continue until the tactic is resolved (stable winning material/mate, tablebase result, or secured repetition);
- preserve one display line, but grade against the graph;
- defensive/drawing puzzles require result-preservation, not a misleading `+0.00` string.

The graph and engine metadata are immutable parts of the corpus release hash.

### Stage 6 — Editorial Easy / Medium / Hard bands

Do not invent Lichess-style ratings for historical Woodpecker items. Use editorial bands inspired by the book's progression:

- **Easy:** short, strongly forcing, usually 1–2 solver decisions; check/capture/threat is visible; one clear motif; little branch ambiguity.
- **Medium:** usually 2–4 solver decisions; may require an intermediate/quiet move, calculation through a defensive reply, or a less obvious motif combination.
- **Hard:** usually 4+ solver decisions, quiet or counterintuitive first move, defensive/drawing resource, long sacrifice, or several near-equivalent branches that must be understood.

Engine features can propose a band (line length, move-rank gap, branching factor, quietness, WDL swing), but a human reviewer assigns the final band. Balance each band across eras, events, players, colors, motifs, and objective types (win/draw/save).

### Stage 7 — Mandatory editorial review; no auto-promotion

Every candidate must be reviewed in a purpose-built queue by at least one chess-competent editor; Hard/controversial items should require two approvals. The UI should show:

- interactive position and full source game;
- source landing page and exact source fingerprint;
- played move and engine alternatives;
- accepted answer graph and all branch evaluations;
- stability results from both deep runs;
- overlap-check result;
- proposed motif, objective, and difficulty;
- copyright hygiene status (“comments/variations stripped”);
- public/private split impact.

Promotion is blocked unless all checks are green. Reviewers may edit only ChessBench-authored metadata, not the source score. Rejections retain a reason (`unstable_pv`, `not_tactical`, `ambiguous_goal`, `duplicate_position`, `rights_unclear`, `source_error`, etc.) so repeated runs do not resurrect them.

### Stage 8 — Release and provenance

Recommended item fields:

```json
{
  "id": "historical-deep-blue-1997-g2-45",
  "track": "woodpecker-historical",
  "difficulty": "hard",
  "objective": "best_defense",
  "prompt_fen": "...",
  "answer_graph_uci": {},
  "display_line_uci": [],
  "source_game": {
    "event": "Deep Blue vs Kasparov",
    "date": "1997.05.04",
    "round": "2",
    "white": "Deep Blue",
    "black": "Garry Kasparov",
    "landing_url": "https://www.kasparov.com/timeline-event/deep-blue/",
    "blob_sha256": "...",
    "game_fingerprint": "..."
  },
  "adjudicator": {
    "engine": "Stockfish",
    "version": "...",
    "binary_sha256": "...",
    "nodes": 10000000,
    "multipv": 5
  },
  "review": {
    "status": "approved",
    "reviewer_ids": [],
    "approved_at": "..."
  },
  "license": {
    "source_license": "rights-unclear-private-mvp",
    "attribution": "..."
  }
}
```

Release public and private manifests from the same reviewed pool, grouped by source game. Public exports can include the source link after solving. Private manifests should keep source URLs and answers server-side and expose them only after a lab run is closed. Hash the ordered item IDs, full answer graphs, and adjudicator metadata to create the corpus release ID.

## Practical first curation batch

1. Add the Deep Blue position to the review queue as Hard/controversial, not directly to the scored suite.
2. Mine every official WCC game from 1886–2024 using the Lichess index plus PGN Mentor as a cross-check.
3. Mine the 149 CC0 Fischer/Tal classic games as a high-density famous-game seed.
4. Mine named historical super-tournaments from PGN Mentor (New York 1924, Zurich 1953/Candidates, Hastings, Linares, Wijk aan Zee, Soviet Championships) and modern official broadcasts.
5. Use TWIC/BritBase only as private discovery sources until permissions are clarified.
6. Target an initial reviewed release of 150 items: 50 Easy, 50 Medium, 50 Hard, with 20% held out by source game for the private suite. The exact count is subordinate to answer stability and editorial quality.

This creates a genuinely different Woodpecker track: Lichess-derived items measure calibrated tactical solving, while historical items measure full-line calculation on memorable human positions with strong provenance and curated difficulty rather than borrowed ratings.
