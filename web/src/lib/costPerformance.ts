import type { RatedRunAggregate } from "@/lib/ratedAggregates"
import type { RatedSessionProtocol, RunIndexEntry } from "@/lib/data"

export interface CostPerformancePoint {
  key: string
  aggregate: RatedRunAggregate
  representative: RunIndexEntry & { protocol: RatedSessionProtocol }
  rating: number
  ratingDeviation: number
  costPerPuzzle: number
  totalCost: number
  attempts: number
  solved: number
  runCount: number
}

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function isSettledEquivalent(run: RunIndexEntry & { protocol: RatedSessionProtocol }) {
  return run.termination?.kind === "maximum_puzzles"
    || run.termination?.kind === "operator_rounded"
    || run.progress.completed >= run.protocol.stopping.maximum_puzzles
}

/** Build comparable dots from complete sessions. Partial runs never affect the chart. */
export function costPerformancePoints(aggregates: RatedRunAggregate[]): CostPerformancePoint[] {
  return aggregates.flatMap((aggregate) => {
    const complete = aggregate.completedRuns.filter((run) => {
      const estimate = run.summary.puzzle_performance_rating
      return run.progress.completed > 0
        && estimate?.rating != null
        && (estimate.settled === true || isSettledEquivalent(run))
        && (run.summary.cost_usd ?? 0) > 0
    })
    if (complete.length === 0) return []

    const attempts = complete.reduce((sum, run) => sum + run.progress.completed, 0)
    const totalCost = complete.reduce((sum, run) => sum + (run.summary.cost_usd ?? 0), 0)
    const ratings = complete.map((run) => run.summary.puzzle_performance_rating!.rating)
    const deviations = complete.flatMap((run) => {
      const value = run.summary.puzzle_performance_rating?.rating_deviation
      return value == null ? [] : [value]
    })
    const representative = complete.toSorted((a, b) =>
      (b.completed_at ?? b.updated_at ?? b.created).localeCompare(a.completed_at ?? a.updated_at ?? a.created),
    )[0]
    return [{
      key: aggregate.key,
      aggregate,
      representative,
      rating: mean(ratings),
      ratingDeviation: deviations.length > 0 ? mean(deviations) : 0,
      costPerPuzzle: totalCost / attempts,
      totalCost,
      attempts,
      solved: complete.reduce((sum, run) => sum + run.summary.solved, 0),
      runCount: complete.length,
    }]
  }).toSorted((a, b) => a.costPerPuzzle - b.costPerPuzzle || b.rating - a.rating)
}
