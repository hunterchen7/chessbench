import type {
  CorpusDoc,
  Env,
  RunFinishDoc,
  RunItemDoc,
  RunItemPayloadChunkDoc,
  RunStartDoc,
  SuiteDoc,
  TournamentDoc,
} from "./types"
import { authorized } from "./auth"
import {
  finishRun,
  ingestTournament,
  registerCorpus,
  registerSuite,
  startRun,
  upsertRunItem,
  upsertRunItemPayloadChunk,
} from "./db"
import { error, json } from "./http"
import {
  isRunItemPayloadChunks,
  RUN_ITEM_PAYLOAD_CHUNK_BYTES,
} from "./run_item_payloads"

/** Register an immutable browsing corpus independently from model results. */
export async function postRegisterCorpus(env: Env, req: Request): Promise<Response> {
  if (!authorized(env, req)) return error(401, "unauthorized")
  const doc = (await req.json().catch(() => null)) as CorpusDoc | null
  if (
    !doc || doc.schema !== "chessbench.public_corpus.v1" || !doc.name || !doc.content_hash ||
    !["standard", "woodpecker", "esoteric"].includes(doc.track) ||
    !["public", "private"].includes(doc.visibility) || !Array.isArray(doc.items)
  ) {
    return error(400, "invalid corpus document")
  }
  return json({ ok: true, ...(await registerCorpus(env, doc)) })
}

/** Register an exact runnable suite before paid work begins. */
export async function postRegisterSuite(env: Env, req: Request): Promise<Response> {
  if (!authorized(env, req)) return error(401, "unauthorized")
  const doc = (await req.json().catch(() => null)) as SuiteDoc | null
  if (
    !doc || !doc.name || !doc.version || !doc.content_hash ||
    !["public", "private"].includes(doc.visibility) ||
    !["puzzle", "composed"].includes(doc.kind) || !Array.isArray(doc.items)
  ) {
    return error(400, "invalid suite document")
  }
  return json({ ok: true, ...(await registerSuite(env, doc)) })
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
  const inlinePayload = typeof doc?.payload === "object" && doc.payload !== null && !Array.isArray(doc.payload)
  const chunkedPayload = isRunItemPayloadChunks(doc?.payload_chunks)
  if (
    !doc ||
    typeof doc.run_id !== "string" ||
    typeof doc.item_id !== "string" ||
    !Number.isInteger(doc.sequence) ||
    typeof doc.points !== "number" ||
    inlinePayload === chunkedPayload
  ) {
    return error(400, "invalid run item document")
  }
  return json({ ok: true, ...(await upsertRunItem(env, doc)) })
}

/** POST /api/ingest/run/item/chunk — stage one idempotent large-payload chunk. */
export async function postRunItemPayloadChunk(env: Env, req: Request): Promise<Response> {
  if (!authorized(env, req)) return error(401, "unauthorized")
  const doc = (await req.json().catch(() => null)) as RunItemPayloadChunkDoc | null
  const maxBase64Length = 4 * Math.ceil(RUN_ITEM_PAYLOAD_CHUNK_BYTES / 3)
  if (
    !doc ||
    typeof doc.run_id !== "string" || !doc.run_id ||
    typeof doc.item_id !== "string" || !doc.item_id ||
    typeof doc.payload_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(doc.payload_sha256) ||
    !Number.isInteger(doc.chunk_index) || doc.chunk_index < 0 ||
    !Number.isInteger(doc.chunk_count) || doc.chunk_count <= 0 || doc.chunk_count > 10_000 ||
    doc.chunk_index >= doc.chunk_count ||
    typeof doc.payload_chunk !== "string" || !doc.payload_chunk ||
    doc.payload_chunk.length > maxBase64Length || !/^[A-Za-z0-9+/]*={0,2}$/.test(doc.payload_chunk)
  ) {
    return error(400, "invalid run item payload chunk")
  }
  return json({ ok: true, ...(await upsertRunItemPayloadChunk(env, doc)) })
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
