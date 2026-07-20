import type { Env } from "./types"
import { error, json } from "./http"
import {
  HUMAN_TRAINING_MAX_SAVE_DEVIATION,
  normalizedTrainingHandle,
  normalizedTrainingUid,
  parseTrainingSave,
  trainingSessionDuration,
  trainingSessionSeed,
  type TrainingSession,
} from "./human_training_payload"

const SAVE_COOLDOWN_MS = 2 * 60 * 1000
const IP_WINDOW_MS = 10 * 60 * 1000
const IP_SAVES_PER_WINDOW = 10
const MAX_BODY_BYTES = 256 * 1024

interface TrainingProfileRow {
  uid: string
  handle: string
  rating: number
  rating_deviation: number
  volatility: number
  attempts: number
  solved: number
  session_json: string
  created_at: string
  updated_at: string
  last_saved_ms: number
}

interface SaveLimitRow {
  window_start_ms: number
  saves: number
}

function publicProfile(row: TrainingProfileRow, now = Date.now()) {
  return {
    handle: row.handle,
    rating: row.rating,
    rating_deviation: row.rating_deviation,
    volatility: row.volatility,
    attempts: row.attempts,
    solved: row.solved,
    accuracy: row.attempts ? row.solved / row.attempts : 0,
    session: JSON.parse(row.session_json) as TrainingSession,
    created_at: row.created_at,
    updated_at: row.updated_at,
    next_save_at: new Date(Math.max(now, row.last_saved_ms + SAVE_COOLDOWN_MS)).toISOString(),
  }
}

