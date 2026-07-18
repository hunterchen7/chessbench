export function acceptsRoundedRatedCompletion(input: {
  requested: string
  protocolKind: unknown
  termination: Record<string, unknown> | undefined
  suppliedRating: Record<string, unknown> | undefined
  completedItems: number
  totalItems: number
  minimumPuzzles: number
  targetDeviation: number
  finalDeviation: number
}): boolean {
  const {
    requested,
    protocolKind,
    termination,
    suppliedRating,
    completedItems,
    totalItems,
    minimumPuzzles,
    targetDeviation,
    finalDeviation,
  } = input
  return requested === "completed" &&
    protocolKind === "adaptive_glicko2" &&
    termination?.kind === "operator_rounded" &&
    Number(termination.attempted) === completedItems &&
    completedItems >= minimumPuzzles &&
    finalDeviation > targetDeviation &&
    finalDeviation < targetDeviation + 0.5 &&
    Number(termination.actual_rating_deviation) === finalDeviation &&
    Number(termination.display_rating_deviation) === Math.round(finalDeviation) &&
    suppliedRating?.accepted_rounded === true &&
    completedItems < totalItems
}
