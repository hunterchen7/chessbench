import type { ModelVariant } from "@/lib/data"

const BASELINE_PATTERN = /(^|[\s/@_-])(stockfish|engine|oracle|random|first[-_ ]?legal)([\s/@_(-]|$)/i

export type ParticipantKind = "model" | "engine" | "baseline"

export function participantKind(label: string, provider?: string | null): ParticipantKind {
  const normalizedProvider = provider?.toLowerCase() ?? ""
  if (normalizedProvider.includes("stockfish") || normalizedProvider === "engine") return "engine"
  if (BASELINE_PATTERN.test(label)) return /stockfish|engine/i.test(label) ? "engine" : "baseline"
  if (["baseline", "oracle", "random"].includes(normalizedProvider)) return "baseline"
  return "model"
}

export function isModelVariant(variant: ModelVariant): boolean {
  return participantKind(`${variant.key} ${variant.model_id} ${variant.display_name}`, variant.provider) === "model"
}
