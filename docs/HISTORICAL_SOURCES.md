# Historical source catalog

Research date: 2026-07-15

ChessBench's historical mining pool is defined by the machine-readable manifest at
[`data/curated/historical-source-catalog.json`](../data/curated/historical-source-catalog.json). It contains **54 direct source packs** spanning 1851–2024. The 47 packs with a known expected count represent at least **22,113 game scores** before cross-source deduplication; seven additional packs are intentionally left with a null count until acquisition and legal parsing.

This is ample source material for the current target of **500 reviewed historical positions: 400 public and 100 held out by source game**. Source volume is not the quality gate. A game entering the mining pool does not make any derived position eligible for scoring until deterministic deep-engine analysis, branch review, overlap checks, and editorial approval are complete.

## Coverage

| Category | Packs | Why it is included |
|---|---:|---|
| Open World Championships | 15 | Canonical title matches and the 1948 title tournament, sampled across every major era |
| Candidates | 8 | Exceptionally strong, calculation-heavy play from Zurich 1953 through Toronto 2024 |
| Famous tournaments | 10 | London 1851, Hastings, San Sebastián, New York, Moscow, Nottingham, AVRO, Linares, and Wijk aan Zee |
| Olympiads and team events | 9 | Large open and women's team archives from 1972, 1986, 1992, 2004, and 2014 |
| Women's World Championships | 6 | Title events from 1956 through 2020, sourced from the maintained Lichess championship index |
| Curated famous-game references | 3 | Two CC0 book-companion score sets and one immutable historical selection |
| Official broadcasts | 2 | The licensed Lichess broadcast months covering the 2024 Ding–Gukesh match |
| Human–computer matches | 1 | Both six-game Kasparov–Deep Blue matches |

The catalog is deliberately diverse. It avoids constructing a supposedly historical benchmark solely from modern super-GM play, and it gives the editorial queue enough material to balance era, player, color, tactical motif, objective, and Easy/Medium/Hard band.

## Downloader contract

Every entry has the same machine-facing fields:

- `source_id`: stable ChessBench identifier;
- `enabled`: whether automated acquisition may currently fetch the pack;
- `landing_url`: human-readable event or collection context;
- `direct_pgn_url`: direct HTTPS URL for PGN bytes or an archive containing PGN;
- `archive_format`: `pgn`, `zip`, or `pgn.zst`;
- `category`, `event`, `era`, `year_start`, and `year_end`;
- `expected_game_count` and its basis, with `null` meaning “measure after parsing”;
- `url_stability`, `rights_status`, and source-specific provenance notes.

A downloader should read only enabled entries, stream the artifact, and never overwrite a previous acquisition:

```text
for each packs[] where enabled == true:
  fetch direct_pgn_url
  store retrieved_at, final URL, ETag, Last-Modified, byte length, and SHA-256
  decompress according to archive_format
  parse legal standard-chess mainlines
  compare legal count with expected_game_count when non-null
  retain source_id + blob SHA-256 on every normalized game
```

After parsing, strip comments, NAGs, variations, clocks, embedded evaluations, and authored prose. Normalize the mainline to UCI and deduplicate by initial FEN plus canonical UCI score. Never silently repair a malformed game.

## Source families

### PGN Mentor event packs

