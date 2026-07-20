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

/** Build comparable dots from settled sessions only. Partial runs never affect the chart. */
export function costPerformancePoints(aggregates: RatedRunAggregate[]): CostPerformancePoint[] {
  return aggregates.flatMap((aggregate) => {
    const settled = aggregate.settledRuns.filter((run) => {
      const estimate = run.summary.puzzle_performance_rating
      return run.progress.completed > 0
        && estimate?.rating != null
        && estimate.settled === true
        && (run.summary.cost_usd ?? 0) > 0
    })
    if (settled.length === 0) return []

    const attempts = settled.reduce((sum, run) => sum + run.progress.completed, 0)
    const totalCost = settled.reduce((sum, run) => sum + (run.summary.cost_usd ?? 0), 0)
    const ratings = settled.map((run) => run.summary.puzzle_performance_rating!.rating)
    const deviations = settled.flatMap((run) => {
      const value = run.summary.puzzle_performance_rating?.rating_deviation
      return value == null ? [] : [value]
    })
    const representative = settled.toSorted((a, b) =>
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
      solved: settled.reduce((sum, run) => sum + run.summary.solved, 0),
      runCount: settled.length,
    }]
  }).toSorted((a, b) => a.costPerPuzzle - b.costPerPuzzle || b.rating - a.rating)
}
