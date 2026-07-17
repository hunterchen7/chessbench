import assert from "node:assert/strict"
import test from "node:test"

import { ratedPuzzlePageParams } from "../src/rated_puzzle_pages.ts"

test("rated puzzle pages use bounded defaults", () => {
  assert.deepEqual(ratedPuzzlePageParams(new URLSearchParams()), { page: 1, perPage: 100 })
  assert.deepEqual(ratedPuzzlePageParams(new URLSearchParams("page=7&per_page=200")), {
    page: 7,
    perPage: 200,
  })
})

test("rated puzzle pages reject invalid and unbounded requests", () => {
  for (const query of ["page=0", "page=1.5", "page=100001", "per_page=0", "per_page=201"]) {
    assert.equal(ratedPuzzlePageParams(new URLSearchParams(query)), null, query)
  }
})
