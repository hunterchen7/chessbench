# chessbench web

A Vite, React, TypeScript, Tailwind v4, and shadcn/ui front-end for ChessBench.
Production pages read normalized benchmark data from the Cloudflare Worker and D1.

## Pages

- **Overview** — points-first summary across all four tracks.
- **Puzzle leaderboard** — models ranked by points with a secondary Elo-scale performance
  estimate, confidence interval, solve rate, legality, exact model budget, and cost.
- **Puzzle trainer** — randomized Worker-selected matches near a locally persisted 1,500/RD 500 Glicko-2 state; full solves and first misses update the rating, while solution reveals are unrated skips.
  Answers remain hidden until review; click-to-move and drag-to-move are both supported.
- **Puzzle browser** — the separate canonical task catalog, sortable by source rating,
  deviation, tier, Lichess plays, and popularity.
- **Model detail** — per-condition points, rating, usage, cost, and item-level audit.
- **Games / tournament detail** — standings, and a move-by-move replay of every game with a
  board, jump-to-move list, illegal-attempt / forfeit highlighting, and evals.

## Data

The app fetches from the Worker API in production. It uses `public/data/` only when the API is unavailable.

- `corpora/*.json` contains immutable, result-free public banks.
- `suites.json` describes fixed public suite releases.
- `prompts.json` exposes frozen public prompt text.
- `index.json`, `runs/`, `composed/`, and `tournaments/` are optional local fixtures.

Full run snapshots are not tracked. They can contain prompts, responses, and reasoning records. D1 is the production source for this data.

Regenerate the result-free corpus bundle from the canonical releases:

```bash
python3 scripts/build_public_corpus_bundle.py
```

## Develop

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm build      # type-check + production build to dist/
pnpm build:deploy # production build without local full-run snapshots
pnpm preview    # serve the production build
```

`vite.config.ts` sets `base: "./"` so `dist/` can be hosted from any subpath. Routing is
hash-based, so it also works from `file://` and static hosts without SPA rewrites.
