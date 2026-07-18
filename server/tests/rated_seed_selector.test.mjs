import assert from "node:assert/strict"
import test from "node:test"

import {
  chooseRatedPuzzleId,
  pythonRound,
  ratedPuzzlePriority,
  ratedPuzzlePriorityIdentity,
} from "../src/rated_seed_selector.ts"

test("seeded priority is byte-for-byte compatible with the Python benchmark", async () => {
  assert.equal(
    ratedPuzzlePriorityIdentity("sha256:abc", 42, 0, "00abc"),
    "deterministic_rating_band_v1:sha256:abc:42:0:00abc",
  )
  assert.equal(
    await ratedPuzzlePriority("sha256:abc", 42, 0, "00abc"),
    "5a1c65188289eb8afb5a0c0176d17876a803c6f47696fdb87d503bc338070fc8",
  )
  assert.equal(
    await chooseRatedPuzzleId(["00abc", "00def", "00ghi"], "sha256:abc", 42, 0),
    "00ghi",
  )
})

test("seeded target rating uses Python ties-to-even rounding", () => {
  assert.equal(pythonRound(1500.49), 1500)
  assert.equal(pythonRound(1500.5), 1500)
  assert.equal(pythonRound(1501.5), 1502)
  assert.equal(pythonRound(1501.51), 1502)
})
