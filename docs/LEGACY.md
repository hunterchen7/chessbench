# Legacy and compatibility inventory

This file identifies retained compatibility code and removed one-time utilities. Current benchmark instructions remain in the main README and the rated-session guide.

## Retained compatibility surfaces

| Surface | Status | Reason |
| --- | --- | --- |
| Full-line Mode 4 | Experimental backend support | Old runs and frozen full-line suites remain reproducible. The public UI does not expose this track. |
| Standard Modes 1, 2, 3, and 5 | Active fixed-suite lab | These methods support controlled prompt comparisons. They do not replace the adaptive headline rating. |
| `standard-lichess-v2` and older suites | Reproduction only | Stored runs require their original membership and content hash. |
| `tactical-public-v1` and `tactical-lichess-v1` | Legacy | They preserve early dashboard baselines. Do not add new headline runs. |
| Luna and Haiku campaign launchers | Archived campaign | They reproduce the first public fixed-suite matrix. |
| `supervise_adaptive_runs.py` | Frozen campaign receipt | Its commands and run IDs resume only the July 2026 campaign. |
| `backfill_puzzle_ratings.py` | One-time maintenance | It updates the legacy fixed-suite Puzzle Elo field. |
| `calibrate_suite.py` | Legacy experiment | It supports an older engine-ladder calibration workflow. |

The [suite catalog](SUITES.md) gives the authoritative status for every frozen suite.

## Static result exports

D1 is the production source for run details. Full static run snapshots are local offline artifacts.

Git does not track new files under `web/public/data/runs`. Normal benchmark commands write exports to `runs/exports`.

The deploy build removes local run snapshots before Wrangler uploads site assets. Small result-free corpora remain available for offline puzzle browsing.

Use `artifacts/` for compact published results. Use `campaigns/` for ordered run manifests.

## Removed files

The July 2026 cleanup removed these unused files:

- The unrouted Woodpecker and historical-candidate React pages.
- An unused shadcn separator component.
- The unfrozen `reasoning-mini-v1` suite.
- A superseded composed-fixture builder that could overwrite the current corpus.
- A subagent-grading utility that did not match the provider benchmark protocol.

Git history retains these files when an old experiment requires inspection.
