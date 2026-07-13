import type { Env, RunDoc, TournamentDoc } from "./types"
import { ingestRun, ingestTournament } from "./db"
import { error, json } from "./http"

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Ingestion requires a Bearer token matching the INGEST_TOKEN secret. */
function authorized(env: Env, req: Request): boolean {
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
