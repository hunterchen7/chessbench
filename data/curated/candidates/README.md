# Historical Woodpecker candidate bank

These files are an editorial staging area, not a scored benchmark release. They collect famous positions from
historical games with exact source links, pre-setup FENs, legal UCI continuations, Easy/Medium/Hard placement, and
an explicit statement of how each line was obtained.

A candidate may preserve a famous played or annotated continuation without claiming that it is the unique best
line. Promotion into a future explicitly versioned historical suite requires a separate review of the first move, the
opponent's strongest defenses, acceptable alternate lines, provenance, and any disputed historical claim. The
reviewer must never infer "forced" merely because the moves were played in the game.

Validate every staged bank with:

```bash
python3 scripts/validate_historical_candidates.py
```

When a Stockfish-compatible binary is available, create a fixed-node review receipt with:

```bash
python3 scripts/review_historical_candidates.py \
  --engine /path/to/stockfish --nodes 100000 --multipv 5 \
  --out data/curated/reviews/historical-stockfish.json
```

That engine is a curation tool only. Agreement at a fixed node budget is not a uniqueness proof, and no engine is
ever made available to the language model under evaluation.

SAN appears only in fields ending in `_audit_only`. Benchmark prompts and accepted model answers remain UCI-only.
