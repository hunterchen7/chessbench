// Talks to the Cloudflare backend for the shared human-solver leaderboard.
// Everything degrades gracefully: if the backend is absent, solves still live in
// localStorage (see human.ts) and these calls no-op.

import type { HumanTrainingSession } from "@/lib/humanTraining"

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

export interface HumanRow {
  handle: string | null
  me: boolean
  n: number
  solved: number
  points: number
  max_points: number
  accuracy: number
}

export interface HumanTrainingProfile {
  handle: string
  rating: number
  rating_deviation: number
  volatility: number
  attempts: number
  solved: number
  accuracy: number
  session: HumanTrainingSession
  created_at: string
  updated_at: string
  next_save_at: string
}

export interface HumanTrainingLeaderboardRow {
  rank: number
  me: boolean
  handle: string
  seed: number | null
  rating: number
  rating_deviation: number
  provisional: boolean
  attempts: number
  solved: number
  accuracy: number
  updated_at: string
}

export class HumanTrainingSaveError extends Error {
  readonly status: number
  readonly retryAfterSeconds?: number

  constructor(message: string, status: number, retryAfterSeconds?: number) {
    super(message)
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

const trainingProfileCache = new Map<string, Promise<HumanTrainingProfile | null>>()

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

export async function fetchHumanTrainingProfile(base: string): Promise<HumanTrainingProfile | null> {
  const cached = trainingProfileCache.get(base)
  if (cached) return cached
  const request = fetch(`${base}/human/training?uid=${encodeURIComponent(getUid())}`)
    .then(async (response) => {
      if (!response.ok) throw new Error(`Could not load saved training run (${response.status}).`)
      return ((await response.json()) as { profile?: HumanTrainingProfile | null }).profile ?? null
    })
    .catch((reason) => {
      trainingProfileCache.delete(base)
      throw reason
    })
  trainingProfileCache.set(base, request)
  return request
}

export async function fetchHumanTrainingProfileByHandle(base: string, handle: string): Promise<HumanTrainingProfile | null> {
  const response = await fetch(`${base}/human/training?handle=${encodeURIComponent(handle)}`)
  if (!response.ok) throw new Error(`Could not load human training run (${response.status}).`)
  return ((await response.json()) as { profile?: HumanTrainingProfile | null }).profile ?? null
}

export async function saveHumanTrainingProfile(
  base: string,
  handle: string,
  session: HumanTrainingSession,
): Promise<HumanTrainingProfile> {
  const response = await fetch(`${base}/human/training`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uid: getUid(), handle, session }),
  })
  const body = await response.json().catch(() => ({})) as {
    profile?: HumanTrainingProfile
    error?: string
    retry_after_seconds?: number
  }
  if (!response.ok || !body.profile) {
    throw new HumanTrainingSaveError(
      body.error ?? `Could not save training run (${response.status}).`,
      response.status,
      body.retry_after_seconds,
    )
  }
  trainingProfileCache.set(base, Promise.resolve(body.profile))
  return body.profile
}

export async function fetchHumanTrainingLeaderboard(base: string): Promise<HumanTrainingLeaderboardRow[]> {
  try {
    const response = await fetch(`${base}/human/training/leaderboard?uid=${encodeURIComponent(getUid())}`)
    if (!response.ok) return []
    return ((await response.json()) as { leaderboard?: HumanTrainingLeaderboardRow[] }).leaderboard ?? []
  } catch {
    return []
  }
}
