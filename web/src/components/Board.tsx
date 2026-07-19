import { Chessboard } from "react-chessboard"
import { useEffect, useMemo, useState, type CSSProperties } from "react"

export interface BoardProps {
  fen: string
  orientation?: "white" | "black"
  /** Return true to accept the drop (interactive mode enabled when provided). */
  onPieceDrop?: (from: string, to: string) => boolean
  /** Extra per-square styles, e.g. move highlights. */
  squareStyles?: Record<string, CSSProperties>
  id?: string
  maxWidth?: CSSProperties["maxWidth"]
}

const LIGHT = { backgroundColor: "#e9edcc" }
const DARK = { backgroundColor: "#6f8f57" }

export function Board({ fen, orientation = "white", onPieceDrop, squareStyles, id = "board", maxWidth = 480 }: BoardProps) {
  const [selected, setSelected] = useState<string | null>(null)
  useEffect(() => setSelected(null), [fen])
  const styles = useMemo(() => selected ? {
    ...squareStyles,
    [selected]: {
      ...squareStyles?.[selected],
      boxShadow: "inset 0 0 0 4px color-mix(in srgb, #facc15 72%, transparent)",
    },
  } : squareStyles, [selected, squareStyles])

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
