import type { RatedRunAggregate } from "@/lib/ratedAggregates"
import type { RatedSessionProtocol, RunIndexEntry } from "@/lib/data"
import { equivalentReasoningKey } from "@/lib/modelReasoning"

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

function equivalentPointKey(aggregate: RatedRunAggregate) {
  const { model_variant: variant, protocol } = aggregate.representative
  return JSON.stringify({
    variant: {
      baseKey: variant.base_key,
      provider: variant.provider,
      modelId: variant.model_id,
      reasoning: equivalentReasoningKey(variant),
      reasoningExcluded: variant.reasoning?.exclude ?? false,
      maxOutputTokens: variant.max_output_tokens,
      providerRoute: variant.provider_route ?? null,
    },
    pool: protocol.pool.content_hash,
    protocol: protocol.version,
    prompt: protocol.prompt.version,
  })
}

/**
 * Build comparable dots from complete sessions. Partial runs never affect the
 * chart. Known provider defaults share a dot with the equivalent explicit
 * effort, while the underlying runs remain independently inspectable.
 */
export function costPerformancePoints(aggregates: RatedRunAggregate[]): CostPerformancePoint[] {
  const groups = new Map<string, RatedRunAggregate[]>()
  aggregates.forEach((aggregate) => {
    const key = equivalentPointKey(aggregate)
    const group = groups.get(key)
    if (group) group.push(aggregate)
    else groups.set(key, [aggregate])
  })

  return Array.from(groups, ([key, groupedAggregates]) => {
    const complete = groupedAggregates.flatMap((aggregate) => aggregate.completedRuns).filter((run) => {
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
    const aggregate = groupedAggregates.find((candidate) => candidate.runs.includes(representative))
      ?? groupedAggregates[0]
    return [{
      key,
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
  }).flat().toSorted((a, b) => a.costPerPuzzle - b.costPerPuzzle || b.rating - a.rating)
}
