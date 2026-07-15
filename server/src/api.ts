import type { Env } from "./types"
import { authorized } from "./auth"
import { downloadJson, error, json } from "./http"
import { assembleLiveTournament, liveTournamentIndex } from "./games"

interface RunRow {
  run_id: string
  track: string
  variant_key: string
  base_model: string
  display_name: string
  provider: string
  provider_model_id: string
  reasoning_json: string
  max_output_tokens: number
  condition_slug: string
  condition_json: string
  suite_name: string | null
  suite_version: string | null
  suite_hash: string | null
  suite_visibility: string | null
  status: string
  total_items: number
  completed_items: number
  solved_items: number
  legal_items: number
  response_format_items: number
  response_format_valid_items: number
  points: number
  max_points: number
  cost_usd: number
  prompt_tokens: number
  completion_tokens: number
  reasoning_tokens: number
  error: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

const RUN_SELECT = `
  SELECT r.*, v.base_model, v.display_name, v.provider, v.provider_model_id,
         v.reasoning_json, v.max_output_tokens
    FROM benchmark_runs_v2 r JOIN model_variants_v2 v USING(variant_key)`

function publicRun(row: RunRow) {
  return {
    run_id: row.run_id,
    file: row.run_id,
    track: row.track,
    kind: row.track,
    status: row.status,
    model: row.variant_key,
    model_variant: {
      key: row.variant_key,
      base_key: row.base_model,
      display_name: row.display_name,
      provider: row.provider,
      model_id: row.provider_model_id,
      reasoning: JSON.parse(row.reasoning_json),
      max_output_tokens: row.max_output_tokens,
    },
    condition: JSON.parse(row.condition_json),
    condition_slug: row.condition_slug,
    suite: row.suite_name
      ? {
          name: row.suite_name,
          version: row.suite_version,
          content_hash: row.suite_hash,
          visibility: row.suite_visibility,
        }
      : null,
    progress: { completed: row.completed_items, total: row.total_items },
    summary: {
      n: row.completed_items,
      solved: row.solved_items,
      solve_rate: row.completed_items ? row.solved_items / row.completed_items : 0,
      first_move_legal_rate: row.completed_items ? row.legal_items / row.completed_items : 0,
      response_format_valid_rate: row.response_format_items
        ? row.response_format_valid_items / row.response_format_items
        : null,
      mean_score: row.completed_items ? row.points / row.completed_items : 0,
      points: row.points,
      max_points: row.max_points,
      cost_usd: row.cost_usd,
    },
    usage: {
      prompt_tokens: row.prompt_tokens,
      completion_tokens: row.completion_tokens,
      reasoning_tokens: row.reasoning_tokens,
      cost_usd: row.cost_usd,
    },
    error: row.error,
    created: row.created_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at,
  }
}

const isPrivateSuite = (row: RunRow) => row.suite_visibility === "private"

async function runItems(env: Env, runId: string): Promise<unknown[]> {
  const { results } = await env.DB.prepare(
    `SELECT payload_json FROM benchmark_items_v2 WHERE run_id=? ORDER BY sequence`,
  ).bind(runId).all<{ payload_json: string }>()
  return (results ?? []).map((item) => JSON.parse(item.payload_json))
}

function disclosure(row: RunRow, ownerAccess: boolean) {
  if (!isPrivateSuite(row)) return { level: "public", items_included: true }
  return ownerAccess
    ? { level: "owner", items_included: true }
    : {
        level: "sealed",
        items_included: false,
        reason: "Private suite membership, item outcomes, prompts, and transcripts are owner-only.",
      }
}

/** GET /api/index — lightweight, points-first manifests; no item waterfalls. */
export async function getIndex(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(`${RUN_SELECT} ORDER BY r.created_at DESC`).all<RunRow>()
  const runs = (results ?? []).map(publicRun)
  return json({
    schema: "chessbench.index.v2",
    generated_at: new Date().toISOString(),
    scoring: "points",
    tracks: ["puzzle", "woodpecker", "esoteric", "game"],
    runs,
  })
}

/** GET /api/runs/:id — public items or a sealed private-suite aggregate. */
export async function getRun(env: Env, id: string, req: Request): Promise<Response> {
  const row = await env.DB.prepare(`${RUN_SELECT} WHERE r.run_id=?`).bind(id).first<RunRow>()
  if (!row) return error(404, "run not found")
  const wantsPrivate = new URL(req.url).searchParams.get("include_private") === "1"
  if (wantsPrivate && !authorized(env, req)) return error(401, "owner authorization required")
  const ownerAccess = isPrivateSuite(row) && wantsPrivate
  const items = !isPrivateSuite(row) || ownerAccess ? await runItems(env, id) : []
  return json({
    schema: "chessbench.run.v2",
    ...publicRun(row),
    disclosure: disclosure(row, ownerAccess),
    items,
  })
}

/** GET /api/puzzles — the position bank with per-puzzle model solve stats. */
export async function getPuzzles(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT i.item_id AS puzzle_id, MAX(i.payload_json) AS payload_json,
            COUNT(*) AS total, COALESCE(SUM(i.solved), 0) AS solved
       FROM benchmark_items_v2 i
       JOIN benchmark_runs_v2 r USING(run_id)
      WHERE r.track='puzzle' AND COALESCE(r.suite_visibility, 'public') <> 'private'
      GROUP BY i.item_id
      ORDER BY CAST(json_extract(MAX(i.payload_json), '$.rating') AS INTEGER), i.item_id`,
  ).all<{ puzzle_id: string; payload_json: string; total: number; solved: number }>()
  const puzzles = (results ?? []).map((r) => {
    const p = JSON.parse(r.payload_json) as Record<string, unknown>
    return { ...p, puzzle_id: r.puzzle_id, solved: r.solved, total: r.total }
  })
  return json({ puzzles })
}

/** GET /api/puzzles/:id — a position plus how every model answered it. */
export async function getPuzzle(env: Env, id: string): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT i.run_id, r.variant_key AS model, r.condition_slug, i.solved, i.points,
            i.first_move_legal, i.failure_reason, i.payload_json
       FROM benchmark_items_v2 i JOIN benchmark_runs_v2 r USING(run_id)
      WHERE i.item_id=? AND r.track='puzzle'
        AND COALESCE(r.suite_visibility, 'public') <> 'private'
      ORDER BY i.solved DESC, r.variant_key ASC`,
  ).bind(id).all<{
    run_id: string; model: string; condition_slug: string; solved: number; points: number
    first_move_legal: number; failure_reason: string | null; payload_json: string
  }>()
  const rows = results ?? []
  if (!rows.length) return error(404, "puzzle not found")
  const payloads = rows.map((row) => JSON.parse(row.payload_json) as Record<string, unknown>)
  const position = { ...payloads[0], puzzle_id: id }
  const answers = rows.map((a, index) => ({
    ...payloads[index], run_id: a.run_id, model: a.model, condition: a.condition_slug,
    solved: !!a.solved, score: a.points, first_move_legal: !!a.first_move_legal,
    failure_reason: a.failure_reason,
  }))
  return json({ position, answers })
}

