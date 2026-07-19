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

/**
 * Accept the frozen source move, or any legal checkmate on the final solver
 * ply. The model move-by-move grader uses the same source-independent rule.
 */
export function acceptedPuzzleMove(
  gameAfterMove: Chess,
  actual: string,
  expected: string,
  finalSolverPly: boolean,
): boolean {
  return actual === expected || (finalSolverPly && gameAfterMove.isCheckmate())
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

export interface PuzzleContinuationPly {
  uci: string
  san: string
  source: "model" | "puzzle"
  status: "correct" | "wrong" | "forced"
}

export function puzzleModelAttempts(item: {
  moves_played?: string[]
  answer_move?: string | null
  turns?: Array<{ solver_ply: number; parsed_move?: string | null; raw_response?: string | null }>
}): string[] {
  const byPly = new Map<number, string>()
  item.moves_played?.forEach((move, index) => byPly.set(index, move))
  item.turns?.forEach((turn) => {
    const visibleUci = turn.raw_response?.match(/\b[a-h][1-8][a-h][1-8][qrbn]?\b/i)?.[0]?.toLowerCase()
    byPly.set(turn.solver_ply, turn.parsed_move ?? visibleUci ?? "unparsed")
  })
  if (!byPly.size && item.answer_move) byPly.set(0, item.answer_move)
  if (!byPly.size) return ["unparsed"]
  return Array.from({ length: Math.max(...byPly.keys()) + 1 }, (_, index) => byPly.get(index) ?? "unparsed")
}

/**
 * Reconstruct the line the model actually experienced: a model choice followed by
 * the authoritative puzzle reply before the next model choice. Unparseable final
 * attempts are preserved as red model plies instead of silently disappearing.
 */
export function puzzleContinuation(
  fen: string,
  modelMoves: string[],
  referenceLine: string[],
  correctSolverMoves: number,
): PuzzleContinuationPly[] {
  const game = new Chess(fen)
  const output: PuzzleContinuationPly[] = []

  for (let index = 0; index < modelMoves.length; index += 1) {
    const uci = modelMoves[index]
    const correct = index < correctSolverMoves
    try {
      const san = game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined }).san
      output.push({ uci, san, source: "model", status: correct ? "correct" : "wrong" })
    } catch {
      output.push({ uci, san: uci === "unparsed" ? "no move" : uci, source: "model", status: "wrong" })
      break
    }

    if (!correct) break
    const reply = referenceLine[index * 2 + 1]
    if (index >= modelMoves.length - 1 || !reply) continue
    try {
      const san = game.move({ from: reply.slice(0, 2), to: reply.slice(2, 4), promotion: reply.slice(4) || undefined }).san
      output.push({ uci: reply, san, source: "puzzle", status: "forced" })
    } catch {
      break
    }
  }
  return output
}
