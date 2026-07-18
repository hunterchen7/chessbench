export interface AdaptiveSolverRatingSnapshot {
  rating: number
  ratingDeviation: number
}

/** The post-puzzle snapshot includes every attempt through its zero-based sequence. */
export function adaptiveRatingSampleCount(sequence: number): number {
  return Math.max(0, Math.trunc(sequence) + 1)
}

/** Read the live solver estimate carried by an adaptive puzzle result. */
export function adaptiveSolverRatingSnapshot(
  payload: Record<string, unknown>,
): AdaptiveSolverRatingSnapshot | null {
  const value = payload.solver_rating_after
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const rating = Number((value as Record<string, unknown>).rating)
  const ratingDeviation = Number((value as Record<string, unknown>).rating_deviation)
  if (!Number.isFinite(rating) || !Number.isFinite(ratingDeviation) || ratingDeviation < 0) return null
  return { rating, ratingDeviation }
}
