const STORAGE_KEY = "chessbench.human-training.v1"

export const GLICKO_SCALE = 173.7178
export const GLICKO_TAU = 0.75
export const PROVISIONAL_DEVIATION = 110
export const SETTLED_DEVIATION = 75
export const SETTLED_ATTEMPTS = 50
export const TRAINING_RATING_RADIUS = 100
export const TRAINING_RECENT_LIMIT = 100
export const TRAINING_SELECTOR_VERSION = "deterministic_rating_band_v1"

const MIN_RATING = 400
const MAX_RATING = 4000
const MIN_DEVIATION = 45
const MAX_DEVIATION = 500
const MAX_VOLATILITY = 0.1

export interface HumanGlickoState {
  rating: number
  deviation: number
  volatility: number
}

export interface HumanTrainingAttempt {
  puzzle_id: string
  puzzle_rating: number
  puzzle_deviation: number
  solved: boolean
  rating_before: number
  rating_after: number
  played_at: string
  outcome?: "solved" | "incorrect" | "revealed"
  moves?: string[]
  experienced_line?: string[]
  solution?: string[]
  fen?: string
}

export interface HumanTrainingSession {
  version: 1
  state: HumanGlickoState
  attempts: number
  solved: number
  recent_puzzle_ids: string[]
  recent_attempts: HumanTrainingAttempt[]
  updated_at: string | null
  selector: HumanTrainingSelector | null
}

export interface HumanTrainingSelector {
  version: typeof TRAINING_SELECTOR_VERSION
  seed: number
  target_radius: number
  pool_hash: string | null
  next_sequence: number
}

export interface HumanTrainingResult {
  before: HumanGlickoState
  after: HumanGlickoState
  session: HumanTrainingSession
  solved: boolean
  duplicate: boolean
}

export const INITIAL_HUMAN_GLICKO_STATE: HumanGlickoState = {
  rating: 1500,
  deviation: 500,
  volatility: 0.09,
}

function initialSession(): HumanTrainingSession {
  return {
    version: 1,
    state: { ...INITIAL_HUMAN_GLICKO_STATE },
    attempts: 0,
    solved: 0,
    recent_puzzle_ids: [],
    recent_attempts: [],
    updated_at: null,
    selector: null,
  }
}

