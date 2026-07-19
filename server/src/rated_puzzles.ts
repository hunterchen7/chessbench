import type { Env } from "./types"
import { authorized } from "./auth"
import { error, json } from "./http"
import {
  MAX_RATED_PUZZLE_PAGE,
  MAX_RATED_PUZZLE_PAGE_SIZE,
  ratedPuzzlePageParams,
  ratedPuzzleTierBounds,
  type RatedPuzzlePageParams,
  type RatedPuzzleSort,
} from "./rated_puzzle_pages"
import { ratedPuzzlePosition, ratedPuzzleSummary } from "./puzzle_payloads"
import {
  RATED_SELECTOR_VERSION,
  chooseRatedPuzzleId,
  pythonRound,
} from "./rated_seed_selector"

interface RatedPoolDoc {
  schema: "chessbench.rated_puzzle_pool.v1"
  name: string
  version: string
  content_hash: string
  items: number
  [key: string]: unknown
}

interface RatedPuzzleUpload {
  puzzle_id: string
  rating: number
  rating_deviation: number
  popularity: number
  plays: number
  random_key: number
  tags: string[]
  payload: Record<string, unknown>
}

interface RatedPuzzleRow {
  puzzle_id: string
  rating: number
  rating_deviation: number
  popularity: number
  plays: number
  payload_json: string
}

interface RatedPoolRow {
  content_hash: string
  name: string
  version: string
  item_count: number
}

const RATED_BROWSE_SORT_COLUMNS: Record<RatedPuzzleSort, string> = {
  rating: "p.rating",
  rating_deviation: "p.rating_deviation",
  popularity: "p.popularity",
  plays: "p.plays",
  puzzle_id: "p.puzzle_id",
}

const PROFILE_FAMILIES = new Set([
  "mate",
  "defense",
  "quiet_moves",
  "pawn_play",
  "endgames",
  "sacrifices",
  "forks",
  "pins_and_skewers",
  "deflection_and_removal",
  "discovered_attacks",
  "king_attacks",
  "material_and_tempo",
])

const now = () => new Date().toISOString()

async function batchChunked(env: Env, statements: D1PreparedStatement[], size = 40): Promise<void> {
  for (let index = 0; index < statements.length; index += size) {
    await env.DB.batch(statements.slice(index, index + size))
  }
}

function integerParam(
  params: URLSearchParams,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number | null {
  const raw = params.get(name)
  if (raw == null || raw === "") return fallback
  if (!/^-?\d+$/.test(raw)) return null
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : null
}

function normalizedCategory(raw: string | null): string | null {
  const value = raw?.trim() ?? ""
  if (!value) return null
  if (!/^[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)?$/.test(value) || value.length > 80) return ""
  if (value.includes(":")) return value
  return PROFILE_FAMILIES.has(value) ? `family:${value}` : `theme:${value}`
}

function randomUint32(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]
}

async function selectRatedPuzzle(
  env: Env,
  poolHash: string,
  category: string | null,
  minRating: number,
  maxRating: number,
  pivot: number,
  excluded: string[],
): Promise<RatedPuzzleRow | null> {
  const alias = category ? "t" : "p"
  const from = category
    ? "rated_puzzle_tags t JOIN rated_puzzles p USING(content_hash, puzzle_id)"
    : "rated_puzzles p"
  const exclusions = excluded.length
    ? ` AND p.puzzle_id NOT IN (${excluded.map(() => "?").join(",")})`
    : ""

  const run = async (operator: ">=" | "<") => {
    const categoryClause = category ? " AND t.tag=?" : ""
    const sql = `SELECT p.puzzle_id, p.rating, p.rating_deviation, p.popularity,
                        p.plays, p.payload_json
                   FROM ${from}
                  WHERE p.content_hash=?${categoryClause}
                    AND ${alias}.rating BETWEEN ? AND ?
                    AND ${alias}.random_key ${operator} ?${exclusions}
                  ORDER BY ${alias}.random_key ASC
                  LIMIT 1`
    const bindings: Array<string | number> = [poolHash]
    if (category) bindings.push(category)
    bindings.push(minRating, maxRating, pivot, ...excluded)
    return env.DB.prepare(sql).bind(...bindings).first<RatedPuzzleRow>()
  }

  return (await run(">=")) ?? await run("<")
}

