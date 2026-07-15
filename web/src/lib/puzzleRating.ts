import type { PuzzleItem } from "@/lib/data"

const LN10 = Math.log(10)
const SCALE = 400
const DERIVATIVE = LN10 / SCALE

export interface PuzzlePerformanceRating {
  rating: number
  stderr: number | null
  ci95: [number, number] | null
  n: number
  bounded: boolean
}

function expectedScore(rating: number, puzzleRating: number): number {
  return 1 / (1 + 10 ** ((puzzleRating - rating) / SCALE))
}

/** Same complete-solve MLE as chessbench.rating.puzzle_elo. */
export function puzzlePerformanceRating(
  items: Pick<PuzzleItem, "rating" | "solved">[],
  lo = 0,
  hi = 4000,
): PuzzlePerformanceRating {
  const valid = items.filter((item) => Number.isFinite(item.rating))
  const n = valid.length
  const solved = valid.filter((item) => item.solved).length
  if (!n || solved === 0) return { rating: lo, stderr: null, ci95: null, n, bounded: false }
  if (solved === n) return { rating: hi, stderr: null, ci95: null, n, bounded: false }

  const gradient = (theta: number) => valid.reduce(
    (sum, item) => sum + (item.solved ? 1 : 0) - expectedScore(theta, item.rating),
    0,
  )
  let a = lo
  let b = hi
  for (let i = 0; i < 200 && b - a >= 0.0001; i += 1) {
    const mid = (a + b) / 2
    if (gradient(mid) > 0) a = mid
    else b = mid
  }
  const rating = (a + b) / 2
  const information = valid.reduce((sum, item) => {
    const expected = expectedScore(rating, item.rating)
    return sum + DERIVATIVE ** 2 * expected * (1 - expected)
  }, 0)
  const stderr = information > 0 ? 1 / Math.sqrt(information) : null
  return {
    rating,
    stderr,
    ci95: stderr == null ? null : [rating - 1.96 * stderr, rating + 1.96 * stderr],
    n,
    bounded: stderr != null,
  }
}
