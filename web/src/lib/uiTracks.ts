import type { Track } from "@/lib/data"

/**
 * Tracks currently exposed as first-class product surfaces in the public app.
 * Woodpecker remains supported by the harness and data model while its full-line
 * protocol is reconsidered as a possible Standard puzzle prompting mode.
 */
const VISIBLE_TRACKS = new Set<Track>(["puzzle", "esoteric", "game"])

export function isVisibleUiTrack(track: Track): boolean {
  return VISIBLE_TRACKS.has(track)
}
