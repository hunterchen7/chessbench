import type {
  Env,
  ModelVariantDoc,
  RunDoc,
  RunFinishDoc,
  RunItemDoc,
  RunStartDoc,
  TournamentDoc,
} from "./types"

const now = () => new Date().toISOString()

/** Run D1 statements in transactional chunks (keeps each batch within limits). */
async function batchChunked(env: Env, stmts: D1PreparedStatement[], size = 40): Promise<void> {
  for (let i = 0; i < stmts.length; i += size) await env.DB.batch(stmts.slice(i, i + size))
}

export function runId(doc: RunDoc): string {
  if (doc.run_id) return doc.run_id
  const variant = doc.model_variant?.key ?? doc.model
  return `${variant}__${doc.condition?.slug ?? "unknown"}__${doc.suite?.name ?? "nosuite"}`
}

function legacyVariant(doc: RunDoc): ModelVariantDoc {
  return doc.model_variant ?? {
    key: `${doc.model.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}--legacy`,
    base_key: doc.model,
    display_name: doc.model.includes("/") ? doc.model.split("/").at(-1)! : doc.model,
    provider: doc.provider ?? "unknown",
    model_id: doc.model,
    reasoning: {
      effort: typeof doc.condition?.reasoning_effort === "string" ? doc.condition.reasoning_effort : null,
      max_tokens:
        typeof doc.condition?.reasoning_max_tokens === "number" ? doc.condition.reasoning_max_tokens : null,
      exclude: true,
    },
    max_output_tokens:
      typeof doc.condition?.max_output_tokens === "number" ? doc.condition.max_output_tokens : 2048,
  }
}

export async function startRun(env: Env, doc: RunStartDoc): Promise<{ run_id: string; completed_items: number }> {
  const stamp = doc.created_at ?? now()
  const v = doc.model_variant
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
       updated_at=? WHERE run_id=?`,
  ).bind(runId, runId, runId, runId, runId, runId, runId, runId, runId, runId, runId, stamp, runId)

export async function upsertRunItem(env: Env, item: RunItemDoc): Promise<{ run_id: string; item_id: string }> {
  const stamp = now()
  const run = await env.DB.prepare(`SELECT run_id FROM benchmark_runs_v2 WHERE run_id=?`)
    .bind(item.run_id).first<{ run_id: string }>()
  if (!run) throw new Error(`unknown run: ${item.run_id}`)
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO benchmark_items_v2
       (run_id, item_id, sequence, points, max_points, solved, first_move_legal, response_format_valid,
        failure_reason, latency_ms, cost_usd, prompt_tokens, completion_tokens,
        reasoning_tokens, payload_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(run_id, item_id) DO UPDATE SET
         sequence=excluded.sequence, points=excluded.points, max_points=excluded.max_points,
         solved=excluded.solved, first_move_legal=excluded.first_move_legal,
         response_format_valid=excluded.response_format_valid,
         failure_reason=excluded.failure_reason, latency_ms=excluded.latency_ms,
         cost_usd=excluded.cost_usd, prompt_tokens=excluded.prompt_tokens,
         completion_tokens=excluded.completion_tokens, reasoning_tokens=excluded.reasoning_tokens,
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
      item.cost_usd ?? 0,
      item.prompt_tokens ?? 0,
      item.completion_tokens ?? 0,
      item.reasoning_tokens ?? 0,
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
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE benchmark_runs_v2 SET status=?, error=?, updated_at=?,
       completed_at=CASE WHEN ?='completed' THEN ? ELSE completed_at END WHERE run_id=?`,
    ).bind(requested, doc.error?.slice(0, 2000) ?? null, stamp, requested, stamp, doc.run_id),
    env.DB.prepare(
      `INSERT INTO benchmark_events_v2 (run_id, kind, detail, created_at) VALUES (?, ?, ?, ?)`,
    ).bind(doc.run_id, `run_${requested}`, doc.error?.slice(0, 500) ?? null, stamp),
  ])
  return { run_id: doc.run_id, status: requested, ...row }
}

