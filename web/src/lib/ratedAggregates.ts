import type { RatedSessionProtocol, RunIndexEntry } from "@/lib/data"

export interface RatedRunAggregate {
  key: string
  runs: Array<RunIndexEntry & { protocol: RatedSessionProtocol }>
  ratingRuns: Array<RunIndexEntry & { protocol: RatedSessionProtocol }>
  completedRuns: Array<RunIndexEntry & { protocol: RatedSessionProtocol }>
  settledRuns: Array<RunIndexEntry & { protocol: RatedSessionProtocol }>
  representative: RunIndexEntry & { protocol: RatedSessionProtocol }
  meanRating: number | null
  meanRatingDeviation: number | null
  runStandardDeviation: number | null
  solved: number
  attempted: number
  cost: number
  modelMoves: number
}

function estimate(run: RunIndexEntry) {
  return run.summary.puzzle_performance_rating
}

function aggregateKey(run: RunIndexEntry & { protocol: RatedSessionProtocol }) {
  return [
    run.model_variant.key,
    run.protocol.pool.content_hash,
    run.protocol.version,
    run.protocol.prompt.version,
  ].join("::")
}

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function sampleStandardDeviation(values: number[]) {
  if (values.length < 2) return null
  const average = mean(values)
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

/** Group independent adaptive seeds without hiding their individual paths. */
export function aggregateRatedRuns(
  runs: Array<RunIndexEntry & { protocol: RatedSessionProtocol }>,
): RatedRunAggregate[] {
  const groups = new Map<string, Array<RunIndexEntry & { protocol: RatedSessionProtocol }>>()
  runs.forEach((run) => {
    const key = aggregateKey(run)
    const group = groups.get(key)
    if (group) group.push(run)
    else groups.set(key, [run])
  })

  return Array.from(groups, ([key, groupedRuns]) => {
    const ordered = groupedRuns.toSorted((a, b) =>
      a.protocol.selection.seed - b.protocol.selection.seed || a.run_id.localeCompare(b.run_id),
    )
    const completedRuns = ordered.filter((run) => run.status === "completed" && estimate(run))
    const settledRuns = completedRuns.filter((run) => estimate(run)?.settled)
    const visibleRuns = ordered.filter((run) => run.status !== "failed")
    // A single session is a valid headline result. When additional sessions
    // exist, include every current estimate so the leaderboard stays live and
    // the aggregate improves naturally without requiring replication.
    const ratingRuns = ordered.filter((run) => run.status !== "failed" && estimate(run))
    const ratings = ratingRuns.flatMap((run) => {
      const value = estimate(run)?.rating
      return value == null ? [] : [value]
    })
    const deviations = ratingRuns.flatMap((run) => {
      const value = estimate(run)?.rating_deviation
      return value == null ? [] : [value]
    })
    const representative = ordered.toSorted((a, b) =>
      Number(b.status === "completed") - Number(a.status === "completed")
      || (b.updated_at ?? b.created).localeCompare(a.updated_at ?? a.created),
    )[0]

    return {
      key,
      runs: ordered,
      ratingRuns,
      completedRuns,
      settledRuns,
      representative,
      meanRating: ratings.length > 0 ? mean(ratings) : null,
      meanRatingDeviation: deviations.length > 0 ? mean(deviations) : null,
      runStandardDeviation: sampleStandardDeviation(ratings),
      solved: visibleRuns.reduce((sum, run) => sum + run.summary.solved, 0),
      attempted: visibleRuns.reduce((sum, run) => sum + run.progress.completed, 0),
      cost: ordered.reduce((sum, run) => sum + (run.summary.cost_usd ?? 0), 0),
      modelMoves: visibleRuns.reduce((sum, run) => sum + run.summary.model_moves, 0),
    }
  })
}
