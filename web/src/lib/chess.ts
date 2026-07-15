import { Chess } from "chess.js"

/** Convert a single UCI move to SAN from a FEN (null if illegal / unparseable). */
export function uciToSan(fen: string, uci: string | null): string | null {
  if (!uci) return null
  try {
    const g = new Chess(fen)
    return g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined }).san
  } catch {
    return null
  }
}

/** Convert a UCI move list to SAN starting from a FEN (best-effort; stops on the first illegal move). */
export function uciLineToSan(fen: string, line: string[]): string[] {
  const g = new Chess(fen)
  const out: string[] = []
  for (const uci of line) {
    try {
      out.push(g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined }).san)
    } catch {
      break
    }
  }
  return out
}

/** Convert solver-only moves by replaying the authoritative opponent reply between them. */
export function solverMovesToSan(fen: string, solverMoves: string[], referenceLine: string[]): string[] {
  const game = new Chess(fen)
  const output: string[] = []
  for (let index = 0; index < solverMoves.length; index += 1) {
    const move = solverMoves[index]
    try {
      output.push(game.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move.slice(4) || undefined }).san)
    } catch {
      output.push(move)
      break
    }
    const reply = referenceLine[index * 2 + 1]
    if (index < solverMoves.length - 1 && reply) {
      try {
        game.move({ from: reply.slice(0, 2), to: reply.slice(2, 4), promotion: reply.slice(4) || undefined })
      } catch {
        break
      }
    }
  }
  return output
}
