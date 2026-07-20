import type {
  CorpusDoc,
  Env,
  RunFinishDoc,
  RunItemDoc,
  RunItemPayloadChunkBatchDoc,
  RunItemPayloadChunkDoc,
  RunStartDoc,
  SuiteDoc,
  TournamentDoc,
} from "./types"
import {
  encodeRunItemPayload,
  isRunItemPayloadChunks,
  reassembleRunItemPayload,
  RUN_ITEM_PAYLOAD_INLINE_BYTES,
  runItemPayloadReferenceJSON,
  type EncodedRunItemPayload,
  type RunItemPayloadChunks,
  type StoredRunItemPayloadChunk,
} from "./run_item_payloads"
import {
  adaptiveRatingSampleCount,
  adaptiveSolverRatingSnapshot,
  type AdaptiveSolverRatingSnapshot,
} from "./adaptive_rating"
import { acceptsRoundedRatedCompletion } from "./run_completion"

const now = () => new Date().toISOString()

export const PUZZLE_RATING_PRIOR = { mean: 1500, sd: 700 } as const
export const PUZZLE_RATING_PROVISIONAL_CI_WIDTH = 400

/** Run D1 statements in transactional chunks (keeps each batch within limits). */
async function batchChunked(env: Env, stmts: D1PreparedStatement[], size = 40): Promise<void> {
  for (let i = 0; i < stmts.length; i += size) await env.DB.batch(stmts.slice(i, i + size))
}

const SUITE_TRACKS = new Set(["puzzle", "woodpecker", "esoteric"])