/** GET /api/tournaments — light index of final + live tournaments. */
export async function getTournaments(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT tid, created, condition_slug, n_players, n_games, winner FROM tournaments ORDER BY created DESC`,
  ).all<{ tid: string; created: string; condition_slug: string | null; n_players: number; n_games: number; winner: string | null }>()
  const finals = (results ?? []).map((t) => ({
    file: t.tid,
    created: t.created,
    status: "final",
    condition_slug: t.condition_slug,
    n_players: t.n_players,
    n_games: t.n_games,
    winner: t.winner,
  }))
  const live = await liveTournamentIndex(env)
  return json({ schema: "chessbench.tournament_index.v1", tournaments: [...live, ...finals] })
}

/** GET /api/tournaments/:id — the final document, or a live view assembled from streamed games. */
export async function getTournament(env: Env, id: string): Promise<Response> {
  const row = await env.DB.prepare(`SELECT doc_json FROM tournaments WHERE tid = ?`).bind(id).first<{ doc_json: string }>()
  if (row) return json(JSON.parse(row.doc_json))
  const live = await assembleLiveTournament(env, id)
  if (live) return json(live)
  return error(404, "tournament not found")
}

/** GET /api/export — download a complete or filtered, versioned JSON snapshot. */
export async function getExport(env: Env, url: URL, req: Request): Promise<Response> {
  const track = url.searchParams.get("track")
  const model = url.searchParams.get("model")
  const runId = url.searchParams.get("run")
  const status = url.searchParams.get("status")
  const wantsPrivate = url.searchParams.get("include_private") === "1"
  const allowedTracks = new Set(["puzzle", "woodpecker", "esoteric", "game"])
  const allowedStatuses = new Set(["queued", "running", "partial", "completed", "failed"])
  if (track && !allowedTracks.has(track)) return error(400, "invalid track filter")
  if (status && !allowedStatuses.has(status)) return error(400, "invalid status filter")
  if (wantsPrivate && !authorized(env, req)) return error(401, "owner authorization required")

  const clauses: string[] = []
  const binds: string[] = []
  if (track) { clauses.push("r.track=?"); binds.push(track) }
  if (model) { clauses.push("r.variant_key=?"); binds.push(model) }
  if (runId) { clauses.push("r.run_id=?"); binds.push(runId) }
  if (status) { clauses.push("r.status=?"); binds.push(status) }
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""
  const stmt = env.DB.prepare(`${RUN_SELECT}${where} ORDER BY r.created_at DESC`)
  const { results } = await stmt.bind(...binds).all<RunRow>()
  const rows = results ?? []
  const runs = await Promise.all(rows.map(async (row) => {
    const ownerAccess = isPrivateSuite(row) && wantsPrivate
    const items = !isPrivateSuite(row) || ownerAccess ? await runItems(env, row.run_id) : []
    return { ...publicRun(row), disclosure: disclosure(row, ownerAccess), items }
  }))

  const includeGames = !track || track === "game"
  let tournaments: unknown[] = []
  if (includeGames) {
    const { results: docs } = await env.DB.prepare(
      `SELECT doc_json FROM tournaments ORDER BY created DESC`,
    ).all<{ doc_json: string }>()
    tournaments = (docs ?? []).map((row) => JSON.parse(row.doc_json))
  }
  const stamp = new Date().toISOString()
  const suffix = [track, model, runId, status, wantsPrivate ? "owner" : null]
    .filter(Boolean)
    .join("-") || "all"
  return downloadJson(
    {
      schema: "chessbench.export.v2",
      generated_at: stamp,
      scoring: {
        puzzle: "sum of per-item credit; 1 point per complete puzzle",
        woodpecker: "sum of complete-line/prefix credit; 1 point per puzzle",
        esoteric: "sum of verifier-awarded item points",
        game: "1 win / 0.5 draw / 0 loss",
      },
      filters: { track, model, run: runId, status },
      privacy: {
        private_suite_items: wantsPrivate ? "included for authenticated owner" : "sealed",
        aggregate_scores: "included",
      },
      runs,
      tournaments,
    },
    `chessbench-${suffix}.json`,
  )
}