function finite(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function normalizeSession(value: unknown): HumanTrainingSession {
  if (!value || typeof value !== "object") return initialSession()
  const raw = value as Partial<HumanTrainingSession>
  const rawState = raw.state && typeof raw.state === "object" ? raw.state : INITIAL_HUMAN_GLICKO_STATE
  const state = {
    rating: Math.min(MAX_RATING, Math.max(MIN_RATING, finite(rawState.rating, 1500))),
    deviation: Math.min(MAX_DEVIATION, Math.max(MIN_DEVIATION, finite(rawState.deviation, 500))),
    volatility: Math.min(MAX_VOLATILITY, Math.max(0.000001, finite(rawState.volatility, 0.09))),
  }
  const attempts = Math.max(0, Math.floor(finite(raw.attempts, 0)))
  const solved = Math.min(attempts, Math.max(0, Math.floor(finite(raw.solved, 0))))
  const recentPuzzleIds = Array.isArray(raw.recent_puzzle_ids)
    ? raw.recent_puzzle_ids.map(String).filter(Boolean).slice(-TRAINING_RECENT_LIMIT)
    : []
  const recentAttempts = Array.isArray(raw.recent_attempts)
    ? raw.recent_attempts.filter((attempt): attempt is HumanTrainingAttempt => (
      Boolean(attempt) && typeof attempt === "object" && typeof attempt.puzzle_id === "string"
    )).slice(-TRAINING_RECENT_LIMIT)
    : []
  const rawSelector = raw.selector && typeof raw.selector === "object" ? raw.selector : null
  const selector = rawSelector &&
    rawSelector.version === TRAINING_SELECTOR_VERSION &&
    Number.isSafeInteger(rawSelector.seed) &&
    Number.isSafeInteger(rawSelector.target_radius) &&
    rawSelector.target_radius >= 0 && rawSelector.target_radius <= 2000 &&
    Number.isSafeInteger(rawSelector.next_sequence) && rawSelector.next_sequence >= 0 &&
    (rawSelector.pool_hash == null || typeof rawSelector.pool_hash === "string")
    ? {
      version: TRAINING_SELECTOR_VERSION,
      seed: rawSelector.seed,
      target_radius: rawSelector.target_radius,
      pool_hash: rawSelector.pool_hash,
      next_sequence: rawSelector.next_sequence,
    } satisfies HumanTrainingSelector
    : null
  return {
    version: 1,
    state,
    attempts,
    solved,
    recent_puzzle_ids: recentPuzzleIds,
    recent_attempts: recentAttempts,
    updated_at: typeof raw.updated_at === "string" ? raw.updated_at : null,
    selector,
  }
}

export function humanTrainingSession(): HumanTrainingSession {
  try {
    return normalizeSession(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"))
  } catch {
    return initialSession()
  }
}

function persist(session: HumanTrainingSession): HumanTrainingSession {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  } catch {
    // Training remains usable when storage is blocked; only persistence is lost.
  }
  return session
}

export function restoreHumanTrainingSession(value: unknown): HumanTrainingSession {
  return persist(normalizeSession(value))
}

export function startHumanTrainingSession(
  seed: number,
  poolHash: string | null = null,
  targetRadius = TRAINING_RATING_RADIUS,
): HumanTrainingSession {
  if (!Number.isSafeInteger(seed)) throw new Error("Seed must be a whole safe integer.")
  return persist({
    ...initialSession(),
    selector: {
      version: TRAINING_SELECTOR_VERSION,
      seed,
      target_radius: targetRadius,
      pool_hash: poolHash,
      next_sequence: 0,
    },
  })
}

export function humanTrainingSelected(input: {
  puzzleId: string
  poolHash: string
  seed: number
  sequence: number
  targetRadius: number
}): HumanTrainingSession {
  const current = humanTrainingSession()
  const selector = current.selector
  if (
    !selector || selector.seed !== input.seed || selector.target_radius !== input.targetRadius ||
    (selector.pool_hash != null && selector.pool_hash !== input.poolHash) ||
    selector.next_sequence !== input.sequence
  ) throw new Error("Training selector state changed before the puzzle was selected.")
  return persist(withRecentPuzzle({
    ...current,
    selector: {
      ...selector,
      pool_hash: input.poolHash,
      next_sequence: input.sequence + 1,
    },
  }, input.puzzleId))
}

function withRecentPuzzle(session: HumanTrainingSession, puzzleId: string): HumanTrainingSession {
  const recent = session.recent_puzzle_ids.filter((id) => id !== puzzleId)
  recent.push(puzzleId)
  return { ...session, recent_puzzle_ids: recent.slice(-TRAINING_RECENT_LIMIT) }
}

function volatility(
  phi: number,
  sigma: number,
  variance: number,
  delta: number,
  tau: number,
): number {
  const a = Math.log(sigma * sigma)
  const f = (value: number) => {
    const exp = Math.exp(value)
    const numerator = exp * (delta * delta - phi * phi - variance - exp)
    const denominator = 2 * (phi * phi + variance + exp) ** 2
    return numerator / denominator - (value - a) / (tau * tau)
  }

  let lower = a
  let upper: number
  if (delta * delta > phi * phi + variance) {
    upper = Math.log(delta * delta - phi * phi - variance)
  } else {
    let k = 1
    upper = a - k * Math.abs(tau)
    while (f(upper) < 0) {
      k += 1
      upper = a - k * Math.abs(tau)
    }
  }

  let lowerValue = f(lower)
  let upperValue = f(upper)
  for (let iteration = 0; iteration < 1000; iteration += 1) {
    if (Math.abs(upper - lower) <= 0.000001) return Math.exp(lower / 2)
    const candidate = lower + (lower - upper) * lowerValue / (upperValue - lowerValue)
    const candidateValue = f(candidate)
    if (candidateValue * upperValue <= 0) {
      lower = upper
      lowerValue = upperValue
    } else {
      lowerValue /= 2
    }
    upper = candidate
    upperValue = candidateValue
  }
  throw new Error("Glicko-2 volatility failed to converge")
}

/** Exact browser port of chessbench.rated_sessions.update_solver_rating. */
export function updateHumanGlicko(
  state: HumanGlickoState,
  puzzleRating: number,
  puzzleDeviation: number,
  solved: boolean,
  tau = GLICKO_TAU,
): HumanGlickoState {
  const mu = (state.rating - 1500) / GLICKO_SCALE
  const phi = state.deviation / GLICKO_SCALE
  const opponentMu = (puzzleRating - 1500) / GLICKO_SCALE
  const opponentPhi = Math.max(MIN_DEVIATION, puzzleDeviation) / GLICKO_SCALE
  const impact = 1 / Math.sqrt(1 + 3 * opponentPhi * opponentPhi / Math.PI ** 2)
  const expected = 1 / (1 + Math.exp(-impact * (mu - opponentMu)))
  const variance = 1 / (impact * impact * expected * (1 - expected))
  const score = solved ? 1 : 0
  const delta = variance * impact * (score - expected)
  const sigma = volatility(phi, state.volatility, variance, delta, tau)
  const phiStar = Math.sqrt(phi * phi + sigma * sigma)
  const nextPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / variance)
  const nextMu = mu + nextPhi * nextPhi * impact * (score - expected)
  const computed = {
    rating: Math.min(MAX_RATING, Math.max(MIN_RATING, 1500 + GLICKO_SCALE * nextMu)),
    deviation: Math.min(MAX_DEVIATION, Math.max(MIN_DEVIATION, GLICKO_SCALE * nextPhi)),
    volatility: Math.min(MAX_VOLATILITY, sigma),
  }

  if (puzzleDeviation < PROVISIONAL_DEVIATION) return computed
  const weight = solved ? 0.8 : 0.3
  return {
    rating: state.rating * (1 - weight) + computed.rating * weight,
    deviation: state.deviation * (1 - weight) + computed.deviation * weight,
    volatility: state.volatility * (1 - weight) + computed.volatility * weight,
  }
}

