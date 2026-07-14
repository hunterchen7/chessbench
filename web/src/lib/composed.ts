// Loader for the esoteric / composed-problem track (selfmate, helpmate, studies,
// series-movers, proof games, …). Served as static JSON — one run file per solver.
const DATA = import.meta.env.BASE_URL + "data/composed/"

export type Stipulation =
  | "directmate" | "selfmate" | "reflexmate" | "helpmate"
  | "series_helpmate" | "series_directmate" | "proofgame" | "study"

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
  detail: string
}

export interface ComposedRun {
  schema: string
  created: string
  model: string
  solver: string
  summary: { n: number; solved: number; solve_rate: number; by_kind: Record<string, { solved: number; n: number }> }
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
  detail: string
}

export interface ComposedEntry {
  problem: ComposedProblem
  answers: ComposedAnswer[]
}

export interface ComposedData {
  runs: ComposedRun[]
  problems: Map<string, ComposedEntry>
  order: string[] // problem ids in file order
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

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(DATA + path)
  if (!res.ok) throw new Error(`${path}: ${res.status}`)
  return res.json()
}

export async function loadComposed(): Promise<ComposedData> {
  let index: { runs: { file: string; model: string }[] }
  try {
    index = await getJSON<{ runs: { file: string; model: string }[] }>("index.json")
  } catch {
    return { runs: [], problems: new Map(), order: [] }
  }
  const runs: ComposedRun[] = []
  for (const meta of index.runs) {
    try {
      runs.push(await getJSON<ComposedRun>(meta.file))
    } catch {
      /* skip a missing run */
    }
  }
  const problems = new Map<string, ComposedEntry>()
  const order: string[] = []
  for (const run of runs) {
    for (const it of run.items) {
      let entry = problems.get(it.id)
      if (!entry) {
        entry = {
          problem: {
            id: it.id, kind: it.kind, label: it.label, n: it.n, fen: it.fen,
            goal: it.goal, solution: it.solution, themes: it.themes, answer_shape: it.answer_shape,
          },
          answers: [],
        }
        problems.set(it.id, entry)
        order.push(it.id)
      }
      entry.answers.push({ model: run.model, solver: run.solver, solved: it.solved, answer: it.answer, detail: it.detail })
    }
  }
  return { runs, problems, order }
}
