const HANDLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,23}$/
export const HUMAN_TRAINING_MAX_SAVE_DEVIATION = 75

export interface TrainingState {
  rating: number
  deviation: number
  volatility: number
}

export interface TrainingSession {
  version: 1
  state: TrainingState
  attempts: number
  solved: number
  recent_puzzle_ids: string[]
  recent_attempts: unknown[]
  updated_at: string | null
  selector?: {
    version: "deterministic_rating_band_v1"
    seed: number
    target_radius: number
    pool_hash: string | null
    next_sequence: number
  } | null
}

export interface ParsedTrainingSave {
  uid: string
  handle: string
  session: TrainingSession
}

function finiteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
}

export function normalizedTrainingUid(value: unknown): string | null {
  if (typeof value !== "string") return null
  const uid = value.trim().slice(0, 64)
  return uid && uid === value.trim() ? uid : null
}

export function parseTrainingSave(value: unknown): ParsedTrainingSave | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Record<string, unknown>
  const uid = normalizedTrainingUid(raw.uid)
  const handle = typeof raw.handle === "string" ? raw.handle.trim() : ""
  const session = raw.session as Partial<TrainingSession> | null
  const state = session?.state as Partial<TrainingState> | null
  const selector = session?.selector
  const validSelector = selector == null || (
    selector.version === "deterministic_rating_band_v1" &&
    Number.isSafeInteger(selector.seed) &&
    Number.isSafeInteger(selector.target_radius) && selector.target_radius >= 0 && selector.target_radius <= 2_000 &&
    (selector.pool_hash == null || (typeof selector.pool_hash === "string" && selector.pool_hash.length <= 128)) &&
    Number.isSafeInteger(selector.next_sequence) && selector.next_sequence >= 0 && selector.next_sequence <= 100_000
  )
  if (
    !uid || !HANDLE_PATTERN.test(handle) || session?.version !== 1 || !state ||
    !finiteInRange(state.rating, 400, 4000) ||
    !finiteInRange(state.deviation, 45, 500) || state.deviation >= HUMAN_TRAINING_MAX_SAVE_DEVIATION ||
    !finiteInRange(state.volatility, 0.000001, 0.1) ||
    !Number.isSafeInteger(session.attempts) || session.attempts! < 0 || session.attempts! > 100_000 ||
    !Number.isSafeInteger(session.solved) || session.solved! < 0 || session.solved! > session.attempts! ||
    !Array.isArray(session.recent_puzzle_ids) || session.recent_puzzle_ids.length > 100 ||
    session.recent_puzzle_ids.some((id) => typeof id !== "string" || !id || id.length > 64) ||
    !Array.isArray(session.recent_attempts) || session.recent_attempts.length > 100 ||
    !(session.updated_at == null || typeof session.updated_at === "string") || !validSelector
  ) return null
  return { uid, handle, session: session as TrainingSession }
}
