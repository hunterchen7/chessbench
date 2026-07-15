# Private corpus MVP

Private source records, suite memberships, raw transcripts, and the private selection seed never enter Git. The
repository contains only import/generation code and membership-free manifests.

## Complete Lichess snapshot

The local snapshot is `data/lichess_db_puzzle_2026-07-05.csv.zst` (SHA-256
`5503bfaf5534518ffe3c4c3bb0ac1ae82350d117ad1a52947796096b75e6247e`). Analyze and rebuild with:

```sh
python3 scripts/analyze_lichess.py data/lichess_db_puzzle_2026-07-05.csv.zst \
  --snapshot 2026-07-05 --out corpora/sources/lichess-analysis-2026-07-05.json
python3 scripts/curate_lichess.py --source data/lichess_db_puzzle_2026-07-05.csv.zst
```

The curator creates public Standard/Woodpecker releases plus disjoint ignored held-out releases. The latter are
semi-private: their membership is secret, but the Lichess source pool is public.

## YACPDB private research import

```sh
python3 scripts/import_yacpdb.py --per-kind 250 --max-pages 100
python3 scripts/build_private_esoteric.py --popeye /path/to/popeye --per-kind 50
```

The current private build retains exactly 50 independently checked records in each of eight categories: directmate,
selfmate, reflexmate, helpmate, series helpmate, series directmate, proof game, and study. Key/line categories are
replayed by the native verifier; six Popeye-supported genres additionally carry a Popeye 4.101 output certificate.
Study outcomes remain source-claimed until the interactive/tablebase adjudicator is frozen.

## ChessBench-generated originals

```sh
python3 scripts/generate_private_originals.py --popeye /path/to/popeye \
  --per-kind 10 --max-candidates 80000
```

ChessBench proposes deterministic sparse positions; Popeye acts as the independent solver and cook detector. The
current run freezes 10 directmates, 10 selfmates, 10 reflexmates, 10 helpmates, and 10 exhaustively unique three-ply
proof games. These positions have never been fetched from an online problem database.

## Arthurit

Arthurit distributes approximately 4,990 problems in ChessBase's proprietary CBH container. Convert the archive once
with ChessBase Reader/ChessBase by copying its records into a PGN database, then run:

```sh
python3 scripts/import_arthurit.py data/arthurit/problems.pgn --popeye /path/to/popeye
```

The importer reads FEN and stipulation tags, preserves every PGN header as provenance, asks Popeye to solve the
position from scratch, and admits only records the native verifier also accepts. The source site was intermittently
resetting connections during this build, so the archive itself is not part of the current local MVP yet.

## Exposure rules

- Private corpus and suite files must be written directly beneath directories named `private`; serializers reject
  paths elsewhere.
- Public dashboard reads and JSON exports expose aggregate points, progress, usage, and content hashes for private
  suites, but never membership, positions, item outcomes, prompts, or transcripts.
- Owner audits are explicit and authenticated:

  ```sh
  curl -H "Authorization: Bearer $CHESSBENCH_INGEST_TOKEN" \
    "$CHESSBENCH_API/export?run=RUN_ID&include_private=1" -o private-run.json
  ```

- A model provider necessarily receives one task at inference time. Operational secrecy therefore comes from a
  benchmark-operated runner, access controls, audit logs, and contracts—not from pretending prompts can be hidden
  from the infrastructure performing inference.
- A private source can later be removed by its retained upstream ID without changing unrelated records.
