import { Chessboard } from "react-chessboard"
import { useEffect, useMemo, useState, type CSSProperties } from "react"
import { Chess } from "chess.js"

export interface BoardProps {
  fen: string
  orientation?: "white" | "black"
  /** Return true to accept the drop (interactive mode enabled when provided). */
  onPieceDrop?: (from: string, to: string) => boolean
  /** Extra per-square styles, e.g. move highlights. */
  squareStyles?: Record<string, CSSProperties>
  /** Most recent UCI move; its origin and destination are highlighted. */
  lastMove?: string | null
  id?: string
  maxWidth?: CSSProperties["maxWidth"]
}

const LIGHT = { backgroundColor: "#e9edcc" }
const DARK = { backgroundColor: "#6f8f57" }
const LAST_MOVE_STYLE: CSSProperties = {
  background: "linear-gradient(color-mix(in oklch, var(--chart-4) 38%, transparent), color-mix(in oklch, var(--chart-4) 38%, transparent))",
}
const CHECK_STYLE: CSSProperties = {
  background: "radial-gradient(circle, rgba(239, 68, 68, 0.88) 0 38%, rgba(220, 38, 38, 0.52) 40% 68%, transparent 71%)",
}

function checkedKingSquare(fen: string): string | null {
  try {
    const game = new Chess(fen)
    if (!game.inCheck()) return null
    return game.board().flat().find((piece) => piece?.type === "k" && piece.color === game.turn())?.square ?? null
  } catch {
    return null
  }
}

export function Board({ fen, orientation = "white", onPieceDrop, squareStyles, lastMove, id = "board", maxWidth = 480 }: BoardProps) {
  const [selected, setSelected] = useState<string | null>(null)
  useEffect(() => setSelected(null), [fen])
  const checkedKing = useMemo(() => checkedKingSquare(fen), [fen])
  const styles = useMemo(() => {
    if (!selected && !lastMove && !checkedKing) return squareStyles
    const combined = { ...squareStyles }
    if (lastMove && /^[a-h][1-8][a-h][1-8]/.test(lastMove)) {
      combined[lastMove.slice(0, 2)] = { ...combined[lastMove.slice(0, 2)], ...LAST_MOVE_STYLE }
      combined[lastMove.slice(2, 4)] = { ...combined[lastMove.slice(2, 4)], ...LAST_MOVE_STYLE }
    }
    if (checkedKing) combined[checkedKing] = { ...combined[checkedKing], ...CHECK_STYLE }
    if (selected) combined[selected] = {
      ...combined[selected],
      boxShadow: "inset 0 0 0 4px color-mix(in srgb, #facc15 72%, transparent)",
    }
    return combined
  }, [checkedKing, lastMove, selected, squareStyles])

  return (
    <div style={{ maxWidth, width: "100%" }} className="mx-auto">
      <Chessboard
        options={{
          id,
          position: fen,
          boardOrientation: orientation,
          allowDragging: !!onPieceDrop,
          darkSquareStyle: DARK,
          lightSquareStyle: LIGHT,
          squareStyles: styles,
          animationDurationInMs: 200,
          onPieceDrop: onPieceDrop
            ? ({ sourceSquare, targetSquare }) =>
                targetSquare ? (setSelected(null), onPieceDrop(sourceSquare, targetSquare)) : false
            : undefined,
          onSquareClick: onPieceDrop ? ({ piece, square }) => {
            if (!selected) {
              if (piece) setSelected(square)
              return
            }
            if (selected === square) return setSelected(null)
            if (onPieceDrop(selected, square)) return setSelected(null)
            setSelected(piece ? square : null)
          } : undefined,
        }}
      />
    </div>
  )
}
