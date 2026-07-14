// Incremental game streaming: games are ingested one at a time as they finish,
// and the in-progress board is snapshotted per move — so a tournament is durable
// after every game and the web viewer can watch it live. The final Bradley-Terry
// doc still lands via POST /api/ingest/tournament once the run completes.
import type { Env } from "./types"
import { authorized } from "./ingest"
import { error, json } from "./http"

interface GamePayload {
  idx?: number
  white?: string
  black?: string
  result?: string
  termination?: string
  plies?: number
  pgn?: string
  start_fen?: string | null
  moves?: Array<{
    ply?: number
    color?: string
    attempts?: Array<{
      system_prompt?: string | null
      prompt?: string | null
      raw_response?: string
      parsed_move?: string | null
      legal?: boolean
      explanation?: string | null
      response_format_valid?: boolean | null
      response_format_error?: string | null
      prompt_tokens?: number
      completion_tokens?: number
      reasoning_tokens?: number
      cost_usd?: number
    }>
  }>
}

interface IngestGameBody {
  tid?: string
  created?: string
  condition_slug?: string
  players?: string[]
  game?: GamePayload
}

const now = () => new Date().toISOString()

/** POST /api/ingest/game — upsert one completed game and register/refresh the live tournament. */
export async function postIngestGame(env: Env, req: Request, url: URL): Promise<Response> {
  if (!authorized(env, req)) return error(401, "unauthorized")
  const body = (await req.json().catch(() => null)) as IngestGameBody | null
  const tid = (body?.tid ?? url.searchParams.get("tid") ?? "").trim().slice(0, 80)
  const g = body?.game
  if (!tid || !g || typeof g.white !== "string" || typeof g.black !== "string") {
    return error(400, "tid and game{white,black} are required")
  }
  const idx = Number.isFinite(g.idx) ? Number(g.idx) : 0
  const gameId = `${tid}#${idx}`
  const headerStatements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO live_tournaments (tid, created, condition_slug, players_json, status, updated)
       VALUES (?, ?, ?, ?, 'live', ?)
       ON CONFLICT(tid) DO UPDATE SET
         created=COALESCE(live_tournaments.created, excluded.created),
         condition_slug=COALESCE(excluded.condition_slug, live_tournaments.condition_slug),
         players_json=COALESCE(excluded.players_json, live_tournaments.players_json),
         status=CASE WHEN live_tournaments.status='final' THEN 'final' ELSE 'live' END,
         updated=excluded.updated`,
    ).bind(tid, body?.created ?? now(), body?.condition_slug ?? null,
           body?.players ? JSON.stringify(body.players) : null, now()),
    env.DB.prepare(
      `INSERT INTO games (game_id, tid, idx, white, black, result, termination, plies, pgn, start_fen, moves_json, updated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(game_id) DO UPDATE SET
         result=excluded.result, termination=excluded.termination, plies=excluded.plies,
         pgn=excluded.pgn, start_fen=excluded.start_fen, moves_json=excluded.moves_json, updated=excluded.updated`,
    ).bind(gameId, tid, idx, g.white, g.black, g.result ?? "*", g.termination ?? "", g.plies ?? 0,
           g.pgn ?? "", g.start_fen ?? null, JSON.stringify(g.moves ?? []), now()),
    // A completed game clears the live board (it's between games now).
    env.DB.prepare(`DELETE FROM live_boards WHERE tid = ?`).bind(tid),
    env.DB.prepare(`DELETE FROM game_turn_logs_v2 WHERE game_id = ?`).bind(gameId),
  ]
  const logStatements: D1PreparedStatement[] = []
  for (const move of g.moves ?? []) {
    for (const [attemptIndex, attempt] of (move.attempts ?? []).entries()) {
      logStatements.push(env.DB.prepare(
        `INSERT INTO game_turn_logs_v2
         (game_id, ply, attempt, color, system_prompt, prompt, raw_response, parsed_move, legal, explanation,
          response_format_valid, response_format_error, prompt_tokens, completion_tokens, reasoning_tokens,
          cost_usd, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        gameId, move.ply ?? 0, attemptIndex, move.color ?? "unknown", attempt.system_prompt ?? null, attempt.prompt ?? null,
        attempt.raw_response ?? "", attempt.parsed_move ?? null, attempt.legal ? 1 : 0,
        attempt.explanation ?? null,
        attempt.response_format_valid == null ? null : attempt.response_format_valid ? 1 : 0,
        attempt.response_format_error ?? null,
        attempt.prompt_tokens ?? 0, attempt.completion_tokens ?? 0,
        attempt.reasoning_tokens ?? 0, attempt.cost_usd ?? 0, now(),
      ))
    }
  }
  await env.DB.batch(headerStatements)
  // D1 batch sizes are finite; long games can contain hundreds of turns and
  // retries, so commit transcript rows in bounded chunks.
  for (let offset = 0; offset < logStatements.length; offset += 50) {
    await env.DB.batch(logStatements.slice(offset, offset + 50))
  }
  return json({ ok: true, game_id: gameId })
}