async function hashedRateKey(prefix: string, value: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${prefix}:${value}`)
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
  return `${prefix}:${Array.from(digest.slice(0, 12), (byte) => byte.toString(16).padStart(2, "0")).join("")}`
}

async function consumeLimit(
  env: Env,
  key: string,
  now: number,
  windowMs: number,
  maximum: number,
): Promise<number> {
  const row = await env.DB.prepare(
    `INSERT INTO human_training_save_limits (rate_key, window_start_ms, saves)
     VALUES (?, ?, 1)
     ON CONFLICT(rate_key) DO UPDATE SET
       saves=CASE
         WHEN excluded.window_start_ms-human_training_save_limits.window_start_ms>=? THEN 1
         ELSE human_training_save_limits.saves+1
       END,
       window_start_ms=CASE
         WHEN excluded.window_start_ms-human_training_save_limits.window_start_ms>=? THEN excluded.window_start_ms
         ELSE human_training_save_limits.window_start_ms
       END
     RETURNING window_start_ms, saves`,
  ).bind(key, now, windowMs, windowMs).first<SaveLimitRow>()
  if (!row) throw new Error("save rate limit could not be updated")
  return row.saves > maximum
    ? Math.max(1, Math.ceil((row.window_start_ms + windowMs - now) / 1000))
    : 0
}

/** GET /api/human/training?uid= or ?handle= — one saved browser-training run. */
export async function getHumanTrainingProfile(env: Env, url: URL): Promise<Response> {
  const uid = normalizedTrainingUid(url.searchParams.get("uid"))
  const handle = normalizedTrainingHandle(url.searchParams.get("handle"))
  if (!uid && !handle) return error(400, "uid or handle query param required")
  const row = await env.DB.prepare(
    uid
      ? `SELECT * FROM human_training_profiles WHERE uid=?`
      : `SELECT * FROM human_training_profiles WHERE handle=? COLLATE NOCASE`,
  ).bind(uid ?? handle).first<TrainingProfileRow>()
  return json({ profile: row ? publicProfile(row) : null })
}

/** GET /api/human/training/leaderboard — public saved human ratings. */
export async function getHumanTrainingLeaderboard(env: Env, url: URL): Promise<Response> {
  const uid = normalizedTrainingUid(url.searchParams.get("uid"))
  const { results } = await env.DB.prepare(
    `SELECT uid, handle, rating, rating_deviation, volatility, attempts, solved,
            session_json, created_at, updated_at, last_saved_ms
       FROM human_training_profiles
      WHERE attempts > 0 AND rating_deviation <= ?
      ORDER BY rating DESC, rating_deviation ASC, attempts DESC, handle COLLATE NOCASE ASC
      LIMIT 100`,
  ).bind(HUMAN_TRAINING_MAX_SAVE_DEVIATION).all<TrainingProfileRow>()
  return json({
    leaderboard: (results ?? []).map((row, index) => ({
      rank: index + 1,
      me: uid != null && row.uid === uid,
      handle: row.handle,
      seed: trainingSessionSeed(row.session_json),
      active_duration_ms: trainingSessionDuration(row.session_json),
      rating: row.rating,
      rating_deviation: row.rating_deviation,
      provisional: row.rating_deviation >= 110,
      attempts: row.attempts,
      solved: row.solved,
      accuracy: row.attempts ? row.solved / row.attempts : 0,
      updated_at: row.updated_at,
    })),
  })
}

/** POST /api/human/training — explicitly save one validated local snapshot. */
export async function postHumanTrainingProfile(env: Env, req: Request): Promise<Response> {
  const raw = await req.text()
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return error(413, "training snapshot is too large")
  const value = (() => {
    try { return JSON.parse(raw || "null") as unknown }
    catch { return null }
  })()
  const parsed = parseTrainingSave(value)
  if (!parsed) return error(400, "invalid uid, username, or training session")

  const conflicting = await env.DB.prepare(
    `SELECT uid FROM human_training_profiles WHERE handle=? COLLATE NOCASE`,
  ).bind(parsed.handle).first<{ uid: string }>()
  if (conflicting && conflicting.uid !== parsed.uid) return error(409, "username is already taken")

  const now = Date.now()
  const ip = req.headers.get("CF-Connecting-IP") ?? req.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ?? "unknown"
  const [uidKey, ipKey] = await Promise.all([
    hashedRateKey("uid", parsed.uid),
    hashedRateKey("ip", ip),
  ])
  const uidRetry = await consumeLimit(env, uidKey, now, SAVE_COOLDOWN_MS, 1)
  const ipRetry = uidRetry ? 0 : await consumeLimit(env, ipKey, now, IP_WINDOW_MS, IP_SAVES_PER_WINDOW)
  const retryAfter = Math.max(uidRetry, ipRetry)
  if (retryAfter > 0) {
    return json({ error: "training run could not be saved right now", retry_after_seconds: retryAfter }, {
      status: 429,
      headers: { "Retry-After": String(retryAfter) },
    })
  }

  const sessionJson = JSON.stringify(parsed.session)
  const timestamp = new Date(now).toISOString()
  const state = parsed.session.state
  const save = env.DB.prepare(
    `INSERT INTO human_training_profiles (
       uid, handle, rating, rating_deviation, volatility, attempts, solved,
       session_json, created_at, updated_at, last_saved_ms
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uid) DO UPDATE SET
       handle=excluded.handle,
       rating=excluded.rating,
       rating_deviation=excluded.rating_deviation,
       volatility=excluded.volatility,
       attempts=excluded.attempts,
       solved=excluded.solved,
       session_json=excluded.session_json,
       updated_at=excluded.updated_at,
       last_saved_ms=excluded.last_saved_ms`,
  ).bind(
    parsed.uid, parsed.handle, state.rating, state.deviation, state.volatility,
    parsed.session.attempts, parsed.session.solved, sessionJson, timestamp, timestamp, now,
  )
  try {
    await save.run()
  } catch (reason) {
    if (String(reason).toLowerCase().includes("unique")) return error(409, "username is already taken")
    throw reason
  }

  const stored = await env.DB.prepare(
    `SELECT * FROM human_training_profiles WHERE uid=?`,
  ).bind(parsed.uid).first<TrainingProfileRow>()
  if (!stored) throw new Error("saved training profile could not be reloaded")
  return json({ profile: publicProfile(stored, now) })
}
