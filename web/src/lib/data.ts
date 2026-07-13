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

export interface Tournament {
  schema: string
  created: string
  condition: Condition
  max_plies: number
  anchor: Record<string, number> | null
  standings: Standing[]
  games: TournamentGame[]
  crosstable: { a: string; b: string; w: number; d: number; l: number }[]
}

export interface TournamentIndexEntry {
  file: string
  created: string
  n_players: number
  n_games: number
  winner: string | null
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(DATA + path)
  if (!res.ok) throw new Error(`${path}: ${res.status}`)
  return res.json()
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
}

export async function loadDataset(): Promise<Dataset> {
  const index = await getJSON<{ runs: RunIndexEntry[] }>("index.json")
  const runs: Run[] = []
  for (const meta of index.runs) {
    try {
      runs.push(await getJSON<Run>("runs/" + meta.file))
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
    tournaments = (await getJSON<{ tournaments: TournamentIndexEntry[] }>("tournaments/index.json")).tournaments
  } catch {
    tournaments = []
  }
  return { runs, puzzleIndex, tournaments }
}

export function loadTournament(file: string): Promise<Tournament> {
  return getJSON<Tournament>("tournaments/" + file)
}
