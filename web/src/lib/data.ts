import { isModelVariant } from "@/lib/participants"

const DATA = import.meta.env.BASE_URL + "data/"

export interface Condition {
  legality: string
  representation: string
  notation: string
  prompt_style: string
  context_mode?: string
  puzzle_protocol?: "move_by_move" | "full_line"
  explain?: boolean
  response_protocol?: "plain_text_v1" | "prompt_json_v1" | "json_schema_v1" | string
  reasoning_effort?: string | null
  reasoning_max_tokens?: number | null
  max_output_tokens?: number
  prompt_version?: string
  slug: string
}

export interface ModelVariant {
  key: string
  base_key: string
  display_name: string
  label?: string
  provider: string
  model_id: string
  reasoning: { effort?: string | null; max_tokens?: number | null; exclude?: boolean }
  max_output_tokens: number
}

export interface Categories {
  tier?: string[]
  phase?: string[]
  motif?: string[]
  mate_pattern?: string[]
  goal?: string[]
  length?: string[]
}

export interface PuzzlePosition {
  puzzle_id: string
  rating: number
  rating_deviation?: number
  popularity?: number
  plays?: number
  themes: string[]
  categories: Categories
  fen: string
  setup_san?: string
  solver_is_white: boolean
  solution: string[]
  solution_first: string | null
  game_url?: string
  source?: string
  difficulty_band?: "easy" | "medium" | "hard" | ""
}

export interface PuzzleItem extends PuzzlePosition {
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
  moves_played?: string[]
  solver_plies?: number
  plies_correct?: number
  turns?: Array<{
    solver_ply: number
    system_prompt?: string | null
    prompt?: string | null
    raw_response?: string | null
    parsed_move?: string | null
    rationale?: string | null
    explanation?: string | null
    response_format_valid?: boolean | null
    response_format_error?: string | null
    prompt_tokens: number
    completion_tokens: number
    reasoning_tokens: number
    cost_usd: number
  }>
}

export interface RunSummary {
  n: number
  solved: number
  solve_rate: number
  mean_score: number
  first_move_legal_rate: number
  response_format_valid_rate?: number | null
  points: number
  max_points: number
  cost_usd: number | null
  puzzle_performance_rating?: {
    rating: number
    stderr: number | null
    ci95: [number, number] | null
    n: number
    bounded: boolean
  } | null
}

export interface SuiteRef {
  name: string
  version?: string | null
  visibility?: string | null
  content_hash?: string | null
}

export type RunStatus = "queued" | "running" | "partial" | "completed" | "failed"
export type Track = "puzzle" | "woodpecker" | "esoteric" | "game"

export interface RunIndexEntry {
  run_id: string
  file: string
  track: Track
  kind: string
  status: RunStatus
  model: string
  model_variant: ModelVariant
  provider: string
  created: string
  updated_at?: string
  completed_at?: string | null
  condition: Condition
  condition_slug: string
  suite: SuiteRef | null
  progress: { completed: number; total: number }
  summary: RunSummary
  usage?: { prompt_tokens: number; completion_tokens: number; reasoning_tokens: number; cost_usd: number }
  error?: string | null
}

export interface Run extends RunIndexEntry {
  schema: string
  themes: { theme: string; n: number; accuracy: number }[]
  items: PuzzleItem[]
}

export interface PuzzleAnswer {
  model: string
  condition: string
  item: PuzzleItem
}

export interface PuzzleEntry {
  position: PuzzlePosition
  answers: PuzzleAnswer[]
  aggregate?: { solved: number; total: number }
}

export interface PublicCorpus<T> {
  schema: "chessbench.public_corpus.v1"
  name: string
  title: string
  version: string
  track: "standard" | "woodpecker" | "esoteric"
  visibility: "public"
  description: string
  content_hash: string
  sources: Array<Record<string, unknown>>
  validation: Record<string, unknown>
  items: T[]
}

export async function loadPublicCorpus<T>(track: "standard" | "woodpecker" | "esoteric"): Promise<PublicCorpus<T>> {
  return fetchJSON<PublicCorpus<T>>(`${DATA}corpora/${track}.json`)
}

export interface HistoricalCandidate {
  id: string
  event: string
  date: string
  white: string
  black: string
  difficulty_band: "easy" | "medium" | "hard"
  themes: string[]
  source_url: string
  historical_context_url?: string
  why_famous: string
  provenance_confidence: "high" | "medium" | "contested"
  line_provenance: string
}

