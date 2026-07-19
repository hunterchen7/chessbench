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
  reasoning_exclude?: boolean
  max_output_tokens?: number
  cache_policy?: "disabled" | "prompt_prefix_v1" | string
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
  provider_route?: {
    only: string[]
    order: string[]
    allow_fallbacks: boolean
    require_parameters: boolean
  }
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
  solver_rating_before?: RatedPuzzleState | null
  solver_rating_after?: RatedPuzzleState | null
  rated_selection?: {
    puzzle_id: string
    sequence: number
    target_rating: number
    minimum_rating: number
    maximum_rating: number
    radius: number
    eligible_count: number
    seed: number
    selector_version: string
  } | null
  turns?: Array<{
    solver_ply: number
    system_prompt?: string | null
    prompt?: string | null
    raw_response?: string | null
    parsed_move?: string | null
    rationale?: string | null
    explanation?: string | null
    reasoning?: string | null
    reasoning_details?: Array<Record<string, unknown>> | null
    response_format_valid?: boolean | null
    response_format_error?: string | null
    prompt_tokens: number
    completion_tokens: number
    reasoning_tokens: number
    cost_usd: number
    cache_read_tokens?: number
    cache_write_tokens?: number
    uncached_prompt_tokens?: number
    cache_discount_usd?: number
    cache_policy?: string
    cache_session_id?: string | null
    usage?: Record<string, unknown> | null
  }>
}

export interface RatedPuzzleState {
  rating: number
  rating_deviation: number
  volatility: number
  provisional: boolean
  ci95: [number, number]
}

export interface RatedSessionProtocol {
  kind: "adaptive_glicko2"
  version: string
  canonical: boolean
  pool: { name: string; version: string; content_hash: string }
  selection: {
    version: string
    seed: number
    target_radius: number
    without_replacement: boolean
    deterministic: boolean
  }
  rating: {
    version: string
    initial: RatedPuzzleState
    tau: number
    puzzles_frozen: boolean
    calendar_aging: boolean
    full_solve_is_win: boolean
    partial_credit_affects_rating: boolean
  }
  stopping: {
    minimum_puzzles: number
    maximum_puzzles: number
    target_rating_deviation: number
  }
  prompt: {
    version: string
    legal_moves_supplied: boolean
    coaching: boolean
    rationale_requested: boolean
    illegal_move: string
    wrong_move: string
    notation: "uci"
  }
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
    rating_deviation?: number | null
    ci95: [number, number] | null
    n: number
    bounded: boolean
    method?: "bayesian_elo_v1" | "maximum_likelihood" | string
    provisional?: boolean
    settled?: boolean
    volatility?: number
    prior?: { mean: number; sd: number } | null
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

export interface RunTermination {
  kind: "consecutive_unsolved" | "rating_settled" | "maximum_puzzles" | "operator_rounded"
  threshold?: number | null
  attempted: number
  unattempted?: number
  unattempted_score?: 0
  maximum?: number
  target_rating_deviation?: number
  actual_rating_deviation?: number
  display_rating_deviation?: number
  message?: string | null
}

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
  protocol?: RatedSessionProtocol | Record<string, unknown> | null
  suite: SuiteRef | null
  progress: { completed: number; total: number }
  termination?: RunTermination | null
  summary: RunSummary
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    reasoning_tokens: number
    cache_read_tokens?: number
    cache_write_tokens?: number
    uncached_prompt_tokens?: number
    cache_discount_usd?: number
    cost_usd: number
  }
  error?: string | null
}

export interface Run extends RunIndexEntry {
  schema: string
  themes: Array<{
    theme: string
    n: number
    accuracy: number
    puzzle_performance_rating?: RunSummary["puzzle_performance_rating"]
  }>
  category_ratings?: Array<{
    dimension: string
    value: string
    n: number
    solved: number
    accuracy: number
    puzzle_performance_rating: RunSummary["puzzle_performance_rating"]
  }>
  items: PuzzleItem[]
}

export interface PuzzleAnswer {
  run_id?: string
  model: string
  model_variant?: ModelVariant
  condition: string
  item: PuzzleItem
}

export interface PuzzleEntry {
  position: PuzzlePosition
  answers: PuzzleAnswer[]
  aggregate?: { solved: number; total: number }
}

export interface RatedPuzzleListItem {
  puzzle_id: string
  rating: number
  rating_deviation?: number
  popularity?: number
  plays?: number
  themes: string[]
  categories: Categories
}

