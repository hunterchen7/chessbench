import assert from "node:assert/strict"
import test from "node:test"

import { parseTrainingSave } from "../src/human_training_payload.ts"

const session = {
  version: 1,
  state: { rating: 1642.5, deviation: 83.2, volatility: 0.089 },
  attempts: 52,
  solved: 31,
  recent_puzzle_ids: ["abc12"],
  recent_attempts: [],
  updated_at: "2026-07-17T00:00:00Z",
}

test("saved training profiles require a bounded snapshot and safe unique-handle shape", () => {
  assert.deepEqual(parseTrainingSave({ uid: "browser-1", handle: "Knight_42", session }), {
    uid: "browser-1",
    handle: "Knight_42",
    session,
  })
  for (const invalid of [
    { uid: "browser-1", handle: "x", session },
    { uid: "browser-1", handle: "not allowed", session },
    { uid: "browser-1", handle: "Knight_42", session: { ...session, attempts: 2, solved: 3 } },
    { uid: "browser-1", handle: "Knight_42", session: { ...session, state: { ...session.state, rating: 9000 } } },
    { uid: "browser-1", handle: "Knight_42", session: { ...session, recent_puzzle_ids: Array(101).fill("p") } },
  ]) assert.equal(parseTrainingSave(invalid), null)
})