/** POST /api/live/board — upsert the single in-progress game snapshot for a tournament. */
export async function postLiveBoard(env: Env, req: Request, url: URL): Promise<Response> {
  if (!authorized(env, req)) return error(401, "unauthorized")
  const body = (await req.json().catch(() => null)) as { tid?: string; game?: unknown } | null
  const tid = (body?.tid ?? url.searchParams.get("tid") ?? "").trim().slice(0, 80)
  if (!tid || !body?.game) return error(400, "tid and game are required")
  await env.DB.prepare(
    `INSERT INTO live_boards (tid, game_json, updated) VALUES (?, ?, ?)
     ON CONFLICT(tid) DO UPDATE SET game_json=excluded.game_json, updated=excluded.updated`,
  ).bind(tid, JSON.stringify(body.game), now()).run()
  return json({ ok: true })
}

interface GameRow {
  idx: number; white: string; black: string; result: string; termination: string
  plies: number; pgn: string; start_fen: string | null; moves_json: string
}

/** Assemble a live tournament view from streamed games + the in-progress board.
 * Standings are a simple points tally (no Bradley-Terry until the final doc lands). */
export async function assembleLiveTournament(env: Env, tid: string): Promise<unknown | null> {
  const meta = await env.DB.prepare(
    `SELECT tid, created, condition_slug, players_json, status FROM live_tournaments WHERE tid = ?`,
  ).bind(tid).first<{ created: string; condition_slug: string | null; players_json: string | null; status: string }>()
  if (!meta) return null

  const { results } = await env.DB.prepare(
    `SELECT idx, white, black, result, termination, plies, pgn, start_fen, moves_json
       FROM games WHERE tid = ? ORDER BY idx`,
  ).bind(tid).all<GameRow>()
  const rows = results ?? []

  const tally = new Map<string, { wins: number; draws: number; losses: number; games: number; score: number }>()
  const seed = (p: string) => tally.get(p) ?? { wins: 0, draws: 0, losses: 0, games: 0, score: 0 }
  const games = rows.map((r) => {
    const w = seed(r.white), b = seed(r.black)
    w.games++; b.games++
    if (r.result === "1-0") { w.wins++; w.score += 1; b.losses++ }
    else if (r.result === "0-1") { b.wins++; b.score += 1; w.losses++ }
    else { w.draws++; b.draws++; w.score += 0.5; b.score += 0.5 }
    tally.set(r.white, w); tally.set(r.black, b)
    return {
      white: r.white, black: r.black, result: r.result, termination: r.termination,
      plies: r.plies, pgn: r.pgn, start_fen: r.start_fen, moves: safeParse(r.moves_json, []),
    }
  })
  const players: string[] = meta.players_json ? safeParse(meta.players_json, []) : Array.from(tally.keys())
  const standings = players
    .map((label) => {
      const t = seed(label)
      return { label, wins: t.wins, draws: t.draws, losses: t.losses, games: t.games, score: t.score,
               illegal_forfeits: 0, rating: null, rating_ci: [null, null], bounded: false }
    })
    .sort((a, b) => b.score - a.score || b.wins - a.wins)

  const live = await env.DB.prepare(`SELECT game_json FROM live_boards WHERE tid = ?`)
    .bind(tid).first<{ game_json: string }>()

  return {
    schema: "chessbench.tournament.v1",
    status: meta.status === "final" ? "final" : "live",
    created: meta.created,
    condition: { slug: meta.condition_slug ?? "" },
    max_plies: 0,
    anchor: null,
    standings,
    games,
    crosstable: [],
    live_game: live ? safeParse(live.game_json, null) : null,
  }
}

/** Live tournaments that do not yet have a final doc (for the index). */
export async function liveTournamentIndex(env: Env): Promise<Array<Record<string, unknown>>> {
  const { results } = await env.DB.prepare(
    `SELECT lt.tid AS tid, lt.created AS created, lt.status AS status, lt.condition_slug AS condition_slug,
            (SELECT COUNT(*) FROM games g WHERE g.tid = lt.tid) AS n_games,
            lt.players_json AS players_json
       FROM live_tournaments lt
       WHERE lt.tid NOT IN (SELECT tid FROM tournaments)
       ORDER BY lt.created DESC`,
  ).all<{ tid: string; created: string; status: string; condition_slug: string | null; n_games: number; players_json: string | null }>()
  return (results ?? []).map((t) => ({
    file: t.tid,
    created: t.created,
    status: t.status,
    condition_slug: t.condition_slug,
    n_players: t.players_json ? (safeParse<string[]>(t.players_json, []).length) : 0,
    n_games: t.n_games,
    winner: null,
  }))
}

function safeParse<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}
