import type { Env, RunDoc, RunFinishDoc, RunItemDoc, RunStartDoc, TournamentDoc } from "./types"
import { finishRun, ingestRun, ingestTournament, startRun, upsertRunItem } from "./db"
import { error, json } from "./http"

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Ingestion requires a Bearer token matching the INGEST_TOKEN secret. */
export function authorized(env: Env, req: Request): boolean {
  if (!env.INGEST_TOKEN) return false // ingestion disabled until a token is configured
  const m = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(.+)$/i)
  return !!m && safeEqual(m[1], env.INGEST_TOKEN)
}

/** POST /api/ingest/run — body is a run document from store.py. */
export async function postIngestRun(env: Env, req: Request): Promise<Response> {
  if (!authorized(env, req)) return error(401, "unauthorized")
  const doc = (await req.json().catch(() => null)) as RunDoc | null
  if (!doc || typeof doc.model !== "string" || !doc.condition?.slug || !Array.isArray(doc.items)) {
    return error(400, "invalid run document")
  }
  const res = await ingestRun(env, doc)
  return json({ ok: true, ...res })
}

/** POST /api/ingest/run/start — establish or resume a durable run manifest. */
export async function postStartRun(env: Env, req: Request): Promise<Response> {
  if (!authorized(env, req)) return error(401, "unauthorized")
  const doc = (await req.json().catch(() => null)) as RunStartDoc | null
  if (
    !doc ||
    typeof doc.run_id !== "string" ||
    !doc.model_variant?.key ||
    !doc.condition?.slug ||
    !Number.isInteger(doc.total_items) ||
    doc.total_items < 0
  ) {
    return error(400, "invalid run start document")
  }
  return json({ ok: true, ...(await startRun(env, doc)) })
}

/** POST /api/ingest/run/item — idempotently persist one paid benchmark result. */
export async function postRunItem(env: Env, req: Request): Promise<Response> {
  if (!authorized(env, req)) return error(401, "unauthorized")
  const doc = (await req.json().catch(() => null)) as RunItemDoc | null
  if (
    !doc ||
    typeof doc.run_id !== "string" ||
    typeof doc.item_id !== "string" ||
    !Number.isInteger(doc.sequence) ||
    typeof doc.points !== "number" ||
    !doc.payload
  ) {
    return error(400, "invalid run item document")
  }
  return json({ ok: true, ...(await upsertRunItem(env, doc)) })
}

/** POST /api/ingest/run/finish — complete, pause, or fail an existing run. */
export async function postFinishRun(env: Env, req: Request): Promise<Response> {
  if (!authorized(env, req)) return error(401, "unauthorized")
  const doc = (await req.json().catch(() => null)) as RunFinishDoc | null
  if (!doc || typeof doc.run_id !== "string") return error(400, "run_id is required")
  return json({ ok: true, ...(await finishRun(env, doc)) })
}

/** POST /api/ingest/tournament?id=<stem> — body is a tournament document. */
export async function postIngestTournament(env: Env, req: Request, url: URL): Promise<Response> {
  if (!authorized(env, req)) return error(401, "unauthorized")
  const doc = (await req.json().catch(() => null)) as TournamentDoc | null
  if (!doc || !Array.isArray(doc.standings) || !Array.isArray(doc.games)) {
    return error(400, "invalid tournament document")
  }
  const tid = (url.searchParams.get("id") ?? "").trim().slice(0, 80) || `t_${doc.created ?? "unknown"}`
  const res = await ingestTournament(env, doc, tid)
  return json({ ok: true, ...res })
}
