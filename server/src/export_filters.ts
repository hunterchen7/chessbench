export interface ExportFilters {
  track: string | null
  model: string | null
  runId: string | null
  status: string | null
}

/**
 * Tournament documents belong in an explicit game export or an unscoped global
 * snapshot. Run-table filters cannot be applied faithfully to tournament docs,
 * so silently appending every tournament would make a filtered export misleading.
 */
export function includesTournaments(filters: ExportFilters): boolean {
  return filters.track === "game" || (
    filters.track === null &&
    filters.model === null &&
    filters.runId === null &&
    filters.status === null
  )
}