export async function registerSuite(env: Env, doc: SuiteDoc): Promise<{ content_hash: string; items: number }> {
  const stamp = now()
  const track = doc.track ?? (doc.kind === "composed" ? "esoteric" : "puzzle")
  const idKey = doc.kind === "composed" ? "id" : "id"
  const items = doc.items.map((item, sequence) => {
    const id = String(item[idKey] ?? item.puzzle_id ?? "").trim()
    if (!id) throw new Error(`suite item ${sequence} is missing id`)
    return { id, sequence, item }
  })
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error("duplicate suite item id")

  // A suite name/version is a convenient working label; the content hash is
  // the reproducibility boundary. Permit local iteration under the same label
  // until a run pins the old hash, then require the caller to publish a new
  // version instead of invalidating historical work.
  const previous = await env.DB.prepare(
    `SELECT content_hash FROM benchmark_suites
     WHERE name=? AND version=? AND content_hash<>?`,
  ).bind(doc.name, doc.version, doc.content_hash).first<{ content_hash: string }>()
  if (previous) {
    const referenced = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM benchmark_runs_v2 WHERE suite_hash=?`,
    ).bind(previous.content_hash).first<{ count: number }>()
    if (Number(referenced?.count ?? 0) > 0) {
      throw new Error(
        `suite ${doc.name}@${doc.version} already has benchmark runs; publish a new version`,
      )
    }
  }

  const registration = [
    ...(previous
      ? [
          env.DB.prepare(`DELETE FROM benchmark_suite_items WHERE content_hash=?`).bind(previous.content_hash),
          env.DB.prepare(`DELETE FROM benchmark_suites WHERE content_hash=?`).bind(previous.content_hash),
        ]
      : []),
    env.DB.prepare(
      `INSERT INTO benchmark_suites
       (content_hash, name, version, track, visibility, source, item_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(content_hash) DO UPDATE SET
         name=excluded.name, version=excluded.version, track=excluded.track,
         visibility=excluded.visibility, source=excluded.source,
         item_count=excluded.item_count, updated_at=excluded.updated_at`,
    ).bind(doc.content_hash, doc.name, doc.version, track, doc.visibility, doc.source ?? "", items.length, stamp, stamp),
    env.DB.prepare(`DELETE FROM benchmark_suite_items WHERE content_hash=?`).bind(doc.content_hash),
  ]
  await env.DB.batch(registration)
  await batchChunked(env, items.map(({ id, sequence, item }) => env.DB.prepare(
    `INSERT INTO benchmark_suite_items (content_hash, item_id, sequence, payload_json) VALUES (?, ?, ?, ?)`,
  ).bind(doc.content_hash, id, sequence, JSON.stringify(item))))
  return { content_hash: doc.content_hash, items: items.length }
}

export async function registerCorpus(env: Env, doc: CorpusDoc): Promise<{ content_hash: string; items: number }> {
  const stamp = now()
  const metadata = {
    schema: doc.schema,
    sources: doc.sources ?? [],
    validation: doc.validation ?? {},
  }
  const idKey = doc.track === "esoteric" ? "id" : "puzzle_id"
  const items = doc.items.map((item, sequence) => {
    const id = String(item[idKey] ?? "").trim()
    if (!id) throw new Error(`corpus item ${sequence} is missing ${idKey}`)
    return { id, sequence, item }
  })
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error("duplicate corpus item id")

  // Browsing corpora do not own benchmark results; exact runnable suites do.
  // Replace an unpublished working corpus with the same name while retaining
  // content hashes as the identity of every registered build.
  const previous = await env.DB.prepare(
    `SELECT content_hash FROM corpus_releases WHERE name=? AND content_hash<>?`,
  ).bind(doc.name, doc.content_hash).first<{ content_hash: string }>()
  const registration = [
    env.DB.prepare(`UPDATE corpus_releases SET active=0, updated_at=? WHERE track=?`).bind(stamp, doc.track),
    ...(previous
      ? [
          env.DB.prepare(`DELETE FROM corpus_items WHERE content_hash=?`).bind(previous.content_hash),
          env.DB.prepare(`DELETE FROM corpus_releases WHERE content_hash=?`).bind(previous.content_hash),
        ]
      : []),
    env.DB.prepare(
      `INSERT INTO corpus_releases
       (content_hash, name, title, version, track, visibility, description, item_count,
        metadata_json, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(content_hash) DO UPDATE SET
         name=excluded.name, title=excluded.title, version=excluded.version,
         track=excluded.track, visibility=excluded.visibility, description=excluded.description,
         item_count=excluded.item_count, metadata_json=excluded.metadata_json,
         active=1, updated_at=excluded.updated_at`,
    ).bind(
      doc.content_hash, doc.name, doc.title, doc.version, doc.track, doc.visibility,
      doc.description ?? "", items.length, JSON.stringify(metadata), stamp, stamp,
    ),
    env.DB.prepare(`DELETE FROM corpus_items WHERE content_hash=?`).bind(doc.content_hash),
  ]
  await env.DB.batch(registration)
  await batchChunked(env, items.map(({ id, sequence, item }) => env.DB.prepare(
    `INSERT INTO corpus_items (content_hash, item_id, sequence, payload_json) VALUES (?, ?, ?, ?)`,
  ).bind(doc.content_hash, id, sequence, JSON.stringify(item))))
  return { content_hash: doc.content_hash, items: items.length }
}

export async function startRun(env: Env, doc: RunStartDoc): Promise<{ run_id: string; completed_items: number }> {
  const stamp = doc.created_at ?? now()
  const v = doc.model_variant
  const adaptive = doc.protocol?.kind === "adaptive_glicko2"
  if (doc.suite?.content_hash && SUITE_TRACKS.has(doc.track)) {
    if (adaptive) {
      const pool = await env.DB.prepare(
        `SELECT item_count, active FROM rated_puzzle_pools WHERE content_hash=?`,
      ).bind(doc.suite.content_hash).first<{ item_count: number; active: number }>()
      if (!pool) throw new Error(`rated pool ${doc.suite.content_hash} is not registered`)
      if (!pool.active) throw new Error(`rated pool ${doc.suite.content_hash} is not active`)
      if (pool.item_count < doc.total_items) {
        throw new Error(`rated pool has ${pool.item_count} items, run may need ${doc.total_items}`)
      }
    } else {
      const suite = await env.DB.prepare(
        `SELECT track, item_count FROM benchmark_suites WHERE content_hash=?`,
      ).bind(doc.suite.content_hash).first<{ track: string; item_count: number }>()
      if (!suite) throw new Error(`suite ${doc.suite.content_hash} is not registered`)
      if (suite.track !== doc.track) {
        throw new Error(`suite track ${suite.track} cannot start a ${doc.track} run`)
      }
      if (suite.item_count !== doc.total_items) {
        throw new Error(`suite has ${suite.item_count} items, run declared ${doc.total_items}`)
      }
    }
  }
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO model_variants_v2
       (variant_key, base_model, display_name, provider, provider_model_id, reasoning_json,
        max_output_tokens, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(variant_key) DO UPDATE SET
         display_name=excluded.display_name, provider=excluded.provider,
         provider_model_id=excluded.provider_model_id, reasoning_json=excluded.reasoning_json,
         max_output_tokens=excluded.max_output_tokens, updated_at=excluded.updated_at`,
    ).bind(
      v.key,
      v.base_key,
      v.display_name,
      v.provider,
      v.model_id,
      JSON.stringify(v.reasoning ?? {}),
      v.max_output_tokens,
      stamp,
      now(),
    ),
    env.DB.prepare(
      `INSERT INTO benchmark_runs_v2
       (run_id, track, variant_key, condition_slug, condition_json, suite_name, suite_version,
        suite_hash, suite_visibility, protocol_json, status, total_items, model_moves, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?)
       ON CONFLICT(run_id) DO UPDATE SET
         status=CASE WHEN benchmark_runs_v2.status='completed' THEN 'completed' ELSE 'running' END,
         total_items=excluded.total_items, condition_json=excluded.condition_json,
         protocol_json=excluded.protocol_json, model_moves=excluded.model_moves,
         updated_at=excluded.updated_at, error=NULL`,
    ).bind(
      doc.run_id,
      doc.track,
      v.key,
      doc.condition.slug,
      JSON.stringify(doc.condition),
      doc.suite?.name ?? null,
      doc.suite?.version ?? null,
      doc.suite?.content_hash ?? null,
      doc.suite?.visibility ?? null,
      doc.protocol ? JSON.stringify(doc.protocol) : null,
      doc.total_items,
      doc.model_moves ?? 0,
      stamp,
      now(),
    ),
    env.DB.prepare(
      `INSERT INTO benchmark_events_v2 (run_id, kind, detail, created_at)
       VALUES (?, 'run_started', NULL, ?)`,
    ).bind(doc.run_id, now()),
  ])
  const row = await env.DB.prepare(
    `SELECT completed_items FROM benchmark_runs_v2 WHERE run_id=?`,
  ).bind(doc.run_id).first<{ completed_items: number }>()
  return { run_id: doc.run_id, completed_items: row?.completed_items ?? 0 }
}

