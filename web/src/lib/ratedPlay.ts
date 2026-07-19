import type { RatedSessionProtocol } from "@/lib/data"

export function ratedPlayPath(protocol: Pick<RatedSessionProtocol, "pool" | "selection">) {
  const params = new URLSearchParams({
    seed: String(protocol.selection.seed),
    pool_hash: protocol.pool.content_hash,
    target_radius: String(protocol.selection.target_radius),
    restart: "1",
  })
  return `/puzzles/play?${params}`
}