export const RATED_PUZZLE_PAGE_SIZE = 10_000
export const RATED_PUZZLE_SORTS = ["rating", "rating_deviation", "popularity", "plays", "puzzle_id"] as const
export const RATED_PUZZLE_DIRECTIONS = ["asc", "desc"] as const
export const RATED_PUZZLE_TIERS = ["beginner", "novice", "intermediate", "advanced", "expert", "master"] as const
export type RatedPuzzleSort = typeof RATED_PUZZLE_SORTS[number]
export type RatedPuzzleDirection = typeof RATED_PUZZLE_DIRECTIONS[number]
export type RatedPuzzleTier = typeof RATED_PUZZLE_TIERS[number]

export interface RatedPuzzleQuery {
  sort: RatedPuzzleSort
  direction: RatedPuzzleDirection
  tier?: RatedPuzzleTier
  theme?: string
  id_prefix?: string
  min_rating?: number
  max_rating?: number
}

export const DEFAULT_RATED_PUZZLE_QUERY: RatedPuzzleQuery = { sort: "rating", direction: "asc" }

function boundedQueryInteger(value: string | null): number | undefined {
  if (value == null || !/^\d+$/.test(value)) return undefined
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0 && number <= 4000 ? number : undefined
}

export function ratedPuzzleQueryFromSearchParams(params: URLSearchParams): RatedPuzzleQuery {
  const sortValue = params.get("sort")
  const directionValue = params.get("direction")
  const tierValue = params.get("tier")
  const themeValue = params.get("theme")
  const idPrefixValue = params.get("id_prefix")
  const minRating = boundedQueryInteger(params.get("min_rating"))
  const maxRating = boundedQueryInteger(params.get("max_rating"))
  return {
    sort: RATED_PUZZLE_SORTS.includes(sortValue as RatedPuzzleSort) ? sortValue as RatedPuzzleSort : "rating",
    direction: RATED_PUZZLE_DIRECTIONS.includes(directionValue as RatedPuzzleDirection) ? directionValue as RatedPuzzleDirection : "asc",
    tier: RATED_PUZZLE_TIERS.includes(tierValue as RatedPuzzleTier) ? tierValue as RatedPuzzleTier : undefined,
    theme: themeValue && /^[A-Za-z0-9_-]{1,80}$/.test(themeValue) ? themeValue : undefined,
    id_prefix: idPrefixValue && /^[A-Za-z0-9_-]{1,32}$/.test(idPrefixValue) ? idPrefixValue : undefined,
    min_rating: minRating,
    max_rating: maxRating,
  }
}

export function ratedPuzzleQueryParams(query: RatedPuzzleQuery): URLSearchParams {
  const params = new URLSearchParams({ sort: query.sort, direction: query.direction })
  if (query.tier) params.set("tier", query.tier)
  if (query.theme) params.set("theme", query.theme)
  if (query.id_prefix) params.set("id_prefix", query.id_prefix)
  if (query.min_rating != null) params.set("min_rating", String(query.min_rating))
  if (query.max_rating != null) params.set("max_rating", String(query.max_rating))
  return params
}

export interface RatedPuzzlePage {
  schema: "chessbench.rated_puzzle_page.v1"
  pool: {
    name: string
    version: string
    content_hash: string
    items: number
    updated_at: string
  }
  pagination: {
    page: number
    per_page: number
    total_items: number | null
    total_pages: number | null
    returned: number
    has_previous: boolean
    has_next: boolean
  }
  query: {
    sort: RatedPuzzleSort
    direction: RatedPuzzleDirection
    tier: RatedPuzzleTier | null
    theme: string | null
    id_prefix: string | null
    min_rating: number | null
    max_rating: number | null
  }
  puzzles: RatedPuzzleListItem[]
}

export interface RatedPuzzleSelection {
  schema: "chessbench.rated_puzzle_selection.v1"
  selection_id: string
  selected_at: string
  pool: {
    name: string
    version: string
    content_hash: string
    items: number
  }
  filters: {
    category: string | null
    min_rating: number
    max_rating: number
    excluded: number
  }
  puzzle: PuzzlePosition
}

export interface SeededRatedPuzzleSelection {
  schema: "chessbench.seeded_rated_puzzle_selection.v1"
  selection_id: string
  selected_at: string
  pool: RatedPuzzleSelection["pool"]
  selection: {
    puzzle_id: string
    sequence: number
    target_rating: number
    minimum_rating: number
    maximum_rating: number
    radius: number
    eligible_count: number
    seed: number
    selector_version: string
  }
  puzzle: PuzzlePosition
}

