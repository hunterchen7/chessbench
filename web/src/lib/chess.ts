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
