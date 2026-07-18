import assert from "node:assert/strict"
import test from "node:test"

import { ratedPuzzlePageParams } from "../src/rated_puzzle_pages.ts"

test("rated puzzle pages use bounded defaults", () => {
  assert.deepEqual(ratedPuzzlePageParams(new URLSearchParams()), {
    page: 1,
    perPage: 600,
    sort: "rating",
    direction: "asc",
    tier: null,
    theme: null,
    idPrefix: null,
    minRating: null,
    maxRating: null,
  })
  assert.deepEqual(ratedPuzzlePageParams(new URLSearchParams("page=7&per_page=750&sort=plays&direction=desc&tier=expert&theme=fork&id_prefix=abc&min_rating=2250&max_rating=2500")), {
    page: 7,
    perPage: 750,
    sort: "plays",
    direction: "desc",
    tier: "expert",
    theme: "fork",
    idPrefix: "abc",
    minRating: 2250,
    maxRating: 2500,
  })
})

test("rated puzzle pages reject invalid and unbounded requests", () => {
  for (const query of [
    "page=0", "page=1.5", "page=100001", "per_page=0", "per_page=1001",
    "sort=themes", "direction=sideways", "tier=legend", "theme=fork%25", "id_prefix=%25",
    "min_rating=-1", "max_rating=4001", "min_rating=2000&max_rating=1000",
  ]) {
    assert.equal(ratedPuzzlePageParams(new URLSearchParams(query)), null, query)
  }
})
