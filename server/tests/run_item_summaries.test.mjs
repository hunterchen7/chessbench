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

test("compact run items carry the played moves so comparisons can render them", () => {
  // The transcript (prompt/reasoning/raw response) loads on demand, but the
  // moves are a few UCI strings and the comparison view renders "no move"
  // without them.
  const row = {
    item_id: "TBRWy",
    sequence: 15,
    points: 1,
    max_points: 1,
    solved: 1,
    first_move_legal: 1,
    response_format_valid: 1,
    failure_reason: null,
    item_rating: 1319,
    item_rating_deviation: 80,
    suite_payload_json: null,
    rated_payload_json: JSON.stringify({ fen: "8/8/8/8/8/8/8/8 w - - 0 1", rating: 1319 }),
    rated_rating: 1319,
    rated_rating_deviation: 80,
    rated_popularity: 90,
    rated_plays: 1000,
    answer_move: "d3h7",
    moves_played_json: JSON.stringify(["d3h7", "h7g8", "c2h7"]),
    plies_correct: 3,
    solver_plies: 3,
  }
  const item = compactRunItem(row, "puzzle", (payload, meta) => ({ ...payload, ...meta }))
  assert.equal(item.answer_move, "d3h7")
  assert.deepEqual(item.moves_played, ["d3h7", "h7g8", "c2h7"])
  assert.equal(item.plies_correct, 3)
  assert.equal(item.solver_plies, 3)
  // the heavy fields still load separately
  assert.equal(item.answer_raw, null)
  assert.equal(item.answer_explanation, null)
  assert.equal(item.audit_available, true)
})

test("a run item with no recorded moves stays renderable", () => {
  const row = {
    item_id: "x", sequence: 0, points: 0, max_points: 1, solved: 0,
    first_move_legal: 0, response_format_valid: null, failure_reason: "illegal",
    item_rating: 900, item_rating_deviation: 80,
    suite_payload_json: null, rated_payload_json: JSON.stringify({ fen: "8/8/8/8/8/8/8/8 w - - 0 1" }),
    rated_rating: 900, rated_rating_deviation: 80, rated_popularity: null, rated_plays: null,
    answer_move: null, moves_played_json: null, plies_correct: null, solver_plies: null,
  }
  const item = compactRunItem(row, "puzzle", (payload, meta) => ({ ...payload, ...meta }))
  assert.equal(item.answer_move, null)
  assert.deepEqual(item.moves_played, [])
})