/** GET /api/puzzles/rated — one stable rating-ordered page from the active pool. */
export async function getRatedPuzzlePage(env: Env, url: URL): Promise<Response> {
  const query = ratedPuzzlePageParams(url.searchParams)
  if (!query) {
    return error(
      400,
      `invalid rated puzzle query; page must be 1-${MAX_RATED_PUZZLE_PAGE} and per_page 1-${MAX_RATED_PUZZLE_PAGE_SIZE}`,
    )
  }

  const pool = await env.DB.prepare(
    `SELECT content_hash, name, version, item_count, updated_at
       FROM rated_puzzle_pools WHERE active=1 ORDER BY updated_at DESC LIMIT 1`,
  ).first<{
    content_hash: string
    name: string
    version: string
    item_count: number
    updated_at: string
  }>()
  if (!pool) return error(404, "no active rated puzzle pool")

  const from = query.theme
    ? `rated_puzzles p JOIN rated_puzzle_tags t
         ON t.content_hash=p.content_hash AND t.puzzle_id=p.puzzle_id`
    : "rated_puzzles p"
  const where = ["p.content_hash=?"]
  const bindings: Array<string | number> = [pool.content_hash]
  if (query.theme) {
    where.push("t.tag=?")
    bindings.push(`theme:${query.theme}`)
  }
  if (query.idPrefix) {
    where.push("p.puzzle_id LIKE ?")
    bindings.push(`${query.idPrefix}%`)
  }

  let minimumRating = query.minRating
  let maximumRating = query.maxRating
  if (query.tier) {
    const [tierMinimum, tierMaximum] = ratedPuzzleTierBounds(query.tier)
    minimumRating = Math.max(minimumRating ?? tierMinimum, tierMinimum)
    maximumRating = Math.min(maximumRating ?? tierMaximum, tierMaximum)
  }
  if (minimumRating != null) {
    where.push("p.rating>=?")
    bindings.push(minimumRating)
  }
  if (maximumRating != null) {
    where.push("p.rating<=?")
    bindings.push(maximumRating)
  }
  if (minimumRating != null && maximumRating != null && minimumRating > maximumRating) where.push("0")

  const predicate = where.join(" AND ")
  const direction = query.direction.toUpperCase()
  const sortColumn = RATED_BROWSE_SORT_COLUMNS[query.sort]
  const order = query.sort === "puzzle_id"
    ? `${sortColumn} ${direction}`
    : `${sortColumn} ${direction}, p.puzzle_id ${direction}`
  const offset = (query.page - 1) * query.perPage
  const pageStatement = env.DB.prepare(
    `SELECT p.puzzle_id, p.rating, p.rating_deviation, p.popularity, p.plays, p.payload_json
       FROM ${from}
      WHERE ${predicate}
      ORDER BY ${order}
      LIMIT ? OFFSET ?`,
  ).bind(...bindings, query.perPage, offset)
  let totalItems: number | null = null
  let totalPages: number | null = null
  let results: RatedPuzzleRow[]
  if (query.includeTotal) {
    const [countResult, pageResult] = await env.DB.batch([
      env.DB.prepare(`SELECT COUNT(*) AS count FROM ${from} WHERE ${predicate}`).bind(...bindings),
      pageStatement,
    ])
    totalItems = Number((countResult.results[0] as { count?: number } | undefined)?.count ?? 0)
    totalPages = totalItems ? Math.ceil(totalItems / query.perPage) : 0
    if (query.page > Math.max(1, totalPages)) return error(404, "rated puzzle page is out of range")
    results = pageResult.results as unknown as RatedPuzzleRow[]
  } else {
    const pageResult = await pageStatement.all<RatedPuzzleRow>()
    results = pageResult.results ?? []
  }

  const puzzles = (results ?? []).map((row) => ratedPuzzleSummary(
    JSON.parse(row.payload_json) as Record<string, unknown>,
    row,
  ))
  return json({
    schema: "chessbench.rated_puzzle_page.v1",
    pool: {
      name: pool.name,
      version: pool.version,
      content_hash: pool.content_hash,
      items: pool.item_count,
      updated_at: pool.updated_at,
    },
    pagination: {
      page: query.page,
      per_page: query.perPage,
      total_items: totalItems,
      total_pages: totalPages,
      returned: puzzles.length,
      has_previous: query.page > 1,
      has_next: totalPages == null ? puzzles.length === query.perPage : query.page < totalPages,
    },
    query: {
      sort: query.sort,
      direction: query.direction,
      tier: query.tier,
      theme: query.theme,
      id_prefix: query.idPrefix,
      min_rating: query.minRating,
      max_rating: query.maxRating,
    },
    puzzles,
  }, {
    headers: {
      "Cache-Control": "public, max-age=60, stale-while-revalidate=600",
      "ETag": ratedPuzzlePageEtag(pool.content_hash, query),
    },
  })
}

