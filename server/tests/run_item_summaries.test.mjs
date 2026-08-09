import assert from "node:assert/strict"
import test from "node:test"

import { compactRunItem } from "../src/run_item_summaries.ts"
import { ratedPuzzlePosition } from "../src/puzzle_payloads.ts"

const outcome = {
  item_id: "abc123",
  sequence: 7,
  points: 1,
  max_points: 1,
  solved: 1,
  first_move_legal: 1,
  response_format_valid: 1,
  failure_reason: null,
  item_rating: 1725,
  item_rating_deviation: 64,
  rated_payload_json: null,
  rated_rating: null,
  rated_rating_deviation: null,
  rated_popularity: null,
  rated_plays: null,
}

test("compact run items combine immutable suite positions with scalar outcomes", () => {
  const item = compactRunItem({
    ...outcome,
    suite_payload_json: JSON.stringify({
      id: "abc123",
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      moves: ["e2e4", "e7e5", "g1f3"],
      rating: 1700,
      themes: ["opening"],
    }),
  }, "puzzle", ratedPuzzlePosition)

  assert.equal(item.puzzle_id, "abc123")
  assert.equal(item.rating, 1725)
  assert.equal(item.rating_deviation, 64)
  assert.equal(item.fen, "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1")
  assert.deepEqual(item.solution, ["e7e5", "g1f3"])
  assert.equal(item.solved, true)
  assert.equal(item.score, 1)
  assert.equal(item.audit_available, true)
  assert.equal("turns" in item, false)
  assert.equal("request_payload" in item, false)
})
