import type { PuzzleItem } from "@/lib/data"

const LN10 = Math.log(10)
const SCALE = 400
const DERIVATIVE = LN10 / SCALE
const PROVISIONAL_CI_WIDTH = 400

export const PUZZLE_ELO_PRIOR = { mean: 1500, sd: 700 } as const

export interface PuzzlePerformanceRating {
  rating: number
  stderr: number
  rating_deviation: number
  ci95: [number, number]
  n: number
  bounded: boolean
  method: "bayesian_elo_v1"
  provisional: boolean
  prior: { mean: number; sd: number }
}

type RatingItem = Pick<PuzzleItem, "rating" | "solved">

function expectedScore(rating: number, puzzleRating: number): number {
  return 1 / (1 + 10 ** ((puzzleRating - rating) / SCALE))
}

function fitPuzzlePerformanceRating(
  items: RatingItem[],
  prior = PUZZLE_ELO_PRIOR,
): PuzzlePerformanceRating {
  const priorPrecision = 1 / prior.sd ** 2
  const gradient = (theta: number) => {
    let value = -(theta - prior.mean) * priorPrecision
    for (const item of items) {
      value += DERIVATIVE * ((item.solved ? 1 : 0) - expectedScore(theta, item.rating))
    }
    return value
  }

  let low = prior.mean - prior.sd * 10
  let high = prior.mean + prior.sd * 10
  for (let iteration = 0; iteration < 200 && high - low >= 0.0001; iteration += 1) {
    const midpoint = (low + high) / 2
    if (gradient(midpoint) > 0) low = midpoint
    else high = midpoint
  }
  const rating = items.length ? (low + high) / 2 : prior.mean
  let information = priorPrecision
  for (const item of items) {
    const expected = expectedScore(rating, item.rating)
    information += DERIVATIVE ** 2 * expected * (1 - expected)
  }
  const ratingDeviation = 1 / Math.sqrt(information)
  const ci95: [number, number] = [
    rating - 1.96 * ratingDeviation,
    rating + 1.96 * ratingDeviation,
  ]
  return {
    rating,
    stderr: ratingDeviation,
    rating_deviation: ratingDeviation,
    ci95,
    n: items.length,
    bounded: items.length > 0,
    method: "bayesian_elo_v1",
    provisional: ci95[1] - ci95[0] > PROVISIONAL_CI_WIDTH,
    prior: { ...prior },
  }
}

/** Same frozen-prior Bayesian Elo estimator as chessbench.rating.puzzle_elo. */
export function puzzlePerformanceRating(
  items: RatingItem[],
  prior = PUZZLE_ELO_PRIOR,
): PuzzlePerformanceRating {
  return fitPuzzlePerformanceRating(
    items.filter((item) => Number.isFinite(item.rating)),
    prior,
  )
}

/** Bayesian Puzzle Elo after every prefix, finite from the first valid item. */
export function puzzlePerformanceTrajectory(
  items: RatingItem[],
  prior = PUZZLE_ELO_PRIOR,
): PuzzlePerformanceRating[] {
  const valid: RatingItem[] = []
  return items.map((item) => {
    if (Number.isFinite(item.rating)) valid.push(item)
    return fitPuzzlePerformanceRating(valid, prior)
  })
}
