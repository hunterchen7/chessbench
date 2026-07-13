# chessbench web

A Vite + React + TypeScript + Tailwind v4 + shadcn/ui front-end for the chessbench
benchmark. It reads the JSON the Python CLI produces and renders it as an interactive site.

## Pages

- **Leaderboard** — models ranked by puzzle Elo (MLE fit to Lichess-rated puzzles), with a
  filter for the best run per model or a specific ablation condition. A second tab lists
  tournaments ranked by Bradley–Terry game Elo. If you solve puzzles in the browser, your own
  Elo appears as a row.
- **Model detail** — headline stats, the sequential puzzle-Elo trajectory (recharts), and
  accuracy broken down by tier and by theme, per condition.
- **Puzzles** — browse the tactical suite from beginner to master; sort by rating or by how
  hard each puzzle was for the models.
- **Puzzle detail** — solve the position yourself on a drag-and-drop board (react-chessboard +
  chess.js validate the line), then expand how every model answered, including its written
  explanation and failure reason.
- **Games / tournament detail** — standings, and a move-by-move replay of every game with a
  board, jump-to-move list, illegal-attempt / forfeit highlighting, and evals.

## Data

The app fetches from `public/data/`:

- `index.json` — run index; each entry points to a file in `runs/`.
- `runs/*.json` — one puzzle run (model × condition) with per-puzzle items.
- `tournaments/index.json` + `tournaments/*.json` — game tournaments.

Regenerate and refresh it from the repo root:

```bash
python -m chessbench export                 # rebuilds webapp/data/index.json
cp -R ../webapp/data/* public/data/         # sync into the Vite app
```

## Develop

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm build      # type-check + production build to dist/
pnpm preview    # serve the production build
```

`vite.config.ts` sets `base: "./"` so `dist/` can be hosted from any subpath. Routing is
hash-based, so it also works from `file://` and static hosts without SPA rewrites.
