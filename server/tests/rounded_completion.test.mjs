import assert from "node:assert/strict"
import test from "node:test"

import { acceptsRoundedRatedCompletion } from "../src/run_completion.ts"

const valid = {
  requested: "completed",
  protocolKind: "adaptive_glicko2",
  termination: {
    kind: "operator_rounded",
    attempted: 51,
    actual_rating_deviation: 75.39467914654072,
    display_rating_deviation: 75,
  },
  suppliedRating: {
    rating_deviation: 75.39467914654072,
    accepted_rounded: true,
  },
  completedItems: 51,
  totalItems: 100,
  minimumPuzzles: 50,
  targetDeviation: 75,
  finalDeviation: 75.39467914654072,
}

test("accepts an audited adaptive RD that rounds to the target", () => {
  assert.equal(acceptsRoundedRatedCompletion(valid), true)
})

test("rejects rounded completion at or beyond half a rating-deviation point", () => {
  assert.equal(acceptsRoundedRatedCompletion({
    ...valid,
    finalDeviation: 75.5,
    termination: {
      ...valid.termination,
      actual_rating_deviation: 75.5,
      display_rating_deviation: 76,
    },
    suppliedRating: {
      ...valid.suppliedRating,
      rating_deviation: 75.5,
    },
  }), false)
})

test("rejects missing operator acceptance or mismatched audit values", () => {
  assert.equal(acceptsRoundedRatedCompletion({
    ...valid,
    suppliedRating: { ...valid.suppliedRating, accepted_rounded: false },
  }), false)
  assert.equal(acceptsRoundedRatedCompletion({
    ...valid,
    termination: { ...valid.termination, attempted: 50 },
  }), false)
})
