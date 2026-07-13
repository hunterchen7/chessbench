import { Chessboard } from "react-chessboard"
import type { CSSProperties } from "react"

export interface BoardProps {
  fen: string
  orientation?: "white" | "black"
  /** Return true to accept the drop (interactive mode enabled when provided). */
  onPieceDrop?: (from: string, to: string) => boolean
  /** Extra per-square styles, e.g. move highlights. */
  squareStyles?: Record<string, CSSProperties>
  id?: string
  maxWidth?: number
}

const LIGHT = { backgroundColor: "#e9edcc" }
const DARK = { backgroundColor: "#6f8f57" }

export function Board({ fen, orientation = "white", onPieceDrop, squareStyles, id = "board", maxWidth = 480 }: BoardProps) {
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
          squareStyles,
          animationDurationInMs: 200,
          onPieceDrop: onPieceDrop
            ? ({ sourceSquare, targetSquare }) =>
                targetSquare ? onPieceDrop(sourceSquare, targetSquare) : false
            : undefined,
        }}
      />
    </div>
  )
}