export interface HistoricalCandidateBank {
  schema: "chessbench.public_historical_candidates.v1"
  status: "candidate_only_not_scored"
  candidate_count: number
  difficulty: Record<"easy" | "medium" | "hard", number>
  items: HistoricalCandidate[]
}

export async function loadHistoricalCandidates(): Promise<HistoricalCandidateBank> {
  return fetchJSON<HistoricalCandidateBank>(`${DATA}corpora/historical.json`)
}

export interface Standing {
  label: string
  wins: number
  draws: number
  losses: number
  games: number
  score: number
  illegal_forfeits: number
  rating?: number | null
  rating_ci?: [number | null, number | null]
  bounded?: boolean
  accuracy?: number | null
}

export interface GameMove {
  ply: number
  color: "white" | "black"
  san: string | null
  uci: string | null
  /** Optional on legacy exports; the dashboard derives it from attempts when absent. */
  first_attempt_legal?: boolean
  /** Optional on legacy exports; the dashboard derives it from attempts when absent. */
  illegal_attempts?: number
  eval_cp: number | null
  forfeited: boolean
  attempts?: GameMoveAttempt[]
  prompt_tokens?: number
  completion_tokens?: number
  reasoning_tokens?: number
  cost_usd?: number
}

export interface GameMoveAttempt {
  system_prompt?: string | null
  prompt: string | null
  raw_response: string
  parsed_move: string | null
  legal: boolean
  rationale?: string | null
  explanation?: string | null
  response_format_valid?: boolean | null
  response_format_error?: string | null
  prompt_tokens: number
  completion_tokens: number
  reasoning_tokens: number
  cost_usd: number
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
  /** Newer exports can preserve the complete participant identity directly. */
  model_variants?: ModelVariant[] | Record<string, ModelVariant>
}

export interface TournamentIndexEntry {
  file: string
  created: string
  status?: "live" | "final"
  condition_slug?: string | null
  n_players: number
  n_games: number
  winner: string | null
}

export interface Dataset {
  runs: RunIndexEntry[]
  tournaments: TournamentIndexEntry[]
  apiBase: string | null
}

