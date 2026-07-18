import assert from "node:assert/strict"
import test from "node:test"

import { adaptiveRatingSampleCount, adaptiveSolverRatingSnapshot } from "../src/adaptive_rating.ts"

test("extracts the live Glicko estimate from an adaptive puzzle result", () => {
  assert.deepEqual(adaptiveSolverRatingSnapshot({
    rating: 1513,
    solver_rating_after: {
      rating: 1475.6403856532252,
      rating_deviation: 77.71172489682469,
      volatility: 0.0899,
    },
  }), {
    rating: 1475.6403856532252,
    ratingDeviation: 77.71172489682469,
  })
})

test("does not confuse source-puzzle rating with solver rating", () => {
  assert.equal(adaptiveSolverRatingSnapshot({ rating: 1513 }), null)
  assert.equal(adaptiveSolverRatingSnapshot({
    solver_rating_after: { rating: 1475, rating_deviation: -1 },
  }), null)
})

test("derives sample count from sequence so out-of-order retries stay consistent", () => {
  assert.equal(adaptiveRatingSampleCount(0), 1)
  assert.equal(adaptiveRatingSampleCount(13), 14)
})
