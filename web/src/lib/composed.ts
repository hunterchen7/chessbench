// Loader and normalizer for the esoteric / composed-problem track (selfmates,
// helpmates, studies, series-movers, proof games, …). Cloudflare run documents
// are preferred; the committed bundle remains an offline/static fallback.
import type { Condition, ModelVariant, RunIndexEntry, RunStatus } from "./data"
import { resolveApiBase } from "./data"

const STATIC_DATA = import.meta.env.BASE_URL + "data/composed/"
const STATIC_CORPUS = import.meta.env.BASE_URL + "data/corpora/esoteric.json"

export type Stipulation =
  | "directmate" | "selfmate" | "reflexmate" | "helpmate"
  | "series_helpmate" | "series_directmate" | "proofgame" | "study"

export interface ComposedTurnUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  reasoning_tokens?: number
  cost?: number
  cost_usd?: number
  completion_tokens_details?: { reasoning_tokens?: number }
}

export interface ComposedTurn {
  system_prompt?: string | null
  prompt?: string | null
  raw_response?: string | null
  parsed_move?: string | null
  rationale?: string | null
  explanation?: string | null
  response_format?: unknown
  response_format_valid?: boolean | null
  response_format_error?: string | null
  prompt_tokens?: number
  completion_tokens?: number
  reasoning_tokens?: number
  cost_usd?: number
  usage?: ComposedTurnUsage | null
}

export interface ComposedItem {
  id: string
  kind: Stipulation
  label: string
  n: number
  fen: string
  goal: string | null
  solution: string[]
  themes: string[]
  answer_shape: "key" | "line" | "play"
  solved: boolean
  answer: string
  answer_rationale?: string | null
  response_format_valid?: boolean | null
  response_format_error?: string | null
  detail: string
  turns: ComposedTurn[]
}

export interface ComposedRun {
  schema: string
  run_id?: string
  created: string
  model: string
  solver: string
  model_variant?: ModelVariant
  condition?: Condition | string
  status?: RunStatus
  progress?: { completed: number; total: number }
  summary: {
    n: number
    solved: number
    solve_rate: number
    points?: number
    max_points?: number
    cost_usd?: number | null
    by_kind: Record<string, { solved: number; n: number }>
  }
  items: ComposedItem[]
}

export interface ComposedProblem {
  id: string
  kind: Stipulation
  label: string
  n: number
  fen: string
  goal: string | null
  solution: string[]
  themes: string[]
  answer_shape: "key" | "line" | "play"
}

export interface ComposedAnswer {
  model: string
  solver: string
  solved: boolean
  answer: string
  answer_rationale?: string | null
  response_format_valid?: boolean | null
  response_format_error?: string | null
  detail: string
  turns: ComposedTurn[]
  condition?: Condition | string
  model_variant?: ModelVariant
  run_id?: string
  status?: RunStatus
}

export interface ComposedEntry {
  problem: ComposedProblem
  answers: ComposedAnswer[]
}

export interface ComposedData {
  runs: ComposedRun[]
  problems: Map<string, ComposedEntry>
  order: string[] // problem ids in file order
  source: "api" | "static"
}

export interface LoadComposedOptions {
  apiBase?: string | null
  manifests?: RunIndexEntry[]
}

export const STIPULATION_LABEL: Record<Stipulation, string> = {
  directmate: "Directmate",
  selfmate: "Selfmate",
  reflexmate: "Reflexmate",
  helpmate: "Helpmate",
  series_helpmate: "Series helpmate",
  series_directmate: "Series directmate",
  proofgame: "Proof game",
  study: "Study",
}

export const STIPULATION_BLURB: Record<Stipulation, string> = {
  directmate: "White moves first and forces mate in N — the classic problem.",
  selfmate: "White forces Black to deliver mate against Black's will.",
  reflexmate: "Like a selfmate, but either side must mate if able to.",
  helpmate: "Both sides cooperate to checkmate Black in N moves.",
  series_helpmate: "Black plays N consecutive moves, then White mates in one.",
  series_directmate: "White plays N consecutive moves (no Black replies) to mate.",
  proofgame: "Find the exact game that reaches this position in N plies.",
  study: "An endgame study: play it out and convert the result vs a defender.",
}

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  return res.json() as Promise<T>
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String) : []