const refreshAggregate = (env: Env, runId: string, stamp: string) =>
  env.DB.prepare(
    `UPDATE benchmark_runs_v2 SET
       completed_items=(SELECT COUNT(*) FROM benchmark_items_v2 WHERE run_id=?),
       solved_items=COALESCE((SELECT SUM(solved) FROM benchmark_items_v2 WHERE run_id=?), 0),
       legal_items=COALESCE((SELECT SUM(COALESCE(first_move_legal, 0)) FROM benchmark_items_v2 WHERE run_id=?), 0),
       response_format_items=COALESCE((SELECT COUNT(response_format_valid) FROM benchmark_items_v2 WHERE run_id=?), 0),
       response_format_valid_items=COALESCE((SELECT SUM(COALESCE(response_format_valid, 0)) FROM benchmark_items_v2 WHERE run_id=?), 0),
       points=COALESCE((SELECT SUM(points) FROM benchmark_items_v2 WHERE run_id=?), 0),
       max_points=COALESCE((SELECT SUM(max_points) FROM benchmark_items_v2 WHERE run_id=?), 0),
       cost_usd=COALESCE((SELECT SUM(cost_usd) FROM benchmark_items_v2 WHERE run_id=?), 0),
       prompt_tokens=COALESCE((SELECT SUM(prompt_tokens) FROM benchmark_items_v2 WHERE run_id=?), 0),
       completion_tokens=COALESCE((SELECT SUM(completion_tokens) FROM benchmark_items_v2 WHERE run_id=?), 0),
       reasoning_tokens=COALESCE((SELECT SUM(reasoning_tokens) FROM benchmark_items_v2 WHERE run_id=?), 0),
       cache_read_tokens=COALESCE((SELECT SUM(cache_read_tokens) FROM benchmark_items_v2 WHERE run_id=?), 0),
       cache_write_tokens=COALESCE((SELECT SUM(cache_write_tokens) FROM benchmark_items_v2 WHERE run_id=?), 0),
       uncached_prompt_tokens=COALESCE((SELECT SUM(uncached_prompt_tokens) FROM benchmark_items_v2 WHERE run_id=?), 0),
       cache_discount_usd=COALESCE((SELECT SUM(cache_discount_usd) FROM benchmark_items_v2 WHERE run_id=?), 0),
       updated_at=? WHERE run_id=?`,
  ).bind(
    runId, runId, runId, runId, runId, runId, runId, runId, runId, runId, runId,
    runId, runId, runId, runId, stamp, runId,
  )

