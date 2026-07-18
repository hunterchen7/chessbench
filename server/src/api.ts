import type { Env } from "./types"
import { ratedPuzzlePosition, type RatedPuzzleMetadata } from "./puzzle_payloads"
import { authorized } from "./auth"
import { PUZZLE_RATING_PRIOR, PUZZLE_RATING_PROVISIONAL_CI_WIDTH } from "./db"
import { includesTournaments } from "./export_filters"
import { downloadJson, error, json } from "./http"
import { assembleLiveTournament, liveTournamentIndex } from "./games"
import {
  parseInlineRunItemPayload,
  parseRunItemPayloadReference,
  reassembleRunItemPayload,
  type StoredRunItemPayloadChunk,
} from "./run_item_payloads"

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
  protocol_json: string | null
  summary_json: string | null
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
  cache_read_tokens: number
  cache_write_tokens: number
  uncached_prompt_tokens: number
  cache_discount_usd: number
  puzzle_rating: number | null
  puzzle_rating_stderr: number | null
  puzzle_rating_n: number
  puzzle_rating_bounded: number
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
  const protocol = row.protocol_json
    ? JSON.parse(row.protocol_json) as Record<string, unknown>
    : null
  const storedSummary = row.summary_json
    ? JSON.parse(row.summary_json) as Record<string, unknown>
    : null
  const storedTermination = storedSummary?.termination as Record<string, unknown> | undefined
  const adaptive = protocol?.kind === "adaptive_glicko2"
  const stoppedByPolicy =
    row.status === "completed" &&
    row.completed_items < row.total_items &&
    storedTermination?.kind === "consecutive_unsolved"
  const scoringItems = stoppedByPolicy ? row.total_items : row.completed_items
  const threshold = Number(row.error?.match(/Stopped after (\d+) consecutive/)?.[1] ?? 0) || null
  const storedRating = storedSummary?.puzzle_performance_rating as Record<string, unknown> | undefined
  const adaptiveRatingProtocol = adaptive
    ? protocol.rating as Record<string, unknown> | undefined
    : undefined
  const adaptiveStopping = adaptive
    ? protocol.stopping as Record<string, unknown> | undefined
    : undefined
  const adaptiveDeviation = row.puzzle_rating_stderr
  const adaptiveMinimum = Number(adaptiveStopping?.minimum_puzzles ?? 50)
  const adaptiveTargetDeviation = Number(adaptiveStopping?.target_rating_deviation ?? 75)
  const adaptiveProvisional =
    row.completed_items < adaptiveMinimum ||
    adaptiveDeviation == null ||
    adaptiveDeviation > adaptiveTargetDeviation
  const liveAdaptiveRating = adaptive && row.puzzle_rating != null ? {
    rating: row.puzzle_rating,
    stderr: adaptiveDeviation,
    rating_deviation: adaptiveDeviation,
    ci95: adaptiveDeviation == null ? null : [
      row.puzzle_rating - 2 * adaptiveDeviation,
      row.puzzle_rating + 2 * adaptiveDeviation,
    ],
    n: row.puzzle_rating_n || row.completed_items,
    bounded: Boolean(row.puzzle_rating_bounded),
    method: String(adaptiveRatingProtocol?.version ?? "lichess_glicko2_frozen_puzzles_v1"),
    provisional: adaptiveProvisional,
    settled: row.status === "completed" && !adaptiveProvisional,
    prior: adaptiveRatingProtocol?.initial,
  } : null
  const puzzleRating = adaptive
    ? storedRating ?? liveAdaptiveRating
    : row.puzzle_rating == null ? null : {
        rating: row.puzzle_rating,
        stderr: row.puzzle_rating_stderr,
        rating_deviation: row.puzzle_rating_stderr,
        ci95: row.puzzle_rating_stderr == null ? null : [
          row.puzzle_rating - 1.96 * row.puzzle_rating_stderr,
          row.puzzle_rating + 1.96 * row.puzzle_rating_stderr,
        ],
        n: row.puzzle_rating_n,
        bounded: Boolean(row.puzzle_rating_bounded),
        method: "bayesian_elo_v1",
        provisional: row.puzzle_rating_stderr == null ||
          2 * 1.96 * row.puzzle_rating_stderr > PUZZLE_RATING_PROVISIONAL_CI_WIDTH,
        prior: PUZZLE_RATING_PRIOR,
      }
  return {
    run_id: row.run_id,
    file: row.run_id,
    track: row.track,
    kind: row.track,
    status: row.status,
    model: row.provider_model_id,
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
    protocol,
    suite: row.suite_name
      ? {
          name: row.suite_name,
          version: row.suite_version,
          content_hash: row.suite_hash,
          visibility: row.suite_visibility,
        }
      : null,
    progress: { completed: row.completed_items, total: row.total_items },
    termination: adaptive && storedTermination ? storedTermination : stoppedByPolicy ? {
      kind: "consecutive_unsolved",
      threshold,
      attempted: row.completed_items,
      unattempted: row.total_items - row.completed_items,
      unattempted_score: 0,
      message: row.error,
    } : null,
    summary: {
      n: scoringItems,
      solved: row.solved_items,
      solve_rate: scoringItems ? row.solved_items / scoringItems : 0,
      first_move_legal_rate: row.completed_items ? row.legal_items / row.completed_items : 0,
      response_format_valid_rate: row.response_format_items
        ? row.response_format_valid_items / row.response_format_items
        : null,
      mean_score: scoringItems ? row.points / scoringItems : 0,
      points: row.points,
      max_points: row.max_points,
      cost_usd: row.cost_usd,
      puzzle_performance_rating: puzzleRating,
    },
    usage: {
      prompt_tokens: row.prompt_tokens,
      completion_tokens: row.completion_tokens,
      reasoning_tokens: row.reasoning_tokens,
      cache_read_tokens: row.cache_read_tokens,
      cache_write_tokens: row.cache_write_tokens,
      uncached_prompt_tokens: row.uncached_prompt_tokens,
      cache_discount_usd: row.cache_discount_usd,
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

interface StoredRunItemPayloadRow {
  run_id: string
  item_id: string
  payload_json: string
}

async function storedRunItemPayload(
  env: Env,
  row: StoredRunItemPayloadRow,
): Promise<Record<string, unknown>> {
  const descriptor = parseRunItemPayloadReference(row.payload_json)
  if (!descriptor) return parseInlineRunItemPayload(row.payload_json)
  const { results } = await env.DB.prepare(
    `SELECT chunk_index, chunk_count, payload_chunk
       FROM benchmark_item_payload_chunks
      WHERE run_id=? AND item_id=? AND payload_sha256=?
      ORDER BY chunk_index`,
  ).bind(row.run_id, row.item_id, descriptor.sha256).all<StoredRunItemPayloadChunk>()
  return reassembleRunItemPayload(descriptor, results ?? [])
}

async function runItems(env: Env, runId: string): Promise<unknown[]> {
  const { results } = await env.DB.prepare(
    `SELECT run_id, item_id, payload_json FROM benchmark_items_v2 WHERE run_id=? ORDER BY sequence`,
  ).bind(runId).all<StoredRunItemPayloadRow>()
  return Promise.all((results ?? []).map((item) => storedRunItemPayload(env, item)))
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

interface CorpusItemRow {
  payload_json: string
  solved?: number
  total?: number
}

/** GET /api/corpora/:track — result-free task definitions for public releases. */
export async function getCorpus(env: Env, track: string): Promise<Response> {
  if (!["standard", "woodpecker", "esoteric"].includes(track)) return error(404, "unknown corpus track")
  const release = await env.DB.prepare(
    `SELECT * FROM corpus_releases WHERE track=? AND visibility='public' AND active=1`,
  ).bind(track).first<Record<string, unknown>>()
  if (!release) return error(404, "corpus not registered")
  const { results } = await env.DB.prepare(
    `SELECT payload_json FROM corpus_items WHERE content_hash=? ORDER BY sequence`,
  ).bind(release.content_hash).all<CorpusItemRow>()
  const metadata = JSON.parse(String(release.metadata_json ?? "{}")) as Record<string, unknown>
  return json({
    schema: "chessbench.public_corpus.v1",
    name: release.name,
    title: release.title,
    version: release.version,
    track: release.track,
    visibility: release.visibility,
    description: release.description,
    content_hash: release.content_hash,
    sources: metadata.sources ?? [],
    validation: metadata.validation ?? {},
    items: (results ?? []).map((row) => JSON.parse(row.payload_json)),
  })
}

/** GET /api/puzzles — immutable positions plus optional model solve aggregates. */
export async function getPuzzles(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `WITH model_stats AS (
       SELECT i.item_id, COUNT(*) AS total, COALESCE(SUM(i.solved), 0) AS solved
         FROM benchmark_items_v2 i
         JOIN benchmark_runs_v2 r USING(run_id)
         JOIN model_variants_v2 v USING(variant_key)
        WHERE r.track='puzzle' AND COALESCE(r.suite_visibility, 'public') <> 'private'
          AND LOWER(v.provider) NOT IN ('stockfish', 'engine', 'baseline', 'oracle', 'random')
          AND LOWER(v.provider_model_id) NOT LIKE 'stockfish%'
        GROUP BY i.item_id
     )
     SELECT c.payload_json, COALESCE(s.total, 0) AS total, COALESCE(s.solved, 0) AS solved
       FROM corpus_items c
       JOIN corpus_releases r USING(content_hash)
       LEFT JOIN model_stats s ON s.item_id=c.item_id
      WHERE r.track='standard' AND r.visibility='public' AND r.active=1
      ORDER BY CAST(json_extract(c.payload_json, '$.rating') AS INTEGER), c.item_id`,
  ).all<CorpusItemRow>()
  const puzzles = (results ?? []).map((r) => {
    const p = JSON.parse(r.payload_json) as Record<string, unknown>
    return { ...p, solved: r.solved ?? 0, total: r.total ?? 0 }
  })
  return json({ puzzles })
}

/** GET /api/puzzles/:id — a position plus how every model answered it. */
export async function getPuzzle(env: Env, id: string): Promise<Response> {
  const corpusItem = await env.DB.prepare(
    `SELECT c.payload_json FROM corpus_items c JOIN corpus_releases r USING(content_hash)
      WHERE c.item_id=? AND r.track='standard' AND r.visibility='public' AND r.active=1`,
  ).bind(id).first<{ payload_json: string }>()
  const ratedPoolItem = corpusItem ? null : await env.DB.prepare(
    `SELECT p.puzzle_id, p.rating, p.rating_deviation, p.popularity, p.plays, p.payload_json
       FROM rated_puzzles p
       JOIN rated_puzzle_pools pool USING(content_hash)
      WHERE p.puzzle_id=? AND pool.active=1
      ORDER BY pool.updated_at DESC LIMIT 1`,
  ).bind(id).first<RatedPuzzleMetadata & { payload_json: string }>()
  const { results } = await env.DB.prepare(
    `SELECT i.run_id, i.item_id, r.variant_key, r.condition_slug, i.solved, i.points,
            i.first_move_legal, i.failure_reason, i.payload_json,
            v.base_model, v.display_name, v.provider, v.provider_model_id,
            v.reasoning_json, v.max_output_tokens
       FROM benchmark_items_v2 i JOIN benchmark_runs_v2 r USING(run_id)
       JOIN model_variants_v2 v USING(variant_key)
      WHERE i.item_id=? AND r.track='puzzle'
        AND COALESCE(r.suite_visibility, 'public') <> 'private'
        AND LOWER(v.provider) NOT IN ('stockfish', 'engine', 'baseline', 'oracle', 'random')
        AND LOWER(v.provider_model_id) NOT LIKE 'stockfish%'
      ORDER BY i.solved DESC, r.variant_key ASC`,
  ).bind(id).all<{
    run_id: string; item_id: string; variant_key: string; condition_slug: string; solved: number; points: number
    first_move_legal: number; failure_reason: string | null; payload_json: string
    base_model: string; display_name: string; provider: string; provider_model_id: string
    reasoning_json: string; max_output_tokens: number
  }>()
  const rows = results ?? []
  const payloads = await Promise.all(rows.map((row) => storedRunItemPayload(env, row)))
  if (!corpusItem && !ratedPoolItem && !payloads.length) return error(404, "puzzle not found")
  // Adaptive-pool positions are not duplicated into the small browsable
  // corpus. Prefer their active-pool payload, then fall back to a published
  // run item from older deployments where only run payloads were available.
  const position = corpusItem
    ? JSON.parse(corpusItem.payload_json) as Record<string, unknown>
    : ratedPoolItem
      ? ratedPuzzlePosition(
          JSON.parse(ratedPoolItem.payload_json) as Record<string, unknown>,
          ratedPoolItem,
        )
      : payloads[0]
  const answers = rows.map((a, index) => ({
    ...payloads[index], run_id: a.run_id, model: a.provider_model_id,
    model_variant: {
      key: a.variant_key,
      base_key: a.base_model,
      display_name: a.display_name,
      provider: a.provider,
      model_id: a.provider_model_id,
      reasoning: JSON.parse(a.reasoning_json),
      max_output_tokens: a.max_output_tokens,
    },
    condition: a.condition_slug,
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
  const responseStyle = url.searchParams.get("response_style")
  const suite = url.searchParams.get("suite")
  const mode = url.searchParams.get("mode")
  const puzzle = url.searchParams.get("puzzle")
  const tournament = url.searchParams.get("tournament")
  const wantsPrivate = url.searchParams.get("include_private") === "1"
  const allowedTracks = new Set(["puzzle", "woodpecker", "esoteric", "game"])
  const allowedStatuses = new Set(["queued", "running", "partial", "completed", "failed"])
  const allowedResponseStyles = new Set(["move_only", "json_rationale"])
  const allowedModes = new Set(["1", "2", "3", "4", "5"])
  if (track && !allowedTracks.has(track)) return error(400, "invalid track filter")
  if (status && !allowedStatuses.has(status)) return error(400, "invalid status filter")
  if (responseStyle && !allowedResponseStyles.has(responseStyle)) {
    return error(400, "invalid response_style filter")
  }
  if (mode && !allowedModes.has(mode)) return error(400, "invalid mode filter")
  if (wantsPrivate && !authorized(env, req)) return error(401, "owner authorization required")

  const clauses: string[] = []
  const binds: Array<string | number> = []
  if (track) { clauses.push("r.track=?"); binds.push(track) }
  if (model) { clauses.push("r.variant_key=?"); binds.push(model) }
  if (runId) { clauses.push("r.run_id=?"); binds.push(runId) }
  if (status) { clauses.push("r.status=?"); binds.push(status) }
  if (suite) { clauses.push("r.suite_name=?"); binds.push(suite) }
  if (mode === "1") clauses.push("json_extract(r.condition_json, '$.legality')='free_form' AND json_extract(r.condition_json, '$.puzzle_protocol')='move_by_move'")
  if (mode === "2") clauses.push("json_extract(r.condition_json, '$.legality')='legal_list' AND json_extract(r.condition_json, '$.prompt_style')='minimal' AND json_extract(r.condition_json, '$.puzzle_protocol')='move_by_move'")
  if (mode === "3") clauses.push("json_extract(r.condition_json, '$.legality')='legal_list' AND json_extract(r.condition_json, '$.prompt_style')='coached' AND json_extract(r.condition_json, '$.puzzle_protocol')='move_by_move'")
  if (mode === "4") clauses.push("json_extract(r.condition_json, '$.puzzle_protocol')='full_line'")
  if (mode === "5") clauses.push("json_extract(r.condition_json, '$.legality')='legal_list' AND json_extract(r.condition_json, '$.prompt_style')='deep_coached' AND json_extract(r.condition_json, '$.puzzle_protocol')='move_by_move'")
  if (tournament) clauses.push("1=0")
  if (responseStyle) {
    clauses.push(
      "COALESCE(CAST(json_extract(r.condition_json, '$.explain') AS INTEGER), " +
      "CASE WHEN r.condition_slug LIKE '%__json-rationale__%' THEN 1 ELSE 0 END)=?",
    )
    binds.push(responseStyle === "json_rationale" ? 1 : 0)
  }
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""
  const stmt = env.DB.prepare(`${RUN_SELECT}${where} ORDER BY r.created_at DESC`)
  const { results } = await stmt.bind(...binds).all<RunRow>()
  const rows = results ?? []
  const runs = await Promise.all(rows.map(async (row) => {
    const ownerAccess = isPrivateSuite(row) && wantsPrivate
    const allItems = !isPrivateSuite(row) || ownerAccess ? await runItems(env, row.run_id) : []
    const items = puzzle ? allItems.filter((item) => (item as { puzzle_id?: string }).puzzle_id === puzzle) : allItems
    return { ...publicRun(row), disclosure: disclosure(row, ownerAccess), items }
  }))

  const includeGames = Boolean(tournament) || includesTournaments({ track, model, runId, status })
  let tournaments: unknown[] = []
  if (includeGames) {
    const tournamentClauses: string[] = []
    const tournamentBinds: string[] = []
    if (responseStyle) {
      tournamentClauses.push("condition_slug LIKE ?")
      tournamentBinds.push(responseStyle === "json_rationale" ? "%__json-rationale__%" : "%__plain-text-v1__%")
    }
    if (tournament) {
      tournamentClauses.push("tid=?")
      tournamentBinds.push(tournament)
    }
    const tournamentFilter = tournamentClauses.length ? ` WHERE ${tournamentClauses.join(" AND ")}` : ""
    const tournamentStatement = env.DB.prepare(
      `SELECT doc_json FROM tournaments${tournamentFilter} ORDER BY created DESC`,
    )
    const { results: docs } = tournamentBinds.length
      ? await tournamentStatement.bind(...tournamentBinds).all<{ doc_json: string }>()
      : await tournamentStatement.all<{ doc_json: string }>()
    tournaments = (docs ?? []).map((row) => JSON.parse(row.doc_json))
  }
  const stamp = new Date().toISOString()
  const suffix = [track, model, runId, status, responseStyle, suite, mode ? `mode-${mode}` : null, puzzle, tournament, wantsPrivate ? "owner" : null]
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
      filters: { track, model, run: runId, status, response_style: responseStyle, suite, mode, puzzle, tournament },
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
