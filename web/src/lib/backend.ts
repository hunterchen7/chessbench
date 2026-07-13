// Talks to the Cloudflare backend for the shared human-solver leaderboard.
// Everything degrades gracefully: if the backend is absent, solves still live in
// localStorage (see human.ts) and these calls no-op.

const UID_KEY = "chessbench.uid"

/** A stable anonymous id for this browser, used to attribute human solves. */
export function getUid(): string {
  let uid = localStorage.getItem(UID_KEY)
  if (!uid) {
    uid = crypto?.randomUUID?.() ?? `u_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
    localStorage.setItem(UID_KEY, uid)
  }
  return uid
}

export interface HumanElo {
  rating: number
  bounded: boolean
}

export interface HumanRow {
  handle: string | null
  me: boolean
  n: number
  solved: number
  elo: HumanElo
}

/** Record a solve server-side (fire-and-forget; never throws). `move` is the first
 * move the player made — the server credits a solve only if it matches the solution. */
export async function pushSolve(base: string, puzzleId: string, solved: boolean, move: string | null): Promise<void> {
  try {
    await fetch(`${base}/human/solve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: getUid(), puzzle_id: puzzleId, solved, move }),
    })
  } catch {
    /* offline — localStorage still has it */
  }
}

export async function fetchHumanLeaderboard(base: string): Promise<HumanRow[]> {
  try {
    const r = await fetch(`${base}/human/leaderboard?uid=${encodeURIComponent(getUid())}`)
    if (!r.ok) return []
    return ((await r.json()) as { leaderboard?: HumanRow[] }).leaderboard ?? []
  } catch {
    return []
  }
}
