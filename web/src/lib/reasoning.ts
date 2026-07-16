export interface ReasoningPresentation {
  readableText: string | null
  nativeBlockCount: number
  hiddenBlockCount: number
  signedBlockCount: number
  blockTypes: string[]
}

const HIDDEN_TYPE = /(encrypted|opaque|hidden)/i

function nonEmptyText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function readableFromDetail(detail: Record<string, unknown>): string[] {
  const type = nonEmptyText(detail.type) ?? ""
  if (HIDDEN_TYPE.test(type)) return []

  const values = [
    nonEmptyText(detail.text),
    nonEmptyText(detail.summary),
    nonEmptyText(detail.content),
  ]
  return values.filter((value): value is string => value !== null)
}

/**
 * Separate human-readable reasoning from opaque continuity state without
 * changing the provider-native artifact that remains in the run document.
 */
export function presentReasoning(
  reasoning?: string | null,
  details?: Array<Record<string, unknown>> | null,
): ReasoningPresentation {
  const readable: string[] = []
  const addReadable = (value: string | null) => {
    if (!value) return
    if (readable.some((existing) => existing === value || existing.includes(value))) return
    const contained = readable.findIndex((existing) => value.includes(existing))
    if (contained >= 0) readable.splice(contained, 1)
    readable.push(value)
  }

  addReadable(nonEmptyText(reasoning))

  let hiddenBlockCount = 0
  let signedBlockCount = 0
  const blockTypes = new Set<string>()
  for (const detail of details ?? []) {
    const type = nonEmptyText(detail.type) ?? "unknown"
    blockTypes.add(type)
    const detailText = readableFromDetail(detail)
    detailText.forEach(addReadable)

    const keys = Object.keys(detail)
    const explicitlyHidden = HIDDEN_TYPE.test(type)
      || keys.some((key) => /(encrypted|opaque|hidden)/i.test(key))
    if (explicitlyHidden || detailText.length === 0) hiddenBlockCount += 1
    if (keys.some((key) => /(signature|thought_signature)/i.test(key))) signedBlockCount += 1
  }

  return {
    readableText: readable.length ? readable.join("\n\n") : null,
    nativeBlockCount: details?.length ?? 0,
    hiddenBlockCount,
    signedBlockCount,
    blockTypes: [...blockTypes],
  }
}
