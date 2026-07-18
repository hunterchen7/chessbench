import assert from "node:assert/strict"
import test from "node:test"

import { ratedPuzzlePosition, ratedPuzzleSummary } from "../src/puzzle_payloads.ts"

const raw = {
  id: "raw-puzzle",
  fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  moves: ["e2e4", "e7e5", "g1f3"],
  rating: 1450,
  rating_deviation: 75,
  popularity: 92,
  nb_plays: 1234,
  themes: ["opening", "fork", "mateIn2"],
  source: "lichess",
}

test("rated page summaries expose the API shape instead of raw D1 payloads", () => {
  assert.deepEqual(ratedPuzzleSummary(raw), {
    puzzle_id: "raw-puzzle",
    rating: 1450,
    rating_deviation: 75,
    popularity: 92,
    plays: 1234,
    themes: ["opening", "fork", "mateIn2"],
    categories: {
      tier: ["intermediate"],
      phase: ["opening"],
      motif: ["fork"],
      mate_pattern: ["mateIn2"],
    },
  })
})

test("rated detail positions apply the setup move inside the Worker", () => {
  const position = ratedPuzzlePosition(raw)
  assert.equal(position.puzzle_id, "raw-puzzle")
  assert.equal(position.fen, "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1")
  assert.equal(position.setup_san, "e4")
  assert.equal(position.solver_is_white, false)
  assert.deepEqual(position.solution, ["e7e5", "g1f3"])
  assert.equal(position.solution_first, "e7e5")
  assert.equal("moves" in position, false)
})

test("rated D1 columns override duplicate raw payload metadata", () => {
  const summary = ratedPuzzleSummary(raw, {
    puzzle_id: "canonical-id",
    rating: 2250,
    rating_deviation: 60,
    popularity: 99,
    plays: 9876,
  })
  assert.equal(summary.puzzle_id, "canonical-id")
  assert.equal(summary.rating, 2250)
  assert.deepEqual(summary.categories.tier, ["expert"])
  assert.equal(summary.plays, 9876)
})
