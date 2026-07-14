// Types + loaders for the chessbench JSON data contract (produced by
// `python -m chessbench ... --save-run` + `chessbench export`).

const DATA = import.meta.env.BASE_URL + "data/"

export interface Condition {
  legality: string
  representation: string
  notation: string
  prompt_style: string
  context_mode?: string
  explain?: boolean
  reasoning_effort?: string | null
  slug: string
}

export interface Categories {
  tier?: string[]
  phase?: string[]
  motif?: string[]
  mate_pattern?: string[]
  goal?: string[]
  length?: string[]
}

export interface PuzzleItem {
  puzzle_id: string
  rating: number
  themes: string[]
  categories: Categories
  solved: boolean
  score: number
  first_move_legal: boolean
  failure_reason: string | null
  answer_move: string | null
  answer_explanation: string | null
  answer_raw: string | null
  seq_elo: number
  fen: string
  setup_san?: string
  solver_is_white: boolean
  solution: string[]
  solution_first: string | null
  game_url?: string
}

export interface RunSummary {
  n: number
  solved: number
  solve_rate: number
  mean_score: number
  first_move_legal_rate: number
  puzzle_elo: number
  puzzle_elo_ci: [number | null, number | null]
  puzzle_elo_bounded: boolean
  cost_usd: number | null
}

export interface Run {
  schema: string
  kind: string
  created: string
  model: string
  provider: string
  suite: { name: string; version: string; visibility: string; content_hash: string } | null
  condition: Condition
  summary: RunSummary
  themes: { theme: string; n: number; accuracy: number }[]
  items: PuzzleItem[]
}

export interface RunIndexEntry {
  file: string
  model: string
  created: string
  condition: string
  suite: string | null
  summary: RunSummary
}

export interface Standing {
  label: string
  wins: number
  draws: number
  losses: number
  games: number
  score: number
  illegal_forfeits: number
  rating: number | null
  rating_ci: [number | null, number | null]
  bounded: boolean
  accuracy?: number | null
}

export interface GameMove {
  ply: number
  color: "white" | "black"
  san: string | null
  uci: string | null
  first_attempt_legal: boolean
  illegal_attempts: number
  eval_cp: number | null
  forfeited: boolean
}

export interface TournamentGame {
  white: string
  black: string
  result: string
  termination: string
  plies: number
  pgn: string
  start_fen: string | null
  moves: GameMove[]
}

export interface LiveGame {
  white: string
  black: string
  idx: number
  start_fen: string | null
  fen: string
  plies: number
  moves: GameMove[]
}

export interface Tournament {
  schema: string
  status?: "live" | "final"
  created: string
  condition: Condition
  max_plies: number
  anchor: Record<string, number> | null
  standings: Standing[]
  games: TournamentGame[]
  crosstable: { a: string; b: string; w: number; d: number; l: number }[]
  live_game?: LiveGame | null
}

export interface TournamentIndexEntry {
  file: string
  created: string
  status?: "live" | "final"
  n_players: number
  n_games: number
  winner: string | null
}

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  return res.json()
}

// The app prefers the Cloudflare backend API and falls back to the static JSON
// bundled in public/data. VITE_API_BASE overrides the probe (e.g. a dev worker);
// otherwise it probes the same-origin /api. Probed once and cached.
let cachedBase: string | null | undefined
export async function resolveApiBase(): Promise<string | null> {
  if (cachedBase !== undefined) return cachedBase
  const configured = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "")
  const candidates = configured ? [configured] : ["/api"]
  for (const base of candidates) {
    try {
      const res = await fetch(`${base}/health`)
      if (res.ok) return (cachedBase = base)
    } catch {
      /* unreachable — fall through to static */
    }
  }
  return (cachedBase = null)
}

// --- aggregated app state ---

export interface PuzzleAnswer {
  model: string
  condition: string
  item: PuzzleItem
}

export interface PuzzleEntry {
  position: PuzzleItem
  answers: PuzzleAnswer[]
}

export interface Dataset {
  runs: Run[]
  puzzleIndex: Map<string, PuzzleEntry>
  tournaments: TournamentIndexEntry[]
  apiBase: string | null
}

async function loadFrom(base: string | null): Promise<Dataset> {
  const indexUrl = base ? `${base}/index` : `${DATA}index.json`
  const index = await fetchJSON<{ runs: RunIndexEntry[] }>(indexUrl)
  const runs: Run[] = []
  for (const meta of index.runs) {
    const url = base ? `${base}/runs/${encodeURIComponent(meta.file)}` : `${DATA}runs/${meta.file}`
    try {
      runs.push(await fetchJSON<Run>(url))
    } catch (e) {
      console.warn("failed to load run", meta.file, e)
    }
  }
  const puzzleIndex = new Map<string, PuzzleEntry>()
  for (const run of runs) {
    for (const item of run.items) {
      let entry = puzzleIndex.get(item.puzzle_id)
      if (!entry) {
        entry = { position: item, answers: [] }
        puzzleIndex.set(item.puzzle_id, entry)
      }
      entry.answers.push({ model: run.model, condition: run.condition.slug, item })
    }
  }
  let tournaments: TournamentIndexEntry[] = []
  try {
    const turl = base ? `${base}/tournaments` : `${DATA}tournaments/index.json`
    tournaments = (await fetchJSON<{ tournaments: TournamentIndexEntry[] }>(turl)).tournaments
  } catch {
    tournaments = []
  }
  return { runs, puzzleIndex, tournaments, apiBase: base }
}

export async function loadDataset(): Promise<Dataset> {
  const base = await resolveApiBase()
  try {
    return await loadFrom(base)
  } catch (e) {
    // Backend reachable at /health but its data failed (e.g. un-migrated D1): fall
    // back to the bundled static JSON instead of bricking the whole app.
    if (base) {
      console.warn("API data load failed; falling back to static data", e)
      cachedBase = null
      return loadFrom(null)
    }
    throw e
  }
}

export async function loadTournament(file: string): Promise<Tournament> {
  const base = await resolveApiBase()
  return fetchJSON<Tournament>(base ? `${base}/tournaments/${encodeURIComponent(file)}` : `${DATA}tournaments/${file}`)
}
