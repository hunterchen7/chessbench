export interface Env {
  DB: D1Database
  ASSETS: Fetcher
  /** Bearer token required to POST run/tournament data. Set with `wrangler secret put INGEST_TOKEN`. */
  INGEST_TOKEN?: string
}

export type BenchmarkTrack = "puzzle" | "woodpecker" | "esoteric" | "game"

export interface ModelVariantDoc {
  key: string
  base_key: string
  display_name: string
  label?: string
  provider: string
  model_id: string
  reasoning: { effort?: string | null; max_tokens?: number | null; exclude?: boolean }
  max_output_tokens: number
}

export interface RunStartDoc {
  run_id: string
  track: BenchmarkTrack
  model_variant: ModelVariantDoc
  condition: { slug: string } & Record<string, unknown>
  suite?: {
    name?: string | null
    version?: string | null
    content_hash?: string | null
    visibility?: string | null
  } | null
  total_items: number
  created_at?: string
}

export interface RunItemDoc {
  run_id: string
  item_id: string
  sequence: number
  points: number
  max_points?: number
  solved: boolean
  first_move_legal?: boolean | null
  response_format_valid?: boolean | null
  failure_reason?: string | null
  latency_ms?: number | null
  cost_usd?: number
  prompt_tokens?: number
  completion_tokens?: number
  reasoning_tokens?: number
  payload: Record<string, unknown>
}

export interface RunFinishDoc {
  run_id: string
  status?: "completed" | "partial" | "failed"
  error?: string | null
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
  answer_rationale?: string | null
  answer_explanation: string | null
  answer_raw: string | null
  answer_response_format_valid?: boolean | null
  answer_response_format_error?: string | null
  seq_elo?: number
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
  run_id?: string | null
  model_variant?: ModelVariantDoc | null
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