const refreshAdaptiveRating = (
  env: Env,
  runId: string,
  sequence: number,
  snapshot: AdaptiveSolverRatingSnapshot,
) => env.DB.prepare(
  `UPDATE benchmark_runs_v2 SET
     puzzle_rating=?, puzzle_rating_stderr=?,
     puzzle_rating_n=?,
     puzzle_rating_bounded=1
   WHERE run_id=?
     AND ?=(SELECT MAX(sequence) FROM benchmark_items_v2 WHERE run_id=?)`,
).bind(
  snapshot.rating,
  snapshot.ratingDeviation,
  adaptiveRatingSampleCount(sequence),
  runId,
  sequence,
  runId,
)

interface PuzzleRatingEstimate {
  rating: number
  stderr: number | null
  n: number
  bounded: boolean
}

async function runItemPayloadChunkRows(
  env: Env,
  runId: string,
  itemId: string,
  descriptor: RunItemPayloadChunks,
): Promise<StoredRunItemPayloadChunk[]> {
  const { results } = await env.DB.prepare(
    `SELECT chunk_index, chunk_count, payload_chunk
       FROM benchmark_item_payload_chunks
      WHERE run_id=? AND item_id=? AND payload_sha256=?
      ORDER BY chunk_index`,
  ).bind(runId, itemId, descriptor.sha256).all<StoredRunItemPayloadChunk>()
  return results ?? []
}

async function persistEncodedRunItemPayload(
  env: Env,
  runId: string,
  itemId: string,
  encoded: EncodedRunItemPayload,
): Promise<void> {
  const stamp = now()
  await batchChunked(env, encoded.chunks.map((chunk, index) => env.DB.prepare(
    `INSERT INTO benchmark_item_payload_chunks
     (run_id, item_id, payload_sha256, chunk_index, chunk_count, payload_chunk, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(run_id, item_id, payload_sha256, chunk_index) DO UPDATE SET
       chunk_count=excluded.chunk_count, payload_chunk=excluded.payload_chunk,
       updated_at=excluded.updated_at`,
  ).bind(
    runId,
    itemId,
    encoded.descriptor.sha256,
    index,
    encoded.descriptor.chunk_count,
    chunk,
    stamp,
    stamp,
  )), 4)
}

