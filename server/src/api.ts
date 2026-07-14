import type { Env } from "./types"
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

/** GET /api/runs/:id — one manifest plus its item payloads. */
export async function getRun(env: Env, id: string): Promise<Response> {
  const row = await env.DB.prepare(`${RUN_SELECT} WHERE r.run_id=?`).bind(id).first<RunRow>()
  if (!row) return error(404, "run not found")
  const { results } = await env.DB.prepare(
    `SELECT payload_json FROM benchmark_items_v2 WHERE run_id=? ORDER BY sequence`,
  ).bind(id).all<{ payload_json: string }>()
  return json({ schema: "chessbench.run.v2", ...publicRun(row), items: (results ?? []).map((r) => JSON.parse(r.payload_json)) })
}

/** GET /api/puzzles — the position bank with per-puzzle model solve stats. */
export async function getPuzzles(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT p.puzzle_id, p.rating, p.fen, p.setup_san, p.solver_is_white,
            p.themes_json, p.categories_json, p.game_url,
            COUNT(a.puzzle_id) AS total, COALESCE(SUM(a.solved), 0) AS solved
       FROM puzzles p
       LEFT JOIN run_answers a ON a.puzzle_id = p.puzzle_id
       GROUP BY p.puzzle_id
       ORDER BY p.rating ASC`,
  ).all<{
    puzzle_id: string; rating: number; fen: string; setup_san: string | null
    solver_is_white: number; themes_json: string; categories_json: string; game_url: string | null
    total: number; solved: number
  }>()
  const puzzles = (results ?? []).map((r) => ({
    puzzle_id: r.puzzle_id,
    rating: r.rating,
    fen: r.fen,
    setup_san: r.setup_san,
    solver_is_white: !!r.solver_is_white,
    themes: JSON.parse(r.themes_json),
    categories: JSON.parse(r.categories_json),
    game_url: r.game_url,
    solved: r.solved,
    total: r.total,
  }))
  return json({ puzzles })
}

/** GET /api/puzzles/:id — a position plus how every model answered it. */
export async function getPuzzle(env: Env, id: string): Promise<Response> {
  const pos = await env.DB.prepare(
    `SELECT puzzle_id, rating, fen, setup_san, solver_is_white, solution_json, solution_first,
            themes_json, categories_json, game_url
       FROM puzzles WHERE puzzle_id = ?`,
  ).bind(id).first<{
    puzzle_id: string; rating: number; fen: string; setup_san: string | null; solver_is_white: number
    solution_json: string; solution_first: string | null; themes_json: string
    categories_json: string; game_url: string | null
  }>()
  if (!pos) return error(404, "puzzle not found")
  const { results } = await env.DB.prepare(
    `SELECT run_id, model, condition_slug, solved, score, first_move_legal, failure_reason,
            answer_move, answer_explanation, seq_elo
       FROM run_answers WHERE puzzle_id = ?
       ORDER BY solved DESC, model ASC`,
  ).bind(id).all<{
    run_id: string; model: string; condition_slug: string; solved: number; score: number
    first_move_legal: number; failure_reason: string | null; answer_move: string | null
    answer_explanation: string | null; seq_elo: number | null
  }>()
  const position = {
    puzzle_id: pos.puzzle_id,
    rating: pos.rating,
    fen: pos.fen,
    setup_san: pos.setup_san,
    solver_is_white: !!pos.solver_is_white,
    solution: JSON.parse(pos.solution_json),
    solution_first: pos.solution_first,
    themes: JSON.parse(pos.themes_json),
    categories: JSON.parse(pos.categories_json),
    game_url: pos.game_url,
  }
  const answers = (results ?? []).map((a) => ({
    run_id: a.run_id,
    model: a.model,
    condition: a.condition_slug,
    solved: !!a.solved,
    score: a.score,
    first_move_legal: !!a.first_move_legal,
    failure_reason: a.failure_reason,
    answer_move: a.answer_move,
    answer_explanation: a.answer_explanation,
    seq_elo: a.seq_elo,
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
export async function getExport(env: Env, url: URL): Promise<Response> {
  const track = url.searchParams.get("track")
  const model = url.searchParams.get("model")
  const runId = url.searchParams.get("run")
  const status = url.searchParams.get("status")
  const allowedTracks = new Set(["puzzle", "woodpecker", "esoteric", "game"])
  const allowedStatuses = new Set(["queued", "running", "partial", "completed", "failed"])
  if (track && !allowedTracks.has(track)) return error(400, "invalid track filter")
  if (status && !allowedStatuses.has(status)) return error(400, "invalid status filter")

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
    const { results: items } = await env.DB.prepare(
      `SELECT payload_json FROM benchmark_items_v2 WHERE run_id=? ORDER BY sequence`,
    ).bind(row.run_id).all<{ payload_json: string }>()
    return { ...publicRun(row), items: (items ?? []).map((item) => JSON.parse(item.payload_json)) }
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
  const suffix = [track, model, runId, status].filter(Boolean).join("-") || "all"
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
      runs,
      tournaments,
    },
    `chessbench-${suffix}.json`,
  )
}