/** Compatibility ingest for a completed v1/v2 run JSON export. */
export async function ingestRun(env: Env, doc: RunDoc): Promise<{ run_id: string; items: number }> {
  const id = runId(doc)
  const variant = legacyVariant(doc)
  const track = doc.kind === "woodpecker" ? "woodpecker" : "puzzle"
  await startRun(env, {
    run_id: id,
    track,
    model_variant: variant,
    condition: doc.condition,
    suite: doc.suite
      ? {
          name: doc.suite.name,
          version: (doc.suite as Record<string, unknown>).version as string | undefined,
          content_hash: (doc.suite as Record<string, unknown>).content_hash as string | undefined,
          visibility: (doc.suite as Record<string, unknown>).visibility as string | undefined,
        }
      : null,
    total_items: doc.items.length,
    created_at: doc.created,
  })

  const slug = doc.condition?.slug ?? "unknown"
  const legacy: D1PreparedStatement[] = []
  for (const [sequence, it] of doc.items.entries()) {
    await upsertRunItem(env, {
      run_id: id,
      item_id: it.puzzle_id,
      sequence,
      points: it.score ?? (it.solved ? 1 : 0),
      max_points: 1,
      solved: it.solved,
      first_move_legal: it.first_move_legal,
      response_format_valid: it.answer_response_format_valid,
      failure_reason: it.failure_reason,
      payload: it as unknown as Record<string, unknown>,
    })
    if (it.fen) {
      legacy.push(
        env.DB.prepare(
          `INSERT INTO puzzles
           (puzzle_id, rating, fen, setup_san, solver_is_white, solution_json, solution_first,
            themes_json, categories_json, game_url)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(puzzle_id) DO UPDATE SET
             rating=excluded.rating, fen=excluded.fen, setup_san=excluded.setup_san,
             solver_is_white=excluded.solver_is_white, solution_json=excluded.solution_json,
             solution_first=excluded.solution_first, themes_json=excluded.themes_json,
             categories_json=excluded.categories_json, game_url=excluded.game_url`,
        ).bind(
          it.puzzle_id,
          it.rating ?? null,
          it.fen,
          it.setup_san ?? null,
          it.solver_is_white ? 1 : 0,
          JSON.stringify(it.solution ?? []),
          it.solution_first ?? null,
          JSON.stringify(it.themes ?? []),
          JSON.stringify(it.categories ?? {}),
          it.game_url ?? null,
        ),
      )
    }
    legacy.push(
      env.DB.prepare(
        `INSERT INTO run_answers
         (run_id, puzzle_id, model, condition_slug, solved, score, first_move_legal,
          failure_reason, answer_move, answer_explanation, seq_elo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(run_id, puzzle_id) DO UPDATE SET
           model=excluded.model, condition_slug=excluded.condition_slug, solved=excluded.solved,
           score=excluded.score, first_move_legal=excluded.first_move_legal,
           failure_reason=excluded.failure_reason, answer_move=excluded.answer_move,
           answer_explanation=excluded.answer_explanation, seq_elo=excluded.seq_elo`,
      ).bind(
        id,
        it.puzzle_id,
        variant.key,
        slug,
        it.solved ? 1 : 0,
        it.score ?? 0,
        it.first_move_legal ? 1 : 0,
        it.failure_reason ?? null,
        it.answer_move ?? null,
        it.answer_explanation ?? null,
        typeof it.seq_elo === "number" ? it.seq_elo : null,
      ),
    )
  }
  await batchChunked(env, legacy)
  await finishRun(env, { run_id: id, status: "completed" })
  return { run_id: id, items: doc.items.length }
}

export async function ingestTournament(env: Env, doc: TournamentDoc, tid: string): Promise<{ tid: string }> {
  const slug = doc.condition?.slug ?? "unknown"
  const standings = doc.standings ?? []
  const winner = standings[0]?.label ?? null
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