export async function upsertRunItemPayloadChunk(
  env: Env,
  chunk: RunItemPayloadChunkDoc,
): Promise<{ run_id: string; item_id: string; chunk_index: number }> {
  const run = await env.DB.prepare(`SELECT run_id FROM benchmark_runs_v2 WHERE run_id=?`)
    .bind(chunk.run_id).first<{ run_id: string }>()
  if (!run) throw new Error(`unknown run: ${chunk.run_id}`)
  const stamp = now()
  await env.DB.prepare(
    `INSERT INTO benchmark_item_payload_chunks
     (run_id, item_id, payload_sha256, chunk_index, chunk_count, payload_chunk, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(run_id, item_id, payload_sha256, chunk_index) DO UPDATE SET
       chunk_count=excluded.chunk_count, payload_chunk=excluded.payload_chunk,
       updated_at=excluded.updated_at`,
  ).bind(
    chunk.run_id,
    chunk.item_id,
    chunk.payload_sha256,
    chunk.chunk_index,
    chunk.chunk_count,
    chunk.payload_chunk,
    stamp,
    stamp,
  ).run()
  return { run_id: chunk.run_id, item_id: chunk.item_id, chunk_index: chunk.chunk_index }
}

export async function upsertRunItemPayloadChunks(
  env: Env,
  batch: RunItemPayloadChunkBatchDoc,
): Promise<{ run_id: string; item_id: string; chunks: number }> {
  const run = await env.DB.prepare(`SELECT run_id FROM benchmark_runs_v2 WHERE run_id=?`)
    .bind(batch.run_id).first<{ run_id: string }>()
  if (!run) throw new Error(`unknown run: ${batch.run_id}`)
  const stamp = now()
  await batchChunked(env, batch.chunks.map((chunk) => env.DB.prepare(
    `INSERT INTO benchmark_item_payload_chunks
     (run_id, item_id, payload_sha256, chunk_index, chunk_count, payload_chunk, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(run_id, item_id, payload_sha256, chunk_index) DO UPDATE SET
       chunk_count=excluded.chunk_count, payload_chunk=excluded.payload_chunk,
       updated_at=excluded.updated_at`,
  ).bind(
    batch.run_id,
    batch.item_id,
    batch.payload_sha256,
    chunk.chunk_index,
    batch.chunk_count,
    chunk.payload_chunk,
    stamp,
    stamp,
  )), 4)
  return { run_id: batch.run_id, item_id: batch.item_id, chunks: batch.chunks.length }
}

interface ResolvedRunItemPayload {
  payload: Record<string, unknown>
  payloadJSON: string
  descriptor: RunItemPayloadChunks | null
}

async function resolveRunItemPayload(env: Env, item: RunItemDoc): Promise<ResolvedRunItemPayload> {
  if (isRunItemPayloadChunks(item.payload_chunks)) {
    const rows = await runItemPayloadChunkRows(env, item.run_id, item.item_id, item.payload_chunks)
    const payload = await reassembleRunItemPayload(item.payload_chunks, rows)
    return {
      payload,
      payloadJSON: runItemPayloadReferenceJSON(item.payload_chunks),
      descriptor: item.payload_chunks,
    }
  }
  if (!item.payload) throw new Error("run item payload is required")
  const payloadJSON = JSON.stringify(item.payload)
  if (new TextEncoder().encode(payloadJSON).length <= RUN_ITEM_PAYLOAD_INLINE_BYTES) {
    return { payload: item.payload, payloadJSON, descriptor: null }
  }

  // Backward compatibility: an older client may still POST a large inline
  // payload. Stage its chunks before publishing the small reference row.
  const encoded = await encodeRunItemPayload(item.payload)
  await persistEncodedRunItemPayload(env, item.run_id, item.item_id, encoded)
  return {
    payload: item.payload,
    payloadJSON: runItemPayloadReferenceJSON(encoded.descriptor),
    descriptor: encoded.descriptor,
  }
}

