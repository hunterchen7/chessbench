export interface Env {
  DB: D1Database
  ASSETS: Fetcher
  /** Bearer token required to POST run/tournament data. Set with `wrangler secret put INGEST_TOKEN`. */
  INGEST_TOKEN?: string
}

/** The per-puzzle item shape emitted by chessbench/store.py (RunRecord.to_dict). */
export interface RunItem {
  puzzle_id: string
  rating: number
  themes: string[]
  categories: Record<string, string[]>
  solved: boolean
  score: number
  first_move_legal: boolean
  failure_reason: string | null
  answer_move: string | null
  answer_explanation: string | null
  answer_raw: string | null
  seq_elo: number
  fen?: string
  setup_san?: string
  solver_is_white?: boolean
  solution?: string[]
  solution_first?: string | null
  game_url?: string
}

export interface RunDoc {
  schema: string
  kind: string
  created: string
  model: string
  provider: string
  suite: { name: string } | null
  condition: { slug: string; temperature?: number } & Record<string, unknown>
  summary: Record<string, unknown>
  themes: unknown[]
  items: RunItem[]
}

export interface TournamentDoc {
  schema: string
  created: string
  condition: { slug: string } & Record<string, unknown>
  standings: { label: string }[]
  games: unknown[]
  crosstable: unknown[]
}
