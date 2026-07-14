import type { Env } from "./types"
import { error, json } from "./http"
import { assembleLiveTournament, liveTournamentIndex } from "./games"

/** GET /api/index — the run index the leaderboard reads (mirrors index.json). */
export async function getIndex(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT run_id, model, created, kind, condition_slug, suite, summary_json
       FROM runs ORDER BY created DESC`,
  ).all<{
    run_id: string; model: string; created: string; kind: string
    condition_slug: string; suite: string | null; summary_json: string
  }>()
  const runs = (results ?? []).map((r) => ({
    file: r.run_id,
    model: r.model,
    created: r.created,
    kind: r.kind,
    condition: r.condition_slug,
    suite: r.suite,
    summary: JSON.parse(r.summary_json),
  }))
  return json({ schema: "chessbench.index.v1", runs })
}

/** GET /api/runs/:id — the full run document (items, themes, condition). */
export async function getRun(env: Env, id: string): Promise<Response> {
  const row = await env.DB.prepare(`SELECT doc_json FROM runs WHERE run_id = ?`).bind(id).first<{ doc_json: string }>()
  if (!row) return error(404, "run not found")
  return json(JSON.parse(row.doc_json))
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
    `SELECT tid, created, n_players, n_games, winner FROM tournaments ORDER BY created DESC`,
  ).all<{ tid: string; created: string; n_players: number; n_games: number; winner: string | null }>()
  const finals = (results ?? []).map((t) => ({
    file: t.tid,
    created: t.created,
    status: "final",
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