async function estimatePuzzleRating(env: Env, runId: string): Promise<PuzzleRatingEstimate | null> {
  const { results } = await env.DB.prepare(
    `SELECT item_rating AS rating, solved FROM benchmark_items_v2
      WHERE run_id=? AND item_rating IS NOT NULL`,
  ).bind(runId).all<{ rating: number; solved: number }>()
  const items = results ?? []
  const n = items.length
  if (!n) return null
  const expected = (rating: number, puzzle: number) => 1 / (1 + 10 ** ((puzzle - rating) / 400))
  const derivative = Math.log(10) / 400
  const priorPrecision = 1 / PUZZLE_RATING_PRIOR.sd ** 2
  const gradient = (rating: number) =>
    -(rating - PUZZLE_RATING_PRIOR.mean) * priorPrecision + derivative * items.reduce(
      (sum, item) => sum + Number(Boolean(item.solved)) - expected(rating, item.rating), 0,
    )
  let low = PUZZLE_RATING_PRIOR.mean - 10 * PUZZLE_RATING_PRIOR.sd
  let high = PUZZLE_RATING_PRIOR.mean + 10 * PUZZLE_RATING_PRIOR.sd
  for (let i = 0; i < 200 && high - low >= 0.0001; i += 1) {
    const middle = (low + high) / 2
    if (gradient(middle) > 0) low = middle
    else high = middle
  }
  const rating = (low + high) / 2
  const information = priorPrecision + items.reduce((sum, item) => {
    const score = expected(rating, item.rating)
    return sum + derivative ** 2 * score * (1 - score)
  }, 0)
  return { rating, stderr: information > 0 ? 1 / Math.sqrt(information) : null, n, bounded: true }
}

