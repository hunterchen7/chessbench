// Human progress persisted in localStorage. Each verified solve is one point.

const HKEY = "chessbench.human.v2"

export type HumanOutcome = "solved" | "incorrect" | "revealed"
type Store = Record<string, { solved: boolean; outcome: HumanOutcome }>

export function humanStore(): Store {
  try {
    const parsed = JSON.parse(localStorage.getItem(HKEY) || "{}") as Record<string, { solved?: boolean; outcome?: HumanOutcome }>
    return Object.fromEntries(Object.entries(parsed).map(([id, record]) => [id, {
      solved: Boolean(record.solved),
      outcome: record.outcome ?? (record.solved ? "solved" : "incorrect"),
    }]))
  } catch {
    return {}
  }
}

export function humanRecord(id: string, outcome: HumanOutcome | boolean) {
  const s = humanStore()
  if (s[id]?.solved) return // keep a solve; don't downgrade to a later give-up
  const normalized = typeof outcome === "boolean" ? (outcome ? "solved" : "incorrect") : outcome
  s[id] = { solved: normalized === "solved", outcome: normalized }
  localStorage.setItem(HKEY, JSON.stringify(s))
}