[PGN Mentor's event index](https://www.pgnmentor.com/files.html) explicitly lists the direct `.pgn` files used by 33 catalog entries. It is the broadest historical discovery source here: individual World Championships, Candidates cycles, and named tournaments reach back to London 1851.

The site calls its downloads free, but provides no broad reusable-data license. Its artifacts are also mutable at stable paths. ChessBench therefore treats these as private-MVP discovery inputs: snapshot exact bytes, hash them, retain only legal mainline scores and factual headers, and independently create every position, answer graph, and explanation.

### OlimpBase team archives

[OlimpBase](https://www.olimpbase.org/2014/2014in.html) provides event pages with explicit downloadable ZIPs, participation data, game totals, and valuable completeness warnings. Nine packs cover open and women's Olympiads. These archives are particularly useful because the event files contribute thousands of games outside the familiar individual super-tournament canon.

OlimpBase is a legacy site and its ZIPs are not content-addressed. Preserve both the event landing page and archive hash. Respect explicit warnings such as the 1972 women's archive being roughly 30% incomplete, and distinguish played scores from forfeited pairings when validating counts.

### Lichess championship studies and broadcasts

The maintained [Lichess World Championships index](https://lichess.org/page/world-championships) says its championship studies are intended to be easy to mine through the API. Six women's-title entries use direct study-export endpoints. The studies can be edited, so their PGN exports must be snapshotted and stripped to mainlines; their authored annotations are not imported.

The two monthly official-broadcast artifacts come from the [Lichess open database](https://database.lichess.org/). Broadcast data is published under CC BY-SA 4.0. Verify each monthly file against the publisher's `broadcast/sha256sums.txt`, preserve `GameURL` attribution, and retain the license URI with every derived source record.

### Immutable Git sources

Three entries use commit-pinned raw GitHub URLs. The two [ChessPGN](https://github.com/brianerdelyi/ChessPGN) files are CC0 and contain 149 selected Fischer and Tal game scores. The pinned `tonymorris/immortalgames` file is a useful famous-game index, but has no broad rights conclusion recorded in this catalog and remains private-MVP material. Pinning makes bytes reproducible; it does not substitute for rights review or independent adjudication.

### Kasparov–Deep Blue

The human–computer pack is a direct legacy ZIP from Inertia Software's CompuChess page and is the catalog's only disabled source. Its path still resolves, but the page dates to 2003, asserts site copyright, and supplies no checksum or preservation guarantee. Treat it as a locator only until its 12 scores are cross-checked against primary IBM/Kasparov records or an independent archive and the bytes are internally snapshotted.

## URL stability audit

| Stability class | Packs | Handling |
|---|---:|---|
| `immutable_commit` | 3 | Reproducible commit-pinned GitHub raw URLs |
| `stable_path_mutable_content` | 35 | Snapshot immediately; 33 PGN Mentor files can be corrected in place, and two Lichess monthly files should be verified with publisher checksums |
| `legacy_stable_path` | 9 | OlimpBase paths are long-lived but unversioned; snapshot landing page and ZIP together |
| `mutable_api_resource` | 6 | Lichess studies can change while retaining the same ID; snapshot every export |
| `legacy_unstable` | 1 | Inertia Deep Blue pack; disabled pending mirrored verification |

The unstable and mutable classifications are intentional. A successful HTTP response does not make a source immutable. Downstream mining jobs must accept a stored blob SHA-256, never a live URL.

## Rights posture for the private MVP

- 2 packs are CC0-1.0.
- 2 broadcast packs are CC BY-SA 4.0.
- 43 event/team/reference packs have no sufficiently clear redistribution license recorded and are private-MVP discovery sources.
- 6 Lichess study exports have unclear annotation rights; only factual mainline scores are retained.
- 1 legacy pack asserts site copyright and remains disabled.

This classification is informational, not legal advice. It does not block private research, but raw archives, annotations, and source ordering should not be copied into a public benchmark release without a separate rights decision. Public exports should contain independently selected positions, original ChessBench metadata, required attribution, and no upstream authored analysis.

## Promotion target

Mine considerably more than 500 candidates, because stability and editorial review should reject most engine-generated leads. A reasonable funnel is:

1. scan all enabled packs and deduplicate games;
2. retain roughly 3,000–5,000 positions after inexpensive tactical and defensive-resource filters;
3. deep-analyze roughly 1,000–1,500 candidates with pinned engine settings and MultiPV;
4. editorially approve 500 positions, balanced across Easy/Medium/Hard and source categories;
5. split **100 held-out items by source game**, then publish the remaining 400.

No game may contribute positions to both public and held-out sets. Prefer at most one scored position per source game, and keep the complete provenance and answer graph server-side for held-out items.