function ratedPuzzlePageEtag(poolHash: string, query: RatedPuzzlePageParams): string {
  const key = [
    poolHash, query.page, query.perPage, query.sort, query.direction, query.tier ?? "",
    query.theme ?? "", query.idPrefix ?? "", query.minRating ?? "", query.maxRating ?? "",
    query.includeTotal ? "total" : "no-total",
  ].join(":")
  return `W/\"${key}\"`
}

/** GET /api/puzzles/random — non-deterministic, indexed adaptive-pool draw. */
export async function getRandomRatedPuzzle(env: Env, url: URL): Promise<Response> {
  const params = url.searchParams
  const category = normalizedCategory(params.get("category"))
  if (category === "") return error(400, "invalid category")

  const hasCenter = params.has("rating") || params.has("radius")
  const hasBounds = params.has("min_rating") || params.has("max_rating")
  if (hasCenter && hasBounds) {
    return error(400, "use rating+radius or min_rating+max_rating, not both")
  }

  let minRating: number | null
  let maxRating: number | null
  if (hasCenter) {
    const center = integerParam(params, "rating", 1500, 0, 4000)
    const radius = integerParam(params, "radius", 200, 0, 2000)
    if (center == null || radius == null) return error(400, "invalid rating or radius")
    minRating = Math.max(0, center - radius)
    maxRating = Math.min(4000, center + radius)
  } else {
    minRating = integerParam(params, "min_rating", 400, 0, 4000)
    maxRating = integerParam(params, "max_rating", 3199, 0, 4000)
    if (minRating == null || maxRating == null) return error(400, "invalid rating bounds")
  }
  if (minRating > maxRating) return error(400, "min_rating must not exceed max_rating")

  const excluded = [...new Set(
    (params.get("exclude") ?? "").split(",").map((value) => value.trim()).filter(Boolean),
  )]
  if (excluded.length > 100 || excluded.some((value) => value.length > 32)) {
    return error(400, "exclude accepts at most 100 puzzle ids")
  }

  const pool = await env.DB.prepare(
    `SELECT content_hash, name, version, item_count
       FROM rated_puzzle_pools WHERE active=1 ORDER BY updated_at DESC LIMIT 1`,
  ).first<{ content_hash: string; name: string; version: string; item_count: number }>()
  if (!pool) return error(404, "no active rated puzzle pool")

  const pivot = randomUint32()
  const selected = await selectRatedPuzzle(
    env,
    pool.content_hash,
    category,
    minRating,
    maxRating,
    pivot,
    excluded,
  )
  if (!selected) return error(404, "no puzzle matches those filters")

  return json({
    schema: "chessbench.rated_puzzle_selection.v1",
    selection_id: crypto.randomUUID(),
    selected_at: new Date().toISOString(),
    pool: {
      name: pool.name,
      version: pool.version,
      content_hash: pool.content_hash,
      items: pool.item_count,
    },
    filters: {
      category,
      min_rating: minRating,
      max_rating: maxRating,
      excluded: excluded.length,
    },
    puzzle: ratedPuzzlePosition(
      JSON.parse(selected.payload_json) as Record<string, unknown>,
      selected,
    ),
  })
}

