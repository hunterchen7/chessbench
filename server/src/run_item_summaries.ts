export interface RunItemSummaryRow {
  item_id: string
  sequence: number
  points: number
  max_points: number
  solved: number
  first_move_legal: number
  response_format_valid: number | null
  failure_reason: string | null
  item_rating: number | null
  item_rating_deviation: number | null
  suite_payload_json: string | null
  rated_payload_json: string | null
  rated_rating: number | null
  rated_rating_deviation: number | null
  rated_popularity: number | null
  rated_plays: number | null
}

function finiteNumber(value: unknown, fallback = 0): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

type PositionBuilder = (
  payload: Record<string, unknown>,
  metadata: {
    puzzle_id: string
    rating: number
    rating_deviation?: number
    popularity?: number
    plays?: number
  },
) => Record<string, unknown>

export function compactRunItem(
  row: RunItemSummaryRow,
  track: string,
  buildPosition: PositionBuilder,
): Record<string, unknown> {
  const sourceJson = row.suite_payload_json ?? row.rated_payload_json
  const source = sourceJson ? JSON.parse(sourceJson) as Record<string, unknown> : {}
  const rating = row.item_rating ?? row.rated_rating ?? finiteNumber(source.rating)
  const ratingDeviation = row.item_rating_deviation ?? row.rated_rating_deviation ?? source.rating_deviation
  const position = track === "esoteric"
    ? {
        ...source,
        puzzle_id: String(source.puzzle_id ?? source.id ?? row.item_id),
        rating,
        rating_deviation: ratingDeviation == null ? undefined : finiteNumber(ratingDeviation),
        themes: stringArray(source.themes),
        categories: source.categories && typeof source.categories === "object" ? source.categories : {},
        fen: String(source.fen ?? ""),
        solver_is_white: Boolean(source.solver_is_white),
        solution: stringArray(source.solution),
        solution_first: stringArray(source.solution)[0] ?? null,
      }
    : buildPosition(source, {
        puzzle_id: row.item_id,
        rating,
        rating_deviation: ratingDeviation == null ? undefined : finiteNumber(ratingDeviation),
        popularity: row.rated_popularity ?? undefined,
        plays: row.rated_plays ?? undefined,
      })
  return {
    ...position,
    puzzle_id: row.item_id,
    sequence: row.sequence,
    rating,
    rating_deviation: ratingDeviation == null ? undefined : finiteNumber(ratingDeviation),
    solved: Boolean(row.solved),
    score: row.points,
    max_score: row.max_points,
    first_move_legal: Boolean(row.first_move_legal),
    failure_reason: row.failure_reason,
    answer_move: null,
    answer_explanation: null,
    answer_raw: null,
    answer_response_format_valid: row.response_format_valid == null
      ? null
      : Boolean(row.response_format_valid),
    audit_available: true,
  }
}
