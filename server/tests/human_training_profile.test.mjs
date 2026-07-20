import assert from "node:assert/strict"
import test from "node:test"

import { parseTrainingSave, trainingSessionSeed } from "../src/human_training_payload.ts"

const session = {
  version: 1,
  state: { rating: 1642.5, deviation: 74.9, volatility: 0.089 },
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
    { uid: "browser-1", handle: "Knight_42", session: { ...session, state: { ...session.state, deviation: 77.01 } } },
    { uid: "browser-1", handle: "Knight_42", session: { ...session, recent_puzzle_ids: Array(101).fill("p") } },
  ]) assert.equal(parseTrainingSave(invalid), null)
  assert.equal(parseTrainingSave({
    uid: "browser-1",
    handle: "Knight_42",
    session: { ...session, state: { ...session.state, deviation: 77 } },
  })?.session.state.deviation, 77)
})

test("saved training profiles accept and validate benchmark-compatible selector state", () => {
  const selector = {
    version: "deterministic_rating_band_v1",
    seed: -7,
    target_radius: 100,
    pool_hash: "sha256:abc",
    next_sequence: 12,
  }
  const seededSession = { ...session, selector }
  assert.deepEqual(
    parseTrainingSave({ uid: "browser-1", handle: "Knight_42", session: seededSession })?.session.selector,
    selector,
  )
  assert.equal(parseTrainingSave({
    uid: "browser-1",
    handle: "Knight_42",
    session: { ...seededSession, selector: { ...selector, next_sequence: -1 } },
  }), null)
})

test("saved training profiles preserve bounded human move continuations", () => {
  const attempt = {
    puzzle_id: "abc12",
    puzzle_rating: 1800,
    puzzle_deviation: 75,
    solved: false,
    rating_before: 1645,
    rating_after: 1621,
    played_at: "2026-07-17T00:00:00Z",
    outcome: "incorrect",
    moves: ["e2e4", "g1f3"],
    experienced_line: ["e2e4", "e7e5", "g1f3"],
    solution: ["e2e4", "e7e5", "f1c4"],
    fen: "8/8/8/8/8/8/8/8 w - - 0 1",
  }
  const detailed = { ...session, recent_attempts: [attempt] }
  assert.deepEqual(
    parseTrainingSave({ uid: "browser-1", handle: "Knight_42", session: detailed })?.session.recent_attempts,
    [attempt],
  )
  assert.equal(parseTrainingSave({
    uid: "browser-1",
    handle: "Knight_42",
    session: { ...detailed, recent_attempts: [{ ...attempt, moves: ["not-a-move"] }] },
  }), null)
})

test("saved training profiles expose their seed without trusting malformed legacy JSON", () => {
  assert.equal(trainingSessionSeed(JSON.stringify({ ...session, selector: {
    version: "deterministic_rating_band_v1",
    seed: -7,
    target_radius: 100,
    pool_hash: "sha256:abc",
    next_sequence: 12,
  } })), -7)
  assert.equal(trainingSessionSeed(JSON.stringify(session)), null)
  assert.equal(trainingSessionSeed("not json"), null)
})
