import type {
  CorpusDoc,
  Env,
  RunFinishDoc,
  RunItemDoc,
  RunStartDoc,
  SuiteDoc,
  TournamentDoc,
} from "./types"

const now = () => new Date().toISOString()

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
  await env.DB.batch([
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
  ])
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

  await env.DB.batch([
    env.DB.prepare(`UPDATE corpus_releases SET active=0, updated_at=? WHERE track=?`).bind(stamp, doc.track),
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
  ])
  await batchChunked(env, items.map(({ id, sequence, item }) => env.DB.prepare(
    `INSERT INTO corpus_items (content_hash, item_id, sequence, payload_json) VALUES (?, ?, ?, ?)`,
  ).bind(doc.content_hash, id, sequence, JSON.stringify(item))))
  return { content_hash: doc.content_hash, items: items.length }
}

export async function startRun(env: Env, doc: RunStartDoc): Promise<{ run_id: string; completed_items: number }> {
  const stamp = doc.created_at ?? now()
  const v = doc.model_variant
  if (doc.suite?.content_hash && SUITE_TRACKS.has(doc.track)) {
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
        suite_hash, suite_visibility, status, total_items, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)
       ON CONFLICT(run_id) DO UPDATE SET
         status=CASE WHEN benchmark_runs_v2.status='completed' THEN 'completed' ELSE 'running' END,
         total_items=excluded.total_items, condition_json=excluded.condition_json,
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
      doc.total_items,
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

interface PuzzleRatingEstimate {
  rating: number
  stderr: number | null
  n: number
  bounded: boolean
}

async function estimatePuzzleRating(env: Env, runId: string): Promise<PuzzleRatingEstimate | null> {
  const { results } = await env.DB.prepare(
    `SELECT item_rating AS rating, solved FROM benchmark_items_v2
      WHERE run_id=? AND item_rating IS NOT NULL`,
  ).bind(runId).all<{ rating: number; solved: number }>()
  const items = results ?? []
  const n = items.length
  if (!n) return null
  const wins = items.reduce((sum, item) => sum + Number(Boolean(item.solved)), 0)
  if (wins === 0) return { rating: 0, stderr: null, n, bounded: false }
  if (wins === n) return { rating: 4000, stderr: null, n, bounded: false }
  const expected = (rating: number, puzzle: number) => 1 / (1 + 10 ** ((puzzle - rating) / 400))
  const gradient = (rating: number) => items.reduce(
    (sum, item) => sum + Number(Boolean(item.solved)) - expected(rating, item.rating), 0,
  )
  let low = 0
  let high = 4000
  for (let i = 0; i < 200 && high - low >= 0.0001; i += 1) {
    const middle = (low + high) / 2
    if (gradient(middle) > 0) low = middle
    else high = middle
  }
  const rating = (low + high) / 2
  const derivative = Math.log(10) / 400
  const information = items.reduce((sum, item) => {
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
      typeof item.payload.rating === "number" ? item.payload.rating : null,
      typeof item.payload.rating_deviation === "number" ? item.payload.rating_deviation : null,
      item.cost_usd ?? 0,
      item.prompt_tokens ?? 0,
      item.completion_tokens ?? 0,
      item.reasoning_tokens ?? 0,
      item.cache_read_tokens ?? 0,
      item.cache_write_tokens ?? 0,
      item.uncached_prompt_tokens ?? 0,
      item.cache_discount_usd ?? 0,
      JSON.stringify(item.payload),
      stamp,
      stamp,
    ),
    refreshAggregate(env, item.run_id, stamp),
    env.DB.prepare(
      `INSERT INTO benchmark_events_v2 (run_id, kind, detail, created_at)
       VALUES (?, 'item_upserted', ?, ?)`,
    ).bind(item.run_id, item.item_id, stamp),
  ])
  return { run_id: item.run_id, item_id: item.item_id }
}

export async function finishRun(
  env: Env,
  doc: RunFinishDoc,
): Promise<{ run_id: string; status: string; completed_items: number; total_items: number }> {
  const row = await env.DB.prepare(
    `SELECT completed_items, total_items FROM benchmark_runs_v2 WHERE run_id=?`,
  ).bind(doc.run_id).first<{ completed_items: number; total_items: number }>()
  if (!row) throw new Error(`unknown run: ${doc.run_id}`)
  const requested = doc.status ?? "completed"
  if (requested === "completed" && row.completed_items !== row.total_items) {
    throw new Error(`cannot complete ${doc.run_id}: ${row.completed_items}/${row.total_items} items present`)
  }
  const stamp = now()
  const estimate = await estimatePuzzleRating(env, doc.run_id)
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE benchmark_runs_v2 SET status=?, error=?, updated_at=?,
       puzzle_rating=?, puzzle_rating_stderr=?, puzzle_rating_n=?, puzzle_rating_bounded=?,
       completed_at=CASE WHEN ?='completed' THEN ? ELSE completed_at END WHERE run_id=?`,
    ).bind(
      requested, doc.error?.slice(0, 2000) ?? null, stamp,
      estimate?.rating ?? null, estimate?.stderr ?? null, estimate?.n ?? 0, estimate?.bounded ? 1 : 0,
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