export interface SeededRatedPuzzlePreview extends Omit<SeededRatedPuzzleSelection, "schema" | "puzzle"> {
  schema: "chessbench.seeded_rated_puzzle_preview.v1"
  puzzle: RatedPuzzleListItem
}

export interface PromptCatalogStyle {
  style: "move_only" | "json_rationale"
  response_protocol: string
  condition_slug: string
  system_prompt: string
  user_prompt: string
  provider_response_format: Record<string, unknown> | null
}

export interface PromptCatalogMethod {
  internal_mode: number
  display_mode: number
  name: string
  prompt_version: string
  styles: PromptCatalogStyle[]
}

export interface PromptCatalog {
  schema: "chessbench.prompt_catalog.v1"
  scope: "standard_puzzle_first_turn"
  reference: {
    suite: string
    content_hash: string
    puzzle_id: string
    fen: string
  }
  methods: PromptCatalogMethod[]
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

export interface SuiteCatalogEntry {
  name: string
  version: string
  kind: "puzzle" | "composed"
  visibility: "public" | "private"
  items: number
  content_hash: string
  description: string
  current?: boolean
}

export interface SuiteCatalog {
  schema: "chessbench.suite_catalog.v2"
  suites: SuiteCatalogEntry[]
}

let suiteCatalogRequest: Promise<SuiteCatalog> | null = null
export function loadSuiteCatalog(): Promise<SuiteCatalog> {
  return suiteCatalogRequest ??= fetchJSON<SuiteCatalog>(`${DATA}suites.json`, { cache: "no-store" }).catch((error) => {
    suiteCatalogRequest = null
    throw error
  })
}

export async function loadPublicCorpus<T>(track: "standard" | "woodpecker" | "esoteric"): Promise<PublicCorpus<T>> {
  return fetchJSON<PublicCorpus<T>>(`${DATA}corpora/${track}.json`)
}

let promptCatalogCache: Promise<PromptCatalog> | null = null
export function loadPromptCatalog(): Promise<PromptCatalog> {
  return promptCatalogCache ??= fetchJSON<PromptCatalog>(`${DATA}prompts.json`).catch((error) => {
    promptCatalogCache = null
    throw error
  })
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
  source_category: string
  source_label: string
}

export interface HistoricalCandidateBank {
  schema: "chessbench.public_historical_candidates.v1"
  status: "candidate_only_not_scored"
  candidate_count: number
  difficulty: Record<"easy" | "medium" | "hard", number>
  items: HistoricalCandidate[]
}

let historicalCandidatesRequest: Promise<HistoricalCandidateBank> | null = null

export function loadHistoricalCandidates(): Promise<HistoricalCandidateBank> {
  if (!historicalCandidatesRequest) {
    historicalCandidatesRequest = fetchJSON<HistoricalCandidateBank>(`${DATA}corpora/historical.json`).catch((error) => {
      historicalCandidatesRequest = null
      throw error
    })
  }
  return historicalCandidatesRequest
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
  cache_read_tokens?: number
  cache_write_tokens?: number
  uncached_prompt_tokens?: number
  cache_discount_usd?: number
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
  reasoning?: string | null
  reasoning_details?: Array<Record<string, unknown>> | null
  response_format_valid?: boolean | null
  response_format_error?: string | null
  prompt_tokens: number
  completion_tokens: number
  reasoning_tokens: number
  cache_read_tokens?: number
  cache_write_tokens?: number
  uncached_prompt_tokens?: number
  cache_discount_usd?: number
  cache_policy?: string
  cache_session_id?: string | null
  usage?: Record<string, unknown> | null
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

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
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
  const cachePolicy = parts.find((part) => part.startsWith("cache-"))?.slice(6).replaceAll("-", "_")
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
    cache_policy: cachePolicy ?? "disabled",
    slug,
  }
}

