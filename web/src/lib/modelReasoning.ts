import type { ModelVariant } from "@/lib/data"

const PROVIDER_REASONING_DEFAULTS: Record<string, string> = {
  "google/gemini-3.1-flash-lite": "minimal",
  "google/gemini-3.5-flash": "none",
  "inception/mercury-2": "medium",
  "mistralai/mistral-small-2603": "none",
}

// OpenRouter accepts the gateway-wide `minimal` value for every request, but
// maps it to the nearest effort supported by the selected model. Keep these
// aliases model-specific so models with a native minimal tier (for example,
// Gemini 3.1 Flash Lite) remain distinct.
const PROVIDER_REASONING_EQUIVALENTS: Record<string, Record<string, string>> = {
  "openai/gpt-5.6-luna": { minimal: "low" },
}

function equivalentEffort(modelId: string, effort: string) {
  return PROVIDER_REASONING_EQUIVALENTS[modelId]?.[effort] ?? effort
}

export function effectiveReasoningEffort(variant: ModelVariant): string {
  const { effort, max_tokens: tokens } = variant.reasoning ?? {}
  if (tokens) return "budget"
  if (effort) return equivalentEffort(variant.model_id, effort)
  const providerDefault = PROVIDER_REASONING_DEFAULTS[variant.model_id]
  return providerDefault ? equivalentEffort(variant.model_id, providerDefault) : "provider"
}

/**
 * Collapse a known provider default onto the equivalent explicit effort.
 * Exact token budgets remain distinct, and unknown provider defaults do not
 * get guessed into an explicit configuration.
 */
export function equivalentReasoningKey(variant: ModelVariant): string {
  const { effort, max_tokens: tokens } = variant.reasoning ?? {}
  if (tokens) return `tokens:${tokens}`
  const configuredEffort = effort || PROVIDER_REASONING_DEFAULTS[variant.model_id]
  return configuredEffort
    ? `effort:${equivalentEffort(variant.model_id, configuredEffort)}`
    : "provider"
}

/** Preserve whether reasoning was explicitly requested or left to the provider. */
export function reasoningConfigurationEffort(variant: ModelVariant): string {
  const { effort, max_tokens: tokens } = variant.reasoning ?? {}
  if (tokens) return "budget"
  return effort || "provider"
}

export function reasoningEffortLabel(effort: string): string {
  if (effort === "none") return "Reasoning off"
  if (effort === "provider") return "Provider default"
  if (effort === "budget") return "Token budget"
  return `${effort[0].toUpperCase()}${effort.slice(1)} reasoning`
}

export function reasoningLabel(variant: ModelVariant): string {
  const { effort, max_tokens: tokens } = variant.reasoning ?? {}
  if (tokens) return `${tokens >= 1000 ? `${(tokens / 1000).toFixed(tokens % 1000 ? 1 : 0)}k` : tokens} think`
  if (!effort) {
    const providerEffort = PROVIDER_REASONING_DEFAULTS[variant.model_id]
    if (providerEffort === "none") return "default · no think"
    if (providerEffort) return `default · ${providerEffort} think`
    return "provider default"
  }
  const effectiveEffort = effort
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
