// Human progress persisted in localStorage: the human solves the same puzzles,
// and gets an MLE puzzle-Elo computed the same way as the Python puzzle_elo.
import type { PuzzleEntry } from "./data"

const HKEY = "chessbench.human.v2"

type Store = Record<string, { solved: boolean }>

export function humanStore(): Store {
  try {
    return JSON.parse(localStorage.getItem(HKEY) || "{}")
  } catch {
    return {}
  }
}

export function humanRecord(id: string, solved: boolean) {
  const s = humanStore()
  if (s[id]?.solved) return // keep a solve; don't downgrade to a later give-up
  s[id] = { solved }
  localStorage.setItem(HKEY, JSON.stringify(s))
}

function eloMLE(items: { rating: number; solved: boolean }[]): { rating: number; bounded: boolean } | null {
  const n = items.length
  const wins = items.filter((x) => x.solved).length
  if (!n || !wins) return null
  if (wins === n) return { rating: 4000, bounded: false }
  const E = (t: number, r: number) => 1 / (1 + Math.pow(10, (r - t) / 400))
  const grad = (t: number) => items.reduce((s, x) => s + ((x.solved ? 1 : 0) - E(t, x.rating)), 0)
  let a = 0,
    b = 4000
  for (let i = 0; i < 200 && b - a > 0.5; i++) {
    const m = (a + b) / 2
    if (grad(m) > 0) a = m
    else b = m
  }
  return { rating: (a + b) / 2, bounded: true }
}

export function humanSummary(puzzleIndex: Map<string, PuzzleEntry>) {
  const store = humanStore()
  const items: { rating: number; solved: boolean }[] = []
  for (const [id, rec] of Object.entries(store)) {
    const e = puzzleIndex.get(id)
    if (e) items.push({ rating: e.position.rating, solved: rec.solved })
  }
  const solved = items.filter((x) => x.solved).length
  return { n: items.length, solved, elo: eloMLE(items) }
}