function normalizeItem(value: unknown): ComposedItem | null {
  const item = record(value)
  const result = record(item.result)
  const id = String(item.id ?? result.problem_id ?? item.puzzle_id ?? "")
  if (!id) return null
  const kind = String(item.kind ?? result.kind ?? "directmate") as Stipulation
  const n = Number(item.n ?? 0)
  const answerShape = String(item.answer_shape ?? (kind === "study" ? "play" : n > 1 ? "line" : "key"))
  return {
    id,
    kind,
    label: String(item.label ?? id),
    n,
    fen: String(item.fen ?? ""),
    goal: item.goal == null ? null : String(item.goal),
    solution: strings(item.solution),
    themes: strings(item.themes),
    answer_shape: (answerShape === "play" || answerShape === "line" ? answerShape : "key"),
    solved: Boolean(item.solved ?? result.solved),
    answer: String(item.answer ?? result.answer ?? ""),
    answer_rationale: (item.answer_rationale ?? result.answer_rationale) as string | null | undefined,
    response_format_valid: (item.response_format_valid ?? result.response_format_valid) as boolean | null | undefined,
    response_format_error: (item.response_format_error ?? result.response_format_error) as string | null | undefined,
    detail: String(item.detail ?? result.detail ?? result.outcome ?? ""),
    turns: ((item.turns ?? result.turns) as ComposedTurn[] | undefined) ?? [],
  }
}

function normalizeRun(value: unknown, manifest?: RunIndexEntry): ComposedRun {
  const raw = record(value)
  const items = (Array.isArray(raw.items) ? raw.items : []).flatMap((item) => {
    const normalized = normalizeItem(item)
    return normalized ? [normalized] : []
  })
  const summary = record(raw.summary)
  const byKind: Record<string, { solved: number; n: number }> = {}
  for (const item of items) {
    const current = byKind[item.kind] ?? { solved: 0, n: 0 }
    current.n += 1
    current.solved += Number(item.solved)
    byKind[item.kind] = current
  }
  const modelVariant = (raw.model_variant as ModelVariant | undefined) ?? manifest?.model_variant
  const n = Number(summary.n ?? manifest?.summary.n ?? items.length)
  const solved = Number(summary.solved ?? manifest?.summary.solved ?? items.filter((item) => item.solved).length)
  return {
    schema: String(raw.schema ?? "chessbench.composed_run.v1"),
    run_id: String(raw.run_id ?? manifest?.run_id ?? "") || undefined,
    created: String(raw.created ?? raw.created_at ?? manifest?.created ?? ""),
    model: String(modelVariant?.base_key ?? raw.model ?? manifest?.model ?? "unknown"),
    solver: String(raw.solver ?? modelVariant?.provider ?? manifest?.provider ?? "unknown"),
    model_variant: modelVariant,
    condition: (raw.condition as Condition | string | undefined) ?? manifest?.condition,
    status: (raw.status as RunStatus | undefined) ?? manifest?.status,
    progress: (raw.progress as { completed: number; total: number } | undefined) ?? manifest?.progress,
    summary: {
      n,
      solved,
      solve_rate: Number(summary.solve_rate ?? (n ? solved / n : 0)),
      points: Number(summary.points ?? manifest?.summary.points ?? solved),
      max_points: Number(summary.max_points ?? manifest?.summary.max_points ?? n),
      cost_usd: summary.cost_usd == null ? manifest?.summary.cost_usd : Number(summary.cost_usd),
      by_kind: (summary.by_kind as Record<string, { solved: number; n: number }> | undefined) ?? byKind,
    },
    items,
  }
}

