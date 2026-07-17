import type { RunIndexEntry } from "@/lib/data"
import { modeInfo, responseStyleInfo } from "@/lib/format"

export const MAX_COMPARISON_RUNS = 4

export function comparisonSuiteKey(run: RunIndexEntry): string {
  return `${run.track}:${run.suite?.content_hash ?? run.suite?.name ?? "unspecified"}`
}

export function comparisonRunLabel(run: RunIndexEntry): string {
  const mode = modeInfo(run.condition)
  const method = mode ? `${mode.displayN}. ${mode.name}` : "Special protocol"
  return `${run.model_variant.display_name} · ${method} · ${responseStyleInfo(run.condition).label}`
}

export function normalizeComparisonIds(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))].slice(0, MAX_COMPARISON_RUNS)
}

export function comparisonPath(ids: string[]): string {
  const params = new URLSearchParams()
  normalizeComparisonIds(ids).forEach((id) => params.append("run", id))
  return `/compare${params.size ? `?${params.toString()}` : ""}`
}
