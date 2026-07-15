import type { Env } from "./types"

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Owner authentication shared by mutation and sealed-data export routes. */
export function authorized(env: Env, req: Request): boolean {
  if (!env.INGEST_TOKEN) return false
  const match = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(.+)$/i)
  return !!match && safeEqual(match[1], env.INGEST_TOKEN)
}
