const DEFAULT_RUN_ITEM_PAGE_SIZE = 5
const MAX_RUN_ITEM_PAGE_SIZE = 10

function integerParam(raw: string | null, fallback: number) {
  if (raw == null || !/^-?\d+$/.test(raw)) return fallback
  const value = Number(raw)
  return Number.isSafeInteger(value) ? value : fallback
}

export function runItemPage(url: URL) {
  const parsedOffset = integerParam(url.searchParams.get("item_offset"), 0)
  const parsedLimit = integerParam(url.searchParams.get("item_limit"), DEFAULT_RUN_ITEM_PAGE_SIZE)
  return {
    offset: Math.max(0, parsedOffset),
    limit: Math.min(MAX_RUN_ITEM_PAGE_SIZE, Math.max(1, parsedLimit)),
  }
}
