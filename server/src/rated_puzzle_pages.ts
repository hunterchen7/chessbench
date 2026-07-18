export interface RatedPuzzlePageParams {
  page: number
  perPage: number
  sort: RatedPuzzleSort
  direction: RatedPuzzleDirection
  tier: RatedPuzzleTier | null
  theme: string | null
  idPrefix: string | null
  minRating: number | null
  maxRating: number | null
  includeTotal: boolean
}

export const RATED_PUZZLE_SORTS = ["rating", "rating_deviation", "popularity", "plays", "puzzle_id"] as const
export const RATED_PUZZLE_DIRECTIONS = ["asc", "desc"] as const
export const RATED_PUZZLE_TIERS = ["beginner", "novice", "intermediate", "advanced", "expert", "master"] as const
export type RatedPuzzleSort = typeof RATED_PUZZLE_SORTS[number]
export type RatedPuzzleDirection = typeof RATED_PUZZLE_DIRECTIONS[number]
export type RatedPuzzleTier = typeof RATED_PUZZLE_TIERS[number]

export const DEFAULT_RATED_PUZZLE_PAGE_SIZE = 10_000
export const MAX_RATED_PUZZLE_PAGE_SIZE = 10_000
export const MAX_RATED_PUZZLE_PAGE = 100_000

const TIER_BOUNDS: Record<RatedPuzzleTier, readonly [number, number]> = {
  beginner: [0, 999],
  novice: [1000, 1399],
  intermediate: [1400, 1799],
  advanced: [1800, 2199],
  expert: [2200, 2599],
  master: [2600, 4000],
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

function optionalIntegerParam(
  params: URLSearchParams,
  name: string,
  minimum: number,
  maximum: number,
): number | null | undefined {
  if (!params.has(name) || params.get(name) === "") return undefined
  return integerParam(params, name, minimum, minimum, maximum)
}

export function ratedPuzzleTierBounds(tier: RatedPuzzleTier): readonly [number, number] {
  return TIER_BOUNDS[tier]
}

export function ratedPuzzlePageParams(params: URLSearchParams): RatedPuzzlePageParams | null {
  const page = integerParam(params, "page", 1, 1, MAX_RATED_PUZZLE_PAGE)
  const perPage = integerParam(
    params,
    "per_page",
    DEFAULT_RATED_PUZZLE_PAGE_SIZE,
    1,
    MAX_RATED_PUZZLE_PAGE_SIZE,
  )
  const sortRaw = params.get("sort") ?? "rating"
  const directionRaw = params.get("direction") ?? "asc"
  const tierRaw = params.get("tier")?.trim() || null
  const theme = params.get("theme")?.trim() || null
  const idPrefix = params.get("id_prefix")?.trim() || null
  const minRating = optionalIntegerParam(params, "min_rating", 0, 4000)
  const maxRating = optionalIntegerParam(params, "max_rating", 0, 4000)
  const includeTotalRaw = params.get("include_total") ?? "1"

  if (
    page == null || perPage == null ||
    !RATED_PUZZLE_SORTS.includes(sortRaw as RatedPuzzleSort) ||
    !RATED_PUZZLE_DIRECTIONS.includes(directionRaw as RatedPuzzleDirection) ||
    (tierRaw != null && !RATED_PUZZLE_TIERS.includes(tierRaw as RatedPuzzleTier)) ||
    (theme != null && !/^[A-Za-z0-9_-]{1,80}$/.test(theme)) ||
    (idPrefix != null && !/^[A-Za-z0-9_-]{1,32}$/.test(idPrefix)) ||
    minRating === null || maxRating === null ||
    !["0", "1"].includes(includeTotalRaw) ||
    (minRating != null && maxRating != null && minRating > maxRating)
  ) return null

  return {
    page,
    perPage,
    sort: sortRaw as RatedPuzzleSort,
    direction: directionRaw as RatedPuzzleDirection,
    tier: tierRaw as RatedPuzzleTier | null,
    theme,
    idPrefix,
    minRating: minRating ?? null,
    maxRating: maxRating ?? null,
    includeTotal: includeTotalRaw === "1",
  }
}
