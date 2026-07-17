export interface Env {
  DB: D1Database
  ASSETS: Fetcher
  /** Bearer token required to POST run/tournament data. Set with `wrangler secret put INGEST_TOKEN`. */
  INGEST_TOKEN?: string
  /** Optional migration-safe second credential; both tokens remain valid. */
  INGEST_TOKEN_V2?: string
}

export type BenchmarkTrack = "puzzle" | "woodpecker" | "esoteric" | "game"
export type CorpusTrack = "standard" | "woodpecker" | "esoteric"

export interface CorpusDoc {
  schema: "chessbench.public_corpus.v1"
  name: string
  title: string
  version: string
  track: CorpusTrack
  visibility: "public" | "private"
  description?: string
  content_hash: string
  sources?: unknown[]
  validation?: Record<string, unknown>
  items: Array<Record<string, unknown>>
}

export interface SuiteDoc {
  name: string
  version: string
  visibility: "public" | "private"
  kind: "puzzle" | "composed"
  track?: "puzzle" | "woodpecker" | "esoteric"
  source?: string
  description?: string
  content_hash: string
  items: Array<Record<string, unknown>>
}

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
  protocol?: Record<string, unknown> | null
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
  cache_read_tokens?: number
  cache_write_tokens?: number
  uncached_prompt_tokens?: number
  cache_discount_usd?: number
  payload: Record<string, unknown>
}

export interface RunFinishDoc {
  run_id: string
  status?: "completed" | "partial" | "failed"
  error?: string | null
  summary?: Record<string, unknown> | null
}

export interface TournamentDoc {
  schema: string
  created: string
  condition: { slug: string } & Record<string, unknown>
  standings: { label: string; score?: number }[]
  games: unknown[]
  crosstable: unknown[]
}
