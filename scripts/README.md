# Script inventory

Use the module CLI for normal benchmark execution:

```bash
python3 -m chessbench rate-model --model MODEL_LABEL --reasoning high
```

The command writes full local exports to `runs/exports` and paid checkpoints to `runs/chessbench.db`. Both paths are runtime state and Git ignores them.

## Canonical operations

| Script | Purpose |
| --- | --- |
| `sync_registry.py` | Register frozen public corpora and suites in D1. |
| `sync_rated_pool.py` | Upload and activate the pinned adaptive puzzle pool. |
| `sync_cloudflare.py` | Drain durable local run records to D1. |
| `export_rated_campaign.py` | Create a compact, commit-safe adaptive campaign artifact. |
| `reproduce_rated_selection.py` | Reproduce one deterministic adaptive puzzle selection. |
| `audit_rated_alternate_mates.py` | Verify the accepted alternate-mate report. |

## Corpus and release builders

These scripts create versioned inputs. Review their pinned sources and output paths before use.

- `build_rated_pool.py` creates the 100,000-puzzle adaptive pool.
- `build_standard_suite.py` creates a fixed Standard suite.
- `build_corpora.py` creates public Standard and full-line corpora.
- `build_esoteric_release.py` creates the public esoteric release.
- `build_smoke_suites.py` creates small integration suites.
- `build_public_corpus_bundle.py` creates result-free web fixtures.
- `download_puzzles.py` and `analyze_lichess.py` prepare Lichess source data.
- Historical and esoteric curation scripts support the workflows in `docs/`.

## Archived campaigns and maintenance

The following scripts are not templates for a new headline benchmark:

- `supervise_adaptive_runs.py` resumes only the named July 2026 run IDs.
- `run_public_campaign.py` reproduces the archived Luna and Haiku fixed-suite matrix.
- `run_public_game_campaign.py` reproduces the archived Luna and Haiku game matrix.
- `backfill_puzzle_ratings.py` updates the legacy fixed-suite Puzzle Elo field.
- `reset_local_results.py` permanently deletes local runtime data and offline fixtures.
- `calibrate_suite.py` supports an older engine-ladder experiment.

Git history retains removed one-time utilities. See [the legacy inventory](../docs/LEGACY.md) for the removal policy.
