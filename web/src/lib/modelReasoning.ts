import type { ModelVariant } from "@/lib/data"

const PROVIDER_REASONING_DEFAULTS: Record<string, string> = {
  "google/gemini-3.1-flash-lite": "minimal",
  "google/gemini-3.5-flash": "none",
  "inception/mercury-2": "medium",
  "mistralai/mistral-small-2603": "none",
}

export function effectiveReasoningEffort(variant: ModelVariant): string {
  const { effort, max_tokens: tokens } = variant.reasoning ?? {}
  if (tokens) return "budget"
  if (effort) return effort
  return PROVIDER_REASONING_DEFAULTS[variant.model_id] ?? "provider"
}

export function reasoningEffortLabel(effort: string): string {
  if (effort === "none") return "Reasoning off"
  if (effort === "provider") return "Provider-selected"
  if (effort === "budget") return "Token budget"
  return `${effort[0].toUpperCase()}${effort.slice(1)} reasoning`
}

export function reasoningLabel(variant: ModelVariant): string {
  const { effort, max_tokens: tokens } = variant.reasoning ?? {}
  if (tokens) return `${tokens >= 1000 ? `${(tokens / 1000).toFixed(tokens % 1000 ? 1 : 0)}k` : tokens} think`
  const effectiveEffort = effort ?? PROVIDER_REASONING_DEFAULTS[variant.model_id]
  if (effectiveEffort && effectiveEffort !== "none") return `${effectiveEffort} think`
  if (effectiveEffort === "none") return "no think"
  return "provider-selected"
}

export function reasoningTitle(variant: ModelVariant): string {
  const { effort, max_tokens: tokens } = variant.reasoning ?? {}
  if (tokens) return `Explicit ${tokens.toLocaleString()}-token reasoning budget`
  if (effort) return effort === "none" ? "Reasoning explicitly disabled" : `Explicitly requested ${effort} reasoning`
  const providerEffort = PROVIDER_REASONING_DEFAULTS[variant.model_id]
  return providerEffort
    ? `No effort was sent; ${variant.model_id} resolves to ${providerEffort} reasoning`
    : "No effort was sent; the provider selected its native reasoning setting"
}
