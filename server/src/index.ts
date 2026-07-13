import type { Env } from "./types"
import { error, json, preflight } from "./http"
import { getIndex, getPuzzle, getPuzzles, getRun, getTournament, getTournaments } from "./api"
import { getHumanLeaderboard, getHumanSummary, postHumanSolve } from "./human"
import { postIngestRun, postIngestTournament } from "./ingest"

// chessbench backend: a JSON API under /api/* over Cloudflare D1, with the built
// Vite SPA served from the same origin via the [assets] binding. Non-/api requests
// fall through to static assets; hash routing means every page loads index.html.

const rest = (seg: string, prefix: string) => decodeURIComponent(seg.slice(prefix.length))

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    const { pathname } = url

    if (!pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(req)
    }
    if (req.method === "OPTIONS") return preflight()

    const seg = pathname.slice("/api/".length).replace(/\/+$/, "")
    try {
      if (req.method === "GET") {
        if (seg === "health") return json({ ok: true, service: "chessbench", time: new Date().toISOString() })
        if (seg === "index" || seg === "runs") return await getIndex(env)
        if (seg === "puzzles") return await getPuzzles(env)
        if (seg.startsWith("puzzles/")) return await getPuzzle(env, rest(seg, "puzzles/"))
        if (seg.startsWith("runs/")) return await getRun(env, rest(seg, "runs/"))
        if (seg === "tournaments") return await getTournaments(env)
        if (seg.startsWith("tournaments/")) return await getTournament(env, rest(seg, "tournaments/"))
        if (seg === "human/leaderboard") return await getHumanLeaderboard(env, url)
        if (seg === "human/summary") return await getHumanSummary(env, url)
      } else if (req.method === "POST") {
        if (seg === "human/solve") return await postHumanSolve(env, req)
        if (seg === "ingest/run") return await postIngestRun(env, req)
        if (seg === "ingest/tournament") return await postIngestTournament(env, req, url)
      }
      return error(404, `no route: ${req.method} /api/${seg}`)
    } catch (e) {
      return error(500, e instanceof Error ? e.message : "internal error")
    }
  },
} satisfies ExportedHandler<Env>
