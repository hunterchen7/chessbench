import type { RunSummary, Condition } from "./data"

export const pct = (x: number) => (x * 100).toFixed(1) + "%"

export const pointsText = (summary: RunSummary) =>
  `${Number.isInteger(summary.points) ? summary.points.toFixed(0) : summary.points.toFixed(2)}/${summary.max_points}`

export const TIER_ORDER = ["beginner", "novice", "intermediate", "advanced", "expert", "master"]

const CONDITION_LABEL: Record<string, string> = {
  free_form: "Free-form",
  legal_list: "Legal list",
  retry: "Retry",
  otb: "OTB",
}
export const modeLabel = (c: Condition) => CONDITION_LABEL[c.legality] ?? c.slug

export type ResponseStyleKey = "json_rationale" | "move_only"

export interface ResponseStyleInfo {
  key: ResponseStyleKey
  label: string
  shortLabel: string
  protocol: string
  description: string
}

export const RESPONSE_STYLES: readonly ResponseStyleInfo[] = [
  {
    key: "json_rationale",
    label: "Rationale",
    shortLabel: "Rationale",
    protocol: "json_rationale",
    description: "A structured move and a concise, visible model-authored rationale.",
  },
  {
    key: "move_only",
    label: "Move only",
    shortLabel: "Move only",
    protocol: "plain_text_v1",
    description: "Only the move or line in plain text; no rationale is requested.",
  },
] as const

export function responseStyleInfo(condition: Condition | string | null | undefined): ResponseStyleInfo {
  const isMoveOnly = typeof condition === "string"
    ? (() => {
        const parts = condition.split("__")
        return parts.includes("plain-text-v1") || !parts.includes("json-rationale")
      })()
    : condition?.explain === false || condition?.response_protocol === "plain_text_v1"
  return RESPONSE_STYLES[isMoveOnly ? 1 : 0]
}

// The 3 named "help" modes (the headline ablation). Reasoning runs and other
// axis combos return null (they're shown separately, not in the mode matrix).
export interface ModeInfo {
  n: 1 | 2 | 3
  name: string
  blurb: string
}
export const MODES: ModeInfo[] = [
  { n: 1, name: "Raw", blurb: "just the position — no legal moves" },
  { n: 2, name: "Assisted", blurb: "legal moves handed in" },
  { n: 3, name: "Coached", blurb: "legal moves + tactical tips" },
]
export function modeInfo(c: Condition): ModeInfo | null {
  if (c.puzzle_protocol === "full_line") return null
  if (c.legality === "free_form" && c.prompt_style === "minimal") return MODES[0]
  if (c.legality === "legal_list" && c.prompt_style === "minimal") return MODES[1]
  if (c.legality === "legal_list" && c.prompt_style === "coached") return MODES[2]
  return null
}

/** Mode from a condition slug (legality__representation__notation__prompt_style[__…]). */
export function modeFromSlug(slug: string | null | undefined): ModeInfo | null {
  if (!slug) return null
  const parts = slug.split("__")
  return modeInfo({ legality: parts[0], prompt_style: parts[3] } as Condition)
}

// A stable color per model family for chart series.
export function familyColor(model: string): string {
  const fam = model.includes("/") ? model.split("/")[0] : model
  let h = 0
  for (const ch of fam) h = (h * 31 + ch.charCodeAt(0)) % 360
  return `oklch(0.65 0.17 ${h})`
}
