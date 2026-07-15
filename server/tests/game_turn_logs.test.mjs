import assert from "node:assert/strict"
import test from "node:test"

import { orderedGameAttempts } from "../src/game_turn_logs.ts"

test("repeated board plies receive collision-free game-global ordinals", () => {
  const moves = [
    {
      ply: 1,
      color: "white",
      attempts: [{ raw_response: "e2e4", parsed_move: "e2e4", legal: true }],
    },
    {
      // Black never changes the board, so the forfeit envelope reuses ply 1.
      ply: 1,
      color: "black",
      attempts: [
        { raw_response: "banana", legal: false },
        { raw_response: "still banana", legal: false },
      ],
    },
  ]
  const original = structuredClone(moves)

  const turns = orderedGameAttempts(moves)

  assert.deepEqual(
    turns.map(({ turnOrdinal, ply, attempt, color }) => ({ turnOrdinal, ply, attempt, color })),
    [
      { turnOrdinal: 0, ply: 1, attempt: 0, color: "white" },
      { turnOrdinal: 1, ply: 1, attempt: 0, color: "black" },
      { turnOrdinal: 2, ply: 1, attempt: 1, color: "black" },
    ],
  )
  assert.equal(new Set(turns.map((turn) => turn.turnOrdinal)).size, turns.length)
  assert.deepEqual(moves, original, "normalization must not mutate tournament replay documents")
})

test("ordinals are dense across move envelopes with no attempts", () => {
  const turns = orderedGameAttempts([
    { ply: 0, color: "white", attempts: [] },
    { ply: 0, color: "white", attempts: [{ raw_response: "bad", legal: false }] },
  ])
  assert.deepEqual(turns.map((turn) => turn.turnOrdinal), [0])
})
