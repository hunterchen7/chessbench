import type { Env } from "./types"
import { error, json } from "./http"

async function summaryFor(env: Env, uid: string) {
  const { results } = await env.DB.prepare(
    `SELECT solved FROM human_solves WHERE uid = ?`,
  ).bind(uid).all<{ solved: number }>()
  const items = results ?? []
  const solved = items.filter((x) => x.solved).length
  return {
    uid,
    n: items.length,
    solved,
    points: solved,
    max_points: items.length,
    accuracy: items.length ? solved / items.length : 0,
  }
}

/** POST /api/human/solve — record an anonymous solve; keeps the best outcome per puzzle.
 * The puzzle must exist, and a solve is only credited when the submitted first move
 * matches the stored solution — so the endpoint can't be used to fabricate solves for
 * unknown puzzles or to inflate the leaderboard by blindly posting solved=true. */
export async function postHumanSolve(env: Env, req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as
    | { uid?: unknown; puzzle_id?: unknown; solved?: unknown; move?: unknown; handle?: unknown }
    | null
  if (!body || typeof body.uid !== "string" || typeof body.puzzle_id !== "string") {
    return error(400, "uid and puzzle_id (strings) are required")
  }
  const uid = body.uid.trim().slice(0, 64)
  const pid = body.puzzle_id.trim().slice(0, 64)
  if (!uid || !pid) return error(400, "invalid uid/puzzle_id")

  // Reject unknown puzzles (bounds storage, prevents fabricated ids) and verify the move.
  const puzzle = await env.DB.prepare(
    `SELECT json_extract(c.payload_json, '$.solution_first') AS solution_first
       FROM corpus_items c JOIN corpus_releases r USING(content_hash)
      WHERE c.item_id=? AND r.track='standard' AND r.visibility='public' AND r.active=1`,
  ).bind(pid).first<{ solution_first: string | null }>()
  if (!puzzle) return error(404, "unknown puzzle")
  const move = typeof body.move === "string" ? body.move.trim().slice(0, 12) : null
  const solved = body.solved && move && puzzle.solution_first && move === puzzle.solution_first ? 1 : 0
  const now = new Date().toISOString()

  await env.DB.prepare(
    `INSERT INTO human_solves (uid, puzzle_id, solved, updated) VALUES (?, ?, ?, ?)
     ON CONFLICT(uid, puzzle_id) DO UPDATE SET
       solved = MAX(human_solves.solved, excluded.solved), updated = excluded.updated`,
  ).bind(uid, pid, solved, now).run()

  if (typeof body.handle === "string" && body.handle.trim()) {
    const handle = body.handle.trim().slice(0, 32)
    await env.DB.prepare(
      `INSERT INTO human_profiles (uid, handle, updated) VALUES (?, ?, ?)
       ON CONFLICT(uid) DO UPDATE SET handle = excluded.handle, updated = excluded.updated`,
    ).bind(uid, handle, now).run()
  }
  return json(await summaryFor(env, uid))
}

/** GET /api/human/summary?uid= — one solver's points. */
export async function getHumanSummary(env: Env, url: URL): Promise<Response> {
  const uid = (url.searchParams.get("uid") ?? "").trim().slice(0, 64)
  if (!uid) return error(400, "uid query param required")
  return json(await summaryFor(env, uid))
}

/** GET /api/human/leaderboard[?uid=] — top solvers by points. Raw uids are never
 * returned (they're the only handle to a solver's records); the caller's own uid,
 * if passed, is marked with `me` so the client can highlight its row. */
export async function getHumanLeaderboard(env: Env, url: URL): Promise<Response> {
  const meUid = (url.searchParams.get("uid") ?? "").trim().slice(0, 64) || null
  const { results } = await env.DB.prepare(
    `SELECT uid, solved FROM human_solves`,
  ).all<{ uid: string; solved: number }>()
  const byUid = new Map<string, number[]>()
  for (const r of results ?? []) {
    const arr = byUid.get(r.uid) ?? []
    arr.push(r.solved)
    byUid.set(r.uid, arr)
  }
  const { results: profs } = await env.DB.prepare(`SELECT uid, handle FROM human_profiles`).all<{
    uid: string; handle: string | null
  }>()
  const handles = new Map((profs ?? []).map((p) => [p.uid, p.handle]))

  const leaderboard = Array.from(byUid.entries())
    .map(([uid, items]) => ({
      handle: handles.get(uid) ?? null,
      me: meUid !== null && uid === meUid,
      n: items.length,
      solved: items.filter(Boolean).length,
      points: items.filter(Boolean).length,
      max_points: items.length,
      accuracy: items.length ? items.filter(Boolean).length / items.length : 0,
    }))
    .sort((a, b) => b.points - a.points || b.accuracy - a.accuracy)
    .slice(0, 100)
  return json({ leaderboard })
}