function fallbackVariant(model: string, condition: Condition, provider = "unknown"): ModelVariant {
  const display = model.includes("/") ? model.split("/").at(-1)! : model
  const exclude = condition.reasoning_exclude ?? true
  const reasoning = { effort: condition.reasoning_effort, max_tokens: condition.reasoning_max_tokens, exclude }
  const capture = exclude ? "" : "-captured"
  return {
    key: `${model}--${condition.reasoning_max_tokens ? `r${condition.reasoning_max_tokens}t${capture}` : `r-${condition.reasoning_effort ?? "default"}${capture}`}`,
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
    protocol: raw.protocol as RunIndexEntry["protocol"],
    suite,
    progress: (raw.progress as { completed: number; total: number } | undefined) ?? { completed: summary.n, total: summary.max_points },
    termination: raw.termination as RunTermination | null | undefined,
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
    category_ratings: (raw.category_ratings as Run["category_ratings"] | undefined) ?? [],
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
      entry.answers.push({ model: run.model, model_variant: run.model_variant, condition: run.condition.slug, item })
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

export function loadRatedPuzzlePage(
  apiBase: string | null,
  page: number,
  perPage = RATED_PUZZLE_PAGE_SIZE,
  signal?: AbortSignal,
  query: RatedPuzzleQuery = DEFAULT_RATED_PUZZLE_QUERY,
  includeTotal = true,
): Promise<RatedPuzzlePage> {
  if (!apiBase) return Promise.reject(new Error("Rated-pool browsing requires the live ChessBench API."))
  const params = ratedPuzzleQueryParams(query)
  params.set("page", String(page))
  params.set("per_page", String(perPage))
  if (!includeTotal) params.set("include_total", "0")
  return fetchJSON<RatedPuzzlePage>(`${apiBase}/puzzles/rated?${params}`, { signal })
}

export function loadRandomRatedPuzzle(
  apiBase: string | null,
  rating: number,
  radius: number,
  excluded: string[] = [],
  signal?: AbortSignal,
): Promise<RatedPuzzleSelection> {
  if (!apiBase) return Promise.reject(new Error("Puzzle training requires the live ChessBench API."))
  const params = new URLSearchParams({
    rating: String(Math.round(rating)),
    radius: String(Math.round(radius)),
  })
  if (excluded.length) params.set("exclude", excluded.slice(-100).join(","))
  return fetchJSON<RatedPuzzleSelection>(`${apiBase}/puzzles/random?${params}`, { signal })
}

export function loadSeededRatedPuzzle(
  apiBase: string | null,
  options: {
    rating: number
    seed: number
    sequence: number
    targetRadius: number
    poolHash?: string | null
    excluded?: string[]
  },
  signal?: AbortSignal,
): Promise<SeededRatedPuzzleSelection> {
  if (!apiBase) return Promise.reject(new Error("Puzzle training requires the live ChessBench API."))
  const params = new URLSearchParams({
    rating: String(options.rating),
    seed: String(options.seed),
    sequence: String(options.sequence),
    target_radius: String(options.targetRadius),
  })
  if (options.poolHash) params.set("pool_hash", options.poolHash)
  if (options.excluded?.length) params.set("exclude", options.excluded.slice(-100).join(","))
  return fetchJSON<SeededRatedPuzzleSelection>(`${apiBase}/puzzles/seeded?${params}`, { signal })
}

export function loadSeededRatedPuzzlePreview(
  apiBase: string | null,
  options: Parameters<typeof loadSeededRatedPuzzle>[1],
  signal?: AbortSignal,
): Promise<SeededRatedPuzzlePreview> {
  if (!apiBase) return Promise.reject(new Error("Puzzle training requires the live ChessBench API."))
  const params = new URLSearchParams({
    rating: String(options.rating),
    seed: String(options.seed),
    sequence: String(options.sequence),
    target_radius: String(options.targetRadius),
    preview: "1",
  })
  if (options.poolHash) params.set("pool_hash", options.poolHash)
  if (options.excluded?.length) params.set("exclude", options.excluded.slice(-100).join(","))
  return fetchJSON<SeededRatedPuzzlePreview>(`${apiBase}/puzzles/seeded?${params}`, { signal })
}

export async function loadPuzzle(id: string, poolHash?: string | null): Promise<PuzzleEntry | null> {
  const base = await resolveApiBase()
  if (base) {
    try {
      const params = new URLSearchParams()
      if (poolHash) params.set("pool_hash", poolHash)
      const query = params.size ? `?${params}` : ""
      const doc = await fetchJSON<{ position: PuzzleItem; answers: Array<Record<string, unknown>> }>(
        `${base}/puzzles/${encodeURIComponent(id)}${query}`,
      )
      return {
        position: doc.position,
        answers: doc.answers.map((answer) => ({
          run_id: answer.run_id == null ? undefined : String(answer.run_id),
          model: String(answer.model),
          model_variant: answer.model_variant as ModelVariant | undefined,
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