function composeData(runs: ComposedRun[], source: ComposedData["source"], corpus: ComposedProblem[] = []): ComposedData {
  const problems = new Map<string, ComposedEntry>()
  const order: string[] = []
  for (const problem of corpus) {
    problems.set(problem.id, { problem, answers: [] })
    order.push(problem.id)
  }
  for (const run of runs) {
    for (const item of run.items) {
      let entry = problems.get(item.id)
      if (!entry) {
        entry = {
          problem: {
            id: item.id,
            kind: item.kind,
            label: item.label,
            n: item.n,
            fen: item.fen,
            goal: item.goal,
            solution: item.solution,
            themes: item.themes,
            answer_shape: item.answer_shape,
          },
          answers: [],
        }
        problems.set(item.id, entry)
        order.push(item.id)
      }
      entry.answers.push({
        model: run.model,
        solver: run.solver,
        solved: item.solved,
        answer: item.answer,
        answer_rationale: item.answer_rationale,
        response_format_valid: item.response_format_valid,
        response_format_error: item.response_format_error,
        detail: item.detail,
        turns: item.turns,
        condition: run.condition,
        model_variant: run.model_variant,
        run_id: run.run_id,
        status: run.status,
      })
    }
  }
  return { runs, problems, order, source }
}

async function loadStaticComposed(): Promise<ComposedData> {
  let corpus: ComposedProblem[] = []
  try {
    corpus = (await fetchJSON<{ items: ComposedProblem[] }>(STATIC_CORPUS)).items ?? []
  } catch {
    // An empty corpus still yields a valid no-data state.
  }
  let index: { runs: { file: string }[] }
  try {
    index = await fetchJSON<{ runs: { file: string }[] }>(`${STATIC_DATA}index.json`)
  } catch {
    return composeData([], "static", corpus)
  }
  const loaded = await Promise.all(index.runs.map(async ({ file }) => {
    try {
      return normalizeRun(await fetchJSON<unknown>(`${STATIC_DATA}${file}`))
    } catch {
      return null
    }
  }))
  return composeData(loaded.filter((run): run is ComposedRun => run !== null), "static", corpus)
}

async function loadApiComposed(base: string, manifests?: RunIndexEntry[]): Promise<ComposedData | null> {
  const corpus = (await fetchJSON<{ items?: ComposedProblem[] }>(`${base}/corpora/esoteric`)).items ?? []
  let candidates = manifests?.filter((run) => run.track === "esoteric")
  if (!candidates) {
    const index = await fetchJSON<{ runs?: RunIndexEntry[] }>(`${base}/index`)
    candidates = (index.runs ?? []).filter((run) => run.track === "esoteric")
  }
  if (candidates.length === 0) return composeData([], "api", corpus)
  const loaded = await Promise.all(candidates.map(async (manifest) => {
    try {
      const doc = await fetchJSON<unknown>(`${base}/runs/${encodeURIComponent(manifest.run_id)}`)
      return normalizeRun(doc, manifest)
    } catch {
      return null
    }
  }))
  const runs = loaded.filter((run): run is ComposedRun => run !== null)
  return composeData(runs, "api", corpus)
}

export async function loadComposed(options: LoadComposedOptions = {}): Promise<ComposedData> {
  const base = options.apiBase === undefined ? await resolveApiBase() : options.apiBase
  if (base) {
    try {
      const remote = await loadApiComposed(base, options.manifests)
      if (remote) return remote
    } catch {
      // Keep the dashboard useful offline or while D1 is temporarily unavailable.
    }
  }
  return loadStaticComposed()
}

export function composedTurnUsage(turn: ComposedTurn) {
  const usage = turn.usage ?? {}
  return {
    promptTokens: Number(turn.prompt_tokens ?? usage.prompt_tokens ?? 0),
    completionTokens: Number(turn.completion_tokens ?? usage.completion_tokens ?? 0),
    reasoningTokens: Number(
      turn.reasoning_tokens ?? usage.reasoning_tokens ?? usage.completion_tokens_details?.reasoning_tokens ?? 0,
    ),
    costUsd: Number(turn.cost_usd ?? usage.cost_usd ?? usage.cost ?? 0),
  }
}
