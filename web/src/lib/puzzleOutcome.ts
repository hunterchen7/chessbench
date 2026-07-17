export type PuzzleOutcome = "solved" | "partial" | "failed"

export const PUZZLE_OUTCOME_COLORS: Record<PuzzleOutcome, string> = {
  solved: "#10b981",
  partial: "#f59e0b",
  failed: "#f43f5e",
}

export function puzzleOutcome(item: { solved: boolean; score: number }): PuzzleOutcome {
  if (item.solved) return "solved"
  return item.score > 0 ? "partial" : "failed"
}
