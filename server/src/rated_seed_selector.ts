export const RATED_SELECTOR_VERSION = "deterministic_rating_band_v1"

const encoder = new TextEncoder()

/** Python's round(float) behavior for the positive ratings used by the canonical selector. */
export function pythonRound(value: number): number {
  const lower = Math.floor(value)
  const fraction = value - lower
  if (fraction < 0.5) return lower
  if (fraction > 0.5) return lower + 1
  return lower % 2 === 0 ? lower : lower + 1
}

export function ratedPuzzlePriorityIdentity(
  poolHash: string,
  seed: number,
  sequence: number,
  puzzleId: string,
): string {
  return `${RATED_SELECTOR_VERSION}:${poolHash}:${seed}:${sequence}:${puzzleId}`
}

export async function ratedPuzzlePriority(
  poolHash: string,
  seed: number,
  sequence: number,
  puzzleId: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(ratedPuzzlePriorityIdentity(poolHash, seed, sequence, puzzleId)),
  )
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

/** Choose the same minimum (SHA-256 bytes, puzzle id) tuple as the Python benchmark. */
export async function chooseRatedPuzzleId(
  puzzleIds: string[],
  poolHash: string,
  seed: number,
  sequence: number,
): Promise<string | null> {
  let chosenId: string | null = null
  let chosenPriority: string | null = null
  const batchSize = 256
  for (let index = 0; index < puzzleIds.length; index += batchSize) {
    const batch = puzzleIds.slice(index, index + batchSize)
    const priorities = await Promise.all(batch.map((puzzleId) => (
      ratedPuzzlePriority(poolHash, seed, sequence, puzzleId)
    )))
    for (let offset = 0; offset < batch.length; offset += 1) {
      const puzzleId = batch[offset]
      const priority = priorities[offset]
      if (
        chosenPriority == null || priority < chosenPriority ||
        (priority === chosenPriority && (chosenId == null || puzzleId < chosenId))
      ) {
        chosenId = puzzleId
        chosenPriority = priority
      }
    }
  }
  return chosenId
}