export function humanTrainingRecord(
  puzzleId: string,
  puzzleRating: number,
  puzzleDeviation: number,
  solved: boolean,
  detail?: Pick<HumanTrainingAttempt, "outcome" | "moves" | "experienced_line" | "solution" | "fen">,
): HumanTrainingResult {
  const current = humanTrainingSession()
  const duplicateAttempt = current.recent_attempts.find((attempt) => attempt.puzzle_id === puzzleId)
  if (duplicateAttempt) {
    return { before: current.state, after: current.state, session: current, solved: duplicateAttempt.solved, duplicate: true }
  }

  const before = current.state
  const after = updateHumanGlicko(before, puzzleRating, puzzleDeviation, solved)
  const now = new Date().toISOString()
  const attempt: HumanTrainingAttempt = {
    puzzle_id: puzzleId,
    puzzle_rating: puzzleRating,
    puzzle_deviation: puzzleDeviation,
    solved,
    rating_before: before.rating,
    rating_after: after.rating,
    played_at: now,
    outcome: detail?.outcome ?? (solved ? "solved" : "incorrect"),
    moves: detail?.moves?.slice(0, 64),
    experienced_line: detail?.experienced_line?.slice(0, 64),
    solution: detail?.solution?.slice(0, 64),
    fen: detail?.fen,
  }
  const session = withRecentPuzzle({
    ...current,
    state: after,
    attempts: current.attempts + 1,
    solved: current.solved + Number(solved),
    recent_attempts: [...current.recent_attempts, attempt].slice(-TRAINING_RECENT_LIMIT),
    updated_at: now,
  }, puzzleId)
  return { before, after, session: persist(session), solved, duplicate: false }
}

/** Legacy helper for imported sessions; seeded play rates reveals as benchmark losses. */
export function humanTrainingSkip(puzzleId: string): HumanTrainingSession {
  return persist(withRecentPuzzle(humanTrainingSession(), puzzleId))
}

export function humanTrainingSettled(session: HumanTrainingSession): boolean {
  return session.attempts >= SETTLED_ATTEMPTS && session.state.deviation <= SETTLED_DEVIATION
}

export function humanTrainingInterval(state: HumanGlickoState): [number, number] {
  return [state.rating - 2 * state.deviation, state.rating + 2 * state.deviation]
}
