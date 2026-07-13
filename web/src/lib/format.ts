import type { RunSummary, Condition } from "./data"

export const pct = (x: number) => (x * 100).toFixed(1) + "%"

export const TIER_ORDER = ["beginner", "novice", "intermediate", "advanced", "expert", "master"]

export function eloText(s: RunSummary): { value: string; ci?: string } {
  if (!s.puzzle_elo_bounded) return { value: (s.puzzle_elo >= 2000 ? "≥" : "≤") + s.puzzle_elo.toFixed(0) }
  const [lo, hi] = s.puzzle_elo_ci
  if (typeof lo === "number" && typeof hi === "number")
    return { value: s.puzzle_elo.toFixed(0), ci: "±" + ((hi - lo) / 2).toFixed(0) }
  return { value: s.puzzle_elo.toFixed(0) }
}

const CONDITION_LABEL: Record<string, string> = {
  free_form: "Free-form",
  legal_list: "Legal list",
  retry: "Retry",
  otb: "OTB",
}
export const modeLabel = (c: Condition) => CONDITION_LABEL[c.legality] ?? c.slug

// A stable color per model family for chart series.
export function familyColor(model: string): string {
  const fam = model.includes("/") ? model.split("/")[0] : model
  let h = 0
  for (const ch of fam) h = (h * 31 + ch.charCodeAt(0)) % 360
  return `oklch(0.65 0.17 ${h})`
}