export async function upsertRunItem(env: Env, item: RunItemDoc): Promise<{ run_id: string; item_id: string }> {
  const stamp = now()
  const run = await env.DB.prepare(`SELECT run_id FROM benchmark_runs_v2 WHERE run_id=?`)
    .bind(item.run_id).first<{ run_id: string }>()
  if (!run) throw new Error(`unknown run: ${item.run_id}`)
  const resolvedPayload = await resolveRunItemPayload(env, item)
  const payload = resolvedPayload.payload
  const adaptiveRating = adaptiveSolverRatingSnapshot(payload)
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO benchmark_items_v2
       (run_id, item_id, sequence, points, max_points, solved, first_move_legal, response_format_valid,
        failure_reason, latency_ms, item_rating, item_rating_deviation, cost_usd, prompt_tokens, completion_tokens,
        reasoning_tokens, cache_read_tokens, cache_write_tokens, uncached_prompt_tokens,
        cache_discount_usd, payload_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(run_id, item_id) DO UPDATE SET
         sequence=excluded.sequence, points=excluded.points, max_points=excluded.max_points,
         solved=excluded.solved, first_move_legal=excluded.first_move_legal,
         response_format_valid=excluded.response_format_valid,
         failure_reason=excluded.failure_reason, latency_ms=excluded.latency_ms,
         item_rating=excluded.item_rating, item_rating_deviation=excluded.item_rating_deviation,
         cost_usd=excluded.cost_usd, prompt_tokens=excluded.prompt_tokens,
         completion_tokens=excluded.completion_tokens, reasoning_tokens=excluded.reasoning_tokens,
         cache_read_tokens=excluded.cache_read_tokens, cache_write_tokens=excluded.cache_write_tokens,
         uncached_prompt_tokens=excluded.uncached_prompt_tokens,
         cache_discount_usd=excluded.cache_discount_usd,
         payload_json=excluded.payload_json, updated_at=excluded.updated_at`,
    ).bind(
      item.run_id,
      item.item_id,
      item.sequence,
      item.points,
      item.max_points ?? 1,
      item.solved ? 1 : 0,
      item.first_move_legal == null ? null : item.first_move_legal ? 1 : 0,
      item.response_format_valid == null ? null : item.response_format_valid ? 1 : 0,
      item.failure_reason ?? null,
      item.latency_ms ?? null,
      typeof payload.rating === "number" ? payload.rating : null,
      typeof payload.rating_deviation === "number" ? payload.rating_deviation : null,
      item.cost_usd ?? 0,
      item.prompt_tokens ?? 0,
      item.completion_tokens ?? 0,
      item.reasoning_tokens ?? 0,
      item.cache_read_tokens ?? 0,
      item.cache_write_tokens ?? 0,
      item.uncached_prompt_tokens ?? 0,
      item.cache_discount_usd ?? 0,
      resolvedPayload.payloadJSON,
      stamp,
      stamp,
    ),
    refreshAggregate(env, item.run_id, stamp),
    ...(adaptiveRating
      ? [refreshAdaptiveRating(env, item.run_id, item.sequence, adaptiveRating)]
      : []),
    env.DB.prepare(
      `INSERT INTO benchmark_events_v2 (run_id, kind, detail, created_at)
       VALUES (?, 'item_upserted', ?, ?)`,
    ).bind(item.run_id, item.item_id, stamp),
  ])
  if (resolvedPayload.descriptor) {
    await env.DB.prepare(
      `DELETE FROM benchmark_item_payload_chunks
        WHERE run_id=? AND item_id=? AND payload_sha256<>?`,
    ).bind(item.run_id, item.item_id, resolvedPayload.descriptor.sha256).run()
  } else {
    await env.DB.prepare(
      `DELETE FROM benchmark_item_payload_chunks WHERE run_id=? AND item_id=?`,
    ).bind(item.run_id, item.item_id).run()
  }
  return { run_id: item.run_id, item_id: item.item_id }
}

export async function finishRun(
  env: Env,
  doc: RunFinishDoc,
): Promise<{ run_id: string; status: string; completed_items: number; total_items: number }> {
  const row = await env.DB.prepare(
    `SELECT completed_items, total_items, protocol_json,
            puzzle_rating, puzzle_rating_stderr, puzzle_rating_n, puzzle_rating_bounded
       FROM benchmark_runs_v2 WHERE run_id=?`,
  ).bind(doc.run_id).first<{
    completed_items: number
    total_items: number
    protocol_json: string | null
    puzzle_rating: number | null
    puzzle_rating_stderr: number | null
    puzzle_rating_n: number
    puzzle_rating_bounded: number
  }>()
  if (!row) throw new Error(`unknown run: ${doc.run_id}`)
  const requested = doc.status ?? "completed"
  const termination = doc.summary?.termination as Record<string, unknown> | undefined
  const stoppedByPolicy =
    requested === "completed" &&
    termination?.kind === "consecutive_unsolved" &&
    Number(termination.threshold) > 0 &&
    Number(termination.attempted) === row.completed_items &&
    Number(termination.unattempted) === row.total_items - row.completed_items
  const protocol = row.protocol_json ? JSON.parse(row.protocol_json) as Record<string, unknown> : null
  const stopping = protocol?.stopping as Record<string, unknown> | undefined
  const suppliedRating = doc.summary?.puzzle_performance_rating as Record<string, unknown> | undefined
  const finalDeviation = Number(suppliedRating?.rating_deviation ?? suppliedRating?.stderr)
  const targetDeviation = Number(stopping?.target_rating_deviation ?? -Infinity)
  const settledRating =
    requested === "completed" &&
    protocol?.kind === "adaptive_glicko2" &&
    termination?.kind === "rating_settled" &&
    Number(termination.attempted) === row.completed_items &&
    row.completed_items >= Number(stopping?.minimum_puzzles ?? Infinity) &&
    finalDeviation <= targetDeviation &&
    suppliedRating?.settled === true &&
    row.completed_items < row.total_items
  const roundedRating = acceptsRoundedRatedCompletion({
    requested,
    protocolKind: protocol?.kind,
    termination,
    suppliedRating,
    completedItems: row.completed_items,
    totalItems: row.total_items,
    minimumPuzzles: Number(stopping?.minimum_puzzles ?? Infinity),
    targetDeviation,
    finalDeviation,
  })
  if (
    requested === "completed" &&
    row.completed_items !== row.total_items &&
    !stoppedByPolicy &&
    !settledRating &&
    !roundedRating
  ) {
    throw new Error(`cannot complete ${doc.run_id}: ${row.completed_items}/${row.total_items} items present`)
  }
  const stamp = now()
  const adaptive = protocol?.kind === "adaptive_glicko2"
  const estimate = adaptive ? null : await estimatePuzzleRating(env, doc.run_id)
  const rating = adaptive && typeof suppliedRating?.rating === "number"
    ? {
        rating: suppliedRating.rating,
        stderr: typeof suppliedRating.rating_deviation === "number"
          ? suppliedRating.rating_deviation
          : typeof suppliedRating.stderr === "number" ? suppliedRating.stderr : null,
        n: typeof suppliedRating.n === "number" ? suppliedRating.n : row.completed_items,
        bounded: suppliedRating.bounded !== false,
      }
    : adaptive && row.puzzle_rating != null
      ? {
          rating: row.puzzle_rating,
          stderr: row.puzzle_rating_stderr,
          n: row.puzzle_rating_n || row.completed_items,
          bounded: Boolean(row.puzzle_rating_bounded),
        }
      : estimate
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE benchmark_runs_v2 SET status=?, error=?, updated_at=?,
       max_points=CASE WHEN ? THEN total_items ELSE max_points END,
       puzzle_rating=?, puzzle_rating_stderr=?, puzzle_rating_n=?, puzzle_rating_bounded=?,
       summary_json=?,
       completed_at=CASE WHEN ?='completed' THEN ? ELSE completed_at END WHERE run_id=?`,
    ).bind(
      requested, doc.error?.slice(0, 2000) ?? null, stamp,
      stoppedByPolicy ? 1 : 0,
      rating?.rating ?? null, rating?.stderr ?? null, rating?.n ?? 0, rating?.bounded ? 1 : 0,
      doc.summary ? JSON.stringify(doc.summary) : null,
      requested, stamp, doc.run_id,
    ),
    env.DB.prepare(
      `INSERT INTO benchmark_events_v2 (run_id, kind, detail, created_at) VALUES (?, ?, ?, ?)`,
    ).bind(doc.run_id, `run_${requested}`, doc.error?.slice(0, 500) ?? null, stamp),
  ])
  return { run_id: doc.run_id, status: requested, ...row }
}

export async function ingestTournament(env: Env, doc: TournamentDoc, tid: string): Promise<{ tid: string }> {
  const slug = doc.condition?.slug ?? "unknown"
  const standings = doc.standings ?? []
  const first = standings[0]
  const second = standings[1]
  const tied =
    typeof first?.score === "number" &&
    typeof second?.score === "number" &&
    first.score === second.score
  const winner = first && !tied ? first.label : null
  await env.DB.prepare(
    `INSERT INTO tournaments (tid, created, condition_slug, n_players, n_games, winner, doc_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tid) DO UPDATE SET
       created=excluded.created, condition_slug=excluded.condition_slug, n_players=excluded.n_players,
       n_games=excluded.n_games, winner=excluded.winner, doc_json=excluded.doc_json`,
  ).bind(
    tid,
    doc.created ?? null,
    slug,
    standings.length,
    (doc.games ?? []).length,
    winner,
    JSON.stringify(doc),
  ).run()
  return { tid }
}
