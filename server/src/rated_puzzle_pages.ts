export interface RatedPuzzlePageParams {
  page: number
  perPage: number
}

export const DEFAULT_RATED_PUZZLE_PAGE_SIZE = 100
export const MAX_RATED_PUZZLE_PAGE_SIZE = 200
export const MAX_RATED_PUZZLE_PAGE = 100_000

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

export function ratedPuzzlePageParams(params: URLSearchParams): RatedPuzzlePageParams | null {
  const page = integerParam(params, "page", 1, 1, MAX_RATED_PUZZLE_PAGE)
  const perPage = integerParam(
    params,
    "per_page",
    DEFAULT_RATED_PUZZLE_PAGE_SIZE,
    1,
    MAX_RATED_PUZZLE_PAGE_SIZE,
  )
  return page == null || perPage == null ? null : { page, perPage }
}
