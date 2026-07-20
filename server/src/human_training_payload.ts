const HANDLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,23}$/
export const HUMAN_TRAINING_MAX_SAVE_DEVIATION = 77

export interface TrainingState {
  rating: number
  deviation: number
  volatility: number
}

export interface TrainingAttempt {
  puzzle_id: string
  puzzle_rating: number
  puzzle_deviation: number
  solved: boolean
  rating_before: number
  rating_after: number
  played_at: string
  duration_ms?: number
  outcome?: "solved" | "incorrect" | "revealed"
  moves?: string[]
  experienced_line?: string[]
  solution?: string[]
  fen?: string
}

export interface TrainingSession {
  version: 1
  state: TrainingState
  attempts: number
  solved: number
  recent_puzzle_ids: string[]
  recent_attempts: TrainingAttempt[]
  started_at?: string | null
  active_duration_ms?: number
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

export function trainingSessionSeed(sessionJson: string): number | null {
  try {
    const session = JSON.parse(sessionJson) as Partial<TrainingSession>
    const seed = session.selector?.seed
    return typeof seed === "number" && Number.isSafeInteger(seed) ? seed : null
  } catch {
    return null
  }
}

export function trainingSessionDuration(sessionJson: string): number | null {
  try {
    const session = JSON.parse(sessionJson) as Partial<TrainingSession>
    return typeof session.active_duration_ms === "number" && Number.isFinite(session.active_duration_ms)
      ? Math.max(0, session.active_duration_ms)
      : null
  } catch {
    return null
  }
}

function finiteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
}

export function normalizedTrainingUid(value: unknown): string | null {
  if (typeof value !== "string") return null
  const uid = value.trim().slice(0, 64)
  return uid && uid === value.trim() ? uid : null
}

export function normalizedTrainingHandle(value: unknown): string | null {
  if (typeof value !== "string") return null
  const handle = value.trim()
  return HANDLE_PATTERN.test(handle) ? handle : null
}

const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/

function validMoveList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 64 && value.every((move) => typeof move === "string" && UCI_MOVE.test(move))
}

function validTrainingAttempt(value: unknown): value is TrainingAttempt {
  if (!value || typeof value !== "object") return false
  const attempt = value as Partial<TrainingAttempt>
  return typeof attempt.puzzle_id === "string" && attempt.puzzle_id.length > 0 && attempt.puzzle_id.length <= 64
    && finiteInRange(attempt.puzzle_rating, 0, 5_000)
    && finiteInRange(attempt.puzzle_deviation, 0, 1_000)
    && typeof attempt.solved === "boolean"
    && finiteInRange(attempt.rating_before, 400, 4_000)
    && finiteInRange(attempt.rating_after, 400, 4_000)
    && typeof attempt.played_at === "string" && attempt.played_at.length <= 64
    && (attempt.duration_ms == null || finiteInRange(attempt.duration_ms, 0, 24 * 60 * 60 * 1000))
    && (attempt.outcome == null || attempt.outcome === "solved" || attempt.outcome === "incorrect" || attempt.outcome === "revealed")
    && (attempt.moves == null || validMoveList(attempt.moves))
    && (attempt.experienced_line == null || validMoveList(attempt.experienced_line))
    && (attempt.solution == null || validMoveList(attempt.solution))
    && (attempt.fen == null || (typeof attempt.fen === "string" && attempt.fen.length <= 128))
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
    !finiteInRange(state.deviation, 45, 500) || state.deviation > HUMAN_TRAINING_MAX_SAVE_DEVIATION ||
    !finiteInRange(state.volatility, 0.000001, 0.1) ||
    !Number.isSafeInteger(session.attempts) || session.attempts! < 0 || session.attempts! > 100_000 ||
    !Number.isSafeInteger(session.solved) || session.solved! < 0 || session.solved! > session.attempts! ||
    !Array.isArray(session.recent_puzzle_ids) || session.recent_puzzle_ids.length > 100 ||
    session.recent_puzzle_ids.some((id) => typeof id !== "string" || !id || id.length > 64) ||
    !Array.isArray(session.recent_attempts) || session.recent_attempts.length > 100 ||
    session.recent_attempts.some((attempt) => !validTrainingAttempt(attempt)) ||
    !(session.started_at == null || (typeof session.started_at === "string" && session.started_at.length <= 64)) ||
    !(session.active_duration_ms == null || finiteInRange(session.active_duration_ms, 0, 100_000 * 24 * 60 * 60 * 1000)) ||
    !(session.updated_at == null || typeof session.updated_at === "string") || !validSelector
  ) return null
  return { uid, handle, session: session as TrainingSession }
}