/** GET /api/puzzles/seeded — the exact deterministic selector used by model benchmarks. */
export async function getSeededRatedPuzzle(env: Env, url: URL): Promise<Response> {
  const params = url.searchParams
  const preview = params.get("preview") === "1"
  const seed = integerParam(params, "seed", 0, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
  const sequence = integerParam(params, "sequence", 0, 0, 100_000)
  const targetRadius = integerParam(params, "target_radius", 100, 0, 2_000)
  const rating = Number(params.get("rating") ?? "1500")
  if (seed == null || sequence == null || targetRadius == null || !Number.isFinite(rating) || rating < 0 || rating > 4000) {
    return error(400, "invalid seed, sequence, target_radius, or rating")
  }

  const requestedPoolHash = params.get("pool_hash")?.trim() || null
  if (requestedPoolHash && (requestedPoolHash.length > 128 || !/^[A-Za-z0-9:_-]+$/.test(requestedPoolHash))) {
    return error(400, "invalid pool_hash")
  }
  const excluded = [...new Set(
    (params.get("exclude") ?? "").split(",").map((value) => value.trim()).filter(Boolean),
  )]
  if (excluded.length > 100 || excluded.some((value) => value.length > 64)) {
    return error(400, "exclude accepts at most 100 puzzle ids")
  }

  const pool = requestedPoolHash
    ? await env.DB.prepare(
      `SELECT content_hash, name, version, item_count
         FROM rated_puzzle_pools WHERE content_hash=? LIMIT 1`,
    ).bind(requestedPoolHash).first<RatedPoolRow>()
    : await env.DB.prepare(
      `SELECT content_hash, name, version, item_count
         FROM rated_puzzle_pools WHERE active=1 ORDER BY updated_at DESC LIMIT 1`,
    ).first<RatedPoolRow>()
  if (!pool) return error(404, requestedPoolHash ? "rated puzzle pool not found" : "no active rated puzzle pool")

  const bounds = await env.DB.prepare(
    `SELECT MIN(rating) AS minimum_rating, MAX(rating) AS maximum_rating
       FROM rated_puzzles WHERE content_hash=?`,
  ).bind(pool.content_hash).first<{ minimum_rating: number | null; maximum_rating: number | null }>()
  if (bounds?.minimum_rating == null || bounds.maximum_rating == null) {
    return error(404, "rated puzzle pool is empty")
  }

  const target = pythonRound(rating)
  let radius = targetRadius
  const step = Math.max(1, targetRadius || 100)
  const maximumRadius = Math.max(
    Math.abs(target - bounds.minimum_rating),
    Math.abs(bounds.maximum_rating - target),
  )
  const exclusions = excluded.length
    ? ` AND puzzle_id NOT IN (${excluded.map(() => "?").join(",")})`
    : ""
  let selectedId: string | null = null
  let eligibleCount = 0
  let minimumRating = target - radius
  let maximumRating = target + radius
  while (radius <= maximumRadius + targetRadius) {
    minimumRating = target - radius
    maximumRating = target + radius
    const candidates = await env.DB.prepare(
      `SELECT puzzle_id FROM rated_puzzles
        WHERE content_hash=? AND rating BETWEEN ? AND ?${exclusions}
        ORDER BY rating ASC, puzzle_id ASC`,
    ).bind(pool.content_hash, minimumRating, maximumRating, ...excluded).all<{ puzzle_id: string }>()
    const puzzleIds = (candidates.results ?? []).map((candidate) => candidate.puzzle_id)
    eligibleCount = puzzleIds.length
    if (puzzleIds.length) {
      selectedId = await chooseRatedPuzzleId(puzzleIds, pool.content_hash, seed, sequence)
      break
    }
    radius += step
  }
  if (!selectedId) return error(404, "rated puzzle pool has no unused puzzle")

  const selected = await env.DB.prepare(
    `SELECT puzzle_id, rating, rating_deviation, popularity, plays, payload_json
       FROM rated_puzzles WHERE content_hash=? AND puzzle_id=? LIMIT 1`,
  ).bind(pool.content_hash, selectedId).first<RatedPuzzleRow>()
  if (!selected) return error(404, "selected rated puzzle was not found")

  return json({
    schema: preview
      ? "chessbench.seeded_rated_puzzle_preview.v1"
      : "chessbench.seeded_rated_puzzle_selection.v1",
    selection_id: crypto.randomUUID(),
    selected_at: new Date().toISOString(),
    pool: {
      name: pool.name,
      version: pool.version,
      content_hash: pool.content_hash,
      items: pool.item_count,
    },
    selection: {
      puzzle_id: selected.puzzle_id,
      sequence,
      target_rating: target,
      minimum_rating: minimumRating,
      maximum_rating: maximumRating,
      radius,
      eligible_count: eligibleCount,
      seed,
      selector_version: RATED_SELECTOR_VERSION,
    },
    puzzle: preview
      ? ratedPuzzleSummary(
          JSON.parse(selected.payload_json) as Record<string, unknown>,
          selected,
        )
      : ratedPuzzlePosition(
          JSON.parse(selected.payload_json) as Record<string, unknown>,
          selected,
        ),
  })
}

/** Begin an idempotent staged upload without disturbing the active old pool. */
export async function postRatedPoolStart(env: Env, req: Request): Promise<Response> {
  if (!authorized(env, req)) return error(401, "unauthorized")
  const doc = await req.json().catch(() => null) as RatedPoolDoc | null
  if (
    !doc || doc.schema !== "chessbench.rated_puzzle_pool.v1" || !doc.name ||
    !doc.version || !doc.content_hash || !Number.isInteger(doc.items) || doc.items < 1
  ) return error(400, "invalid rated pool manifest")

  const existing = await env.DB.prepare(
    `SELECT p.active, p.name, p.version, p.item_count,
            COUNT(i.puzzle_id) AS stored_items
       FROM rated_puzzle_pools p
       LEFT JOIN rated_puzzles i USING(content_hash)
      WHERE p.content_hash=?
      GROUP BY p.content_hash, p.active, p.name, p.version, p.item_count`,
  ).bind(doc.content_hash).first<{
    active: number
    name: string
    version: string
    item_count: number
    stored_items: number
  }>()
  if (
    existing &&
    (existing.name !== doc.name || existing.version !== doc.version || existing.item_count !== doc.items)
  ) return error(409, "content hash already exists with different pool metadata")
  if (existing?.active && Number(existing.stored_items) === doc.items) {
    return json({
      ok: true,
      content_hash: doc.content_hash,
      expected_items: doc.items,
      stored_items: Number(existing.stored_items),
      already_active: true,
    })
  }

  // Preserve an incomplete content-addressed staging pool so interrupted
  // uploads can resume. Item uploads are idempotent and the client replays the
  // final stored batch to repair any request whose response was interrupted.
  if (existing) {
    return json({
      ok: true,
      content_hash: doc.content_hash,
      expected_items: doc.items,
      stored_items: Number(existing.stored_items),
      already_active: false,
      resumed: true,
    })
  }

  const stamp = now()
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO rated_puzzle_pools
       (content_hash, name, version, item_count, metadata_json, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)
       ON CONFLICT(content_hash) DO UPDATE SET
         name=excluded.name, version=excluded.version, item_count=excluded.item_count,
         metadata_json=excluded.metadata_json, updated_at=excluded.updated_at`,
    ).bind(doc.content_hash, doc.name, doc.version, doc.items, JSON.stringify(doc), stamp, stamp),
    env.DB.prepare(`DELETE FROM rated_puzzle_tags WHERE content_hash=?`).bind(doc.content_hash),
    env.DB.prepare(`DELETE FROM rated_puzzles WHERE content_hash=?`).bind(doc.content_hash),
  ])
  return json({
    ok: true,
    content_hash: doc.content_hash,
    expected_items: doc.items,
    stored_items: 0,
    already_active: false,
    resumed: false,
  })
}

/** Upload a bounded idempotent batch into the staging pool. */
export async function postRatedPoolItems(env: Env, req: Request): Promise<Response> {
  if (!authorized(env, req)) return error(401, "unauthorized")
  const doc = await req.json().catch(() => null) as {
    content_hash?: string
    items?: RatedPuzzleUpload[]
  } | null
  if (!doc?.content_hash || !Array.isArray(doc.items) || !doc.items.length || doc.items.length > 250) {
    return error(400, "invalid rated puzzle batch")
  }
  const pool = await env.DB.prepare(
    `SELECT content_hash FROM rated_puzzle_pools WHERE content_hash=?`,
  ).bind(doc.content_hash).first<{ content_hash: string }>()
  if (!pool) return error(404, "rated pool upload has not been started")

  const statements: D1PreparedStatement[] = []
  for (const item of doc.items) {
    if (
      !item?.puzzle_id || !Number.isInteger(item.rating) ||
      !Number.isInteger(item.rating_deviation) || !Number.isInteger(item.popularity) ||
      !Number.isInteger(item.plays) || !Number.isInteger(item.random_key) ||
      item.random_key < 0 || item.random_key > 0xffffffff ||
      !Array.isArray(item.tags) || !item.payload
    ) return error(400, `invalid rated puzzle item: ${item?.puzzle_id ?? "unknown"}`)
    const tags = [...new Set(item.tags)]
    if (tags.length > 40 || tags.some((tag) => !/^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/.test(tag))) {
      return error(400, `invalid tags for rated puzzle ${item.puzzle_id}`)
    }
    statements.push(
      env.DB.prepare(
        `INSERT INTO rated_puzzles
         (content_hash, puzzle_id, rating, rating_deviation, popularity, plays, random_key, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(content_hash, puzzle_id) DO UPDATE SET
           rating=excluded.rating, rating_deviation=excluded.rating_deviation,
           popularity=excluded.popularity, plays=excluded.plays,
           random_key=excluded.random_key, payload_json=excluded.payload_json`,
      ).bind(
        doc.content_hash, item.puzzle_id, item.rating, item.rating_deviation,
        item.popularity, item.plays, item.random_key, JSON.stringify(item.payload),
      ),
      env.DB.prepare(
        `DELETE FROM rated_puzzle_tags WHERE content_hash=? AND puzzle_id=?`,
      ).bind(doc.content_hash, item.puzzle_id),
      ...tags.map((tag) => env.DB.prepare(
        `INSERT INTO rated_puzzle_tags
         (content_hash, puzzle_id, tag, rating, random_key) VALUES (?, ?, ?, ?, ?)`,
      ).bind(doc.content_hash, item.puzzle_id, tag, item.rating, item.random_key)),
    )
  }
  await batchChunked(env, statements)
  return json({ ok: true, content_hash: doc.content_hash, accepted: doc.items.length })
}

/** Verify the staged count, then atomically switch the active pool pointer. */
export async function postRatedPoolFinish(env: Env, req: Request): Promise<Response> {
  if (!authorized(env, req)) return error(401, "unauthorized")
  const doc = await req.json().catch(() => null) as { content_hash?: string } | null
  if (!doc?.content_hash) return error(400, "content_hash is required")
  const pool = await env.DB.prepare(
    `SELECT item_count FROM rated_puzzle_pools WHERE content_hash=?`,
  ).bind(doc.content_hash).first<{ item_count: number }>()
  if (!pool) return error(404, "rated pool upload has not been started")
  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM rated_puzzles WHERE content_hash=?`,
  ).bind(doc.content_hash).first<{ count: number }>()
  const actual = Number(count?.count ?? 0)
  if (actual !== pool.item_count) {
    return error(409, `rated pool is incomplete: ${actual}/${pool.item_count}`)
  }
  const stamp = now()
  await env.DB.batch([
    env.DB.prepare(`UPDATE rated_puzzle_pools SET active=0, updated_at=? WHERE active=1`).bind(stamp),
    env.DB.prepare(
      `UPDATE rated_puzzle_pools SET active=1, updated_at=? WHERE content_hash=?`,
    ).bind(stamp, doc.content_hash),
  ])
  return json({ ok: true, content_hash: doc.content_hash, items: actual, active: true })
}
