export interface GameAttemptPayload {
  system_prompt?: string | null
  prompt?: string | null
  raw_response?: string
  parsed_move?: string | null
  legal?: boolean
  explanation?: string | null
  response_format_valid?: boolean | null
  response_format_error?: string | null
  prompt_tokens?: number
  completion_tokens?: number
  reasoning_tokens?: number
  cost_usd?: number
}

export interface GameMovePayload {
  ply?: number
  color?: string
  attempts?: GameAttemptPayload[]
}

export interface OrderedGameAttempt {
  /** Collision-free ordinal across every persisted response in one game. */
  turnOrdinal: number
  /** Retry index within the original move envelope. */
  attempt: number
  /** Board ply supplied by the runner; it may repeat across move envelopes. */
  ply: number
  color: string
  payload: GameAttemptPayload
}

/**
 * Flatten move envelopes without treating board ply as their identity.
 *
 * The input document remains untouched so completed tournament document replay
 * continues to use the exact original moves array.
 */
export function orderedGameAttempts(moves: readonly GameMovePayload[]): OrderedGameAttempt[] {
  const ordered: OrderedGameAttempt[] = []
  for (const move of moves) {
    for (const [attempt, payload] of (move.attempts ?? []).entries()) {
      ordered.push({
        turnOrdinal: ordered.length,
        attempt,
        ply: move.ply ?? 0,
        color: move.color ?? "unknown",
        payload,
      })
    }
  }
  return ordered
}