async function fetchJSON<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: ${response.status}`)
  return response.json() as Promise<T>
}

let cachedBase: string | null | undefined
let cachedBaseCheckedAt = 0
const API_RETRY_MS = 30_000
export async function resolveApiBase(): Promise<string | null> {
  const now = Date.now()
  if (cachedBase !== undefined && (cachedBase !== null || now - cachedBaseCheckedAt < API_RETRY_MS)) return cachedBase
  const configured = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "")
  for (const base of configured ? [configured] : ["/api"]) {
    try {
      const response = await fetch(`${base}/health`)
      if (response.ok) {
        cachedBaseCheckedAt = now
        return (cachedBase = base)
      }
    } catch {
      // Fall through to the committed static fixture bundle.
    }
  }
  cachedBaseCheckedAt = now
  return (cachedBase = null)
}

function conditionFromSlug(slug: string): Condition {
  const parts = slug.split("__")
  const jsonRationale = parts.includes("json-rationale")
  const moveOnly = parts.includes("plain-text-v1") || !jsonRationale
  const responseProtocol = moveOnly
    ? "plain_text_v1"
    : parts.includes("prompt-json-v1")
      ? "prompt_json_v1"
      : "json_schema_v1"
  const effort = parts.find((part) => part.startsWith("reason-"))?.slice(7) ?? null
  const puzzleContext = parts.find((part) => part.startsWith("pctx-"))?.slice(5)
  const gameContext = parts.find((part) => ["fresh", "growing", "hybrid"].includes(part))
  return {
    legality: parts[0] ?? "free_form",
    representation: parts[1] ?? "fen_pieces",
    notation: parts[2] ?? "uci",
    prompt_style: parts[3] ?? "minimal",
    explain: jsonRationale,
    response_protocol: responseProtocol,
    puzzle_protocol: parts.includes("full-line") ? "full_line" : "move_by_move",
    context_mode: puzzleContext ?? gameContext,
    reasoning_effort: effort?.endsWith("t") ? null : effort,
    reasoning_max_tokens: effort?.endsWith("t") ? Number(effort.slice(0, -1)) : null,
    slug,
  }
}

function fallbackVariant(model: string, condition: Condition, provider = "unknown"): ModelVariant {
  const display = model.includes("/") ? model.split("/").at(-1)! : model
  const reasoning = { effort: condition.reasoning_effort, max_tokens: condition.reasoning_max_tokens, exclude: true }
  return {
    key: `${model}--${condition.reasoning_max_tokens ? `r${condition.reasoning_max_tokens}t` : `r-${condition.reasoning_effort ?? "default"}`}`,
    base_key: model,
    display_name: display,
    provider,
    model_id: model,
    reasoning,
    max_output_tokens: condition.max_output_tokens ?? 2048,
  }
}

function normalizeSummary(value: Partial<RunSummary> & Record<string, unknown>): RunSummary {
  const n = Number(value.n ?? 0)
  const mean = Number(value.mean_score ?? value.solve_rate ?? 0)
  return {
    n,
    solved: Number(value.solved ?? 0),
    solve_rate: Number(value.solve_rate ?? 0),
    mean_score: mean,
    first_move_legal_rate: Number(value.first_move_legal_rate ?? 0),
    response_format_valid_rate: value.response_format_valid_rate == null ? null : Number(value.response_format_valid_rate),
    points: Number(value.points ?? mean * n),
    max_points: Number(value.max_points ?? n),
    cost_usd: value.cost_usd == null ? null : Number(value.cost_usd),
    puzzle_performance_rating: value.puzzle_performance_rating as RunSummary["puzzle_performance_rating"],
  }
}

function normalizeIndex(raw: Record<string, unknown>): RunIndexEntry {
  const conditionValue = raw.condition
  const condition = typeof conditionValue === "string"
    ? conditionFromSlug(conditionValue)
    : (conditionValue as Condition | undefined) ?? conditionFromSlug(String(raw.condition_slug ?? ""))
  const suiteValue = raw.suite
  const suite = typeof suiteValue === "string"
    ? { name: suiteValue }
    : (suiteValue as SuiteRef | null | undefined) ?? null
  const model = String(raw.model ?? "unknown")
  const variant = (raw.model_variant as ModelVariant | null | undefined) ?? fallbackVariant(model, condition)
  const summary = normalizeSummary((raw.summary ?? {}) as Partial<RunSummary> & Record<string, unknown>)
  const track = (raw.track ?? raw.kind ?? (condition.puzzle_protocol === "full_line" ? "woodpecker" : "puzzle")) as Track
  const runId = String(raw.run_id ?? raw.file ?? `${variant.key}-${condition.slug}`)
  return {
    run_id: runId,
    file: String(raw.file ?? runId),
    track,
    kind: String(raw.kind ?? track),
    status: (raw.status as RunStatus | undefined) ?? "completed",
    model: variant.key,
    model_variant: variant,
    provider: variant.provider,
    created: String(raw.created ?? raw.created_at ?? ""),
    updated_at: raw.updated_at as string | undefined,
    completed_at: raw.completed_at as string | null | undefined,
    condition,
    condition_slug: condition.slug,
    suite,
    progress: (raw.progress as { completed: number; total: number } | undefined) ?? { completed: summary.n, total: summary.max_points },
    summary,
    usage: raw.usage as RunIndexEntry["usage"],
    error: raw.error as string | null | undefined,
  }
}

async function loadIndex(base: string | null): Promise<RunIndexEntry[]> {
  const doc = await fetchJSON<{ runs: Record<string, unknown>[] }>(base ? `${base}/index` : `${DATA}index.json`)
  return (doc.runs ?? []).map(normalizeIndex)
}

async function loadTournamentIndex(base: string | null): Promise<TournamentIndexEntry[]> {
  try {
    const url = base ? `${base}/tournaments` : `${DATA}tournaments/index.json`
    return (await fetchJSON<{ tournaments: TournamentIndexEntry[] }>(url)).tournaments ?? []
  } catch {
    return []
  }
}

export async function loadDataset(): Promise<Dataset> {
  const base = await resolveApiBase()
  try {
    const [runs, tournaments] = await Promise.all([loadIndex(base), loadTournamentIndex(base)])
    return { runs, tournaments, apiBase: base }
  } catch (error) {
    if (base) {
      cachedBase = null
      cachedBaseCheckedAt = Date.now()
      const [runs, tournaments] = await Promise.all([loadIndex(null), loadTournamentIndex(null)])
      return { runs, tournaments, apiBase: null }
    }
    throw error
  }
}

export async function loadRun(file: string): Promise<Run> {
  const base = await resolveApiBase()
  const raw = await fetchJSON<Record<string, unknown>>(
    base ? `${base}/runs/${encodeURIComponent(file)}` : `${DATA}runs/${file}`,
  )
  const meta = normalizeIndex(raw)
  return {
    ...meta,
    schema: String(raw.schema ?? "chessbench.run.v1"),
    themes: (raw.themes as Run["themes"] | undefined) ?? [],
    items: (raw.items as PuzzleItem[] | undefined) ?? [],
  }
}

let puzzleCache: Promise<PuzzleEntry[]> | null = null
async function loadStaticPuzzleCorpus(): Promise<PuzzleEntry[]> {
  const corpus = await loadPublicCorpus<PuzzlePosition>("standard")
  return corpus.items.map((position) => ({ position, answers: [], aggregate: { solved: 0, total: 0 } }))
}

export function loadPuzzleIndex(): Promise<PuzzleEntry[]> {
  if (puzzleCache) return puzzleCache
  puzzleCache = (async () => {
    const base = await resolveApiBase()
    if (base) {
      const doc = await fetchJSON<{ puzzles: Array<Record<string, unknown>> }>(`${base}/puzzles`)
      return doc.puzzles.map((p) => ({
        position: {
          puzzle_id: String(p.puzzle_id), rating: Number(p.rating), themes: (p.themes as string[]) ?? [],
          categories: (p.categories as Categories) ?? {}, fen: String(p.fen ?? ""),
          solver_is_white: Boolean(p.solver_is_white), solution: (p.solution as string[]) ?? [],
          solution_first: (p.solution_first as string | null | undefined) ?? null,
          rating_deviation: p.rating_deviation == null ? undefined : Number(p.rating_deviation),
          popularity: p.popularity == null ? undefined : Number(p.popularity),
          plays: p.plays == null ? undefined : Number(p.plays),
          setup_san: p.setup_san as string | undefined, game_url: p.game_url as string | undefined,
        },
        answers: [],
        aggregate: { solved: Number(p.solved ?? 0), total: Number(p.total ?? 0) },
      }))
    }
    const [positions, runs] = await Promise.all([loadStaticPuzzleCorpus(), loadIndex(null)])
    const full = await Promise.all(runs.filter((run) => run.track === "puzzle" && isModelVariant(run.model_variant)).map((run) => loadRun(run.file)))
    const map = new Map(positions.map((entry) => [entry.position.puzzle_id, entry]))
    for (const run of full) for (const item of run.items) {
      const entry = map.get(item.puzzle_id) ?? { position: item, answers: [] }
      entry.answers.push({ model: run.model, condition: run.condition.slug, item })
      entry.aggregate = {
        solved: (entry.aggregate?.solved ?? 0) + Number(item.solved),
        total: (entry.aggregate?.total ?? 0) + 1,
      }
      map.set(item.puzzle_id, entry)
    }
    return [...map.values()]
  })().catch((error) => {
    puzzleCache = null
    throw error
  })
  return puzzleCache
}

export async function loadPuzzle(id: string): Promise<PuzzleEntry | null> {
  const base = await resolveApiBase()
  if (base) {
    try {
      const doc = await fetchJSON<{ position: PuzzleItem; answers: Array<Record<string, unknown>> }>(
        `${base}/puzzles/${encodeURIComponent(id)}`,
      )
      return {
        position: doc.position,
        answers: doc.answers.map((answer) => ({
          model: String(answer.model),
          condition: String(answer.condition),
          item: { ...doc.position, ...(answer as unknown as Partial<PuzzleItem>) },
        })),
      }
    } catch {
      return null
    }
  }
  return (await loadPuzzleIndex()).find((entry) => entry.position.puzzle_id === id) ?? null
}

export async function loadTournament(file: string): Promise<Tournament> {
  const base = await resolveApiBase()
  return fetchJSON<Tournament>(base ? `${base}/tournaments/${encodeURIComponent(file)}` : `${DATA}tournaments/${file}`)
}
