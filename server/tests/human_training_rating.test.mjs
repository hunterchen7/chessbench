import assert from "node:assert/strict"
import test from "node:test"

import {
  INITIAL_HUMAN_GLICKO_STATE,
  humanTrainingRecord,
  humanTrainingSelected,
  humanTrainingSession,
  humanTrainingSkip,
  startHumanTrainingSession,
  updateHumanGlicko,
} from "../../web/src/lib/humanTraining.ts"

class MemoryStorage {
  values = new Map()

  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
  clear() { this.values.clear() }
}

const storage = new MemoryStorage()
Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true })

test.beforeEach(() => storage.clear())

test("browser Glicko updates match the canonical Python rated-session values", () => {
  const win = updateHumanGlicko(INITIAL_HUMAN_GLICKO_STATE, 1500, 80, true)
  const loss = updateHumanGlicko(INITIAL_HUMAN_GLICKO_STATE, 1500, 80, false)

  assert.ok(Math.abs(win.rating - 1736.8459131642737) < 1e-9)
  assert.ok(Math.abs(win.deviation - 291.3753335284687) < 1e-9)
  assert.ok(Math.abs(win.volatility - 0.08999460343901308) < 1e-12)
  assert.ok(Math.abs(loss.rating - 1263.1540868357263) < 1e-9)
  assert.equal(win.deviation, loss.deviation)
})

test("provisional source puzzles retain the canonical weighted update", () => {
  const win = updateHumanGlicko(INITIAL_HUMAN_GLICKO_STATE, 1500, 140, true)
  assert.ok(Math.abs(win.rating - 1692.7921319313077) < 1e-9)
  assert.ok(Math.abs(win.deviation - 342.1521562190602) < 1e-9)
})

test("reveals skip without an attempt and rated outcomes are idempotent", () => {
  humanTrainingSkip("skip-me")
  const skipped = humanTrainingSession()
  assert.equal(skipped.attempts, 0)
  assert.deepEqual(skipped.recent_puzzle_ids, ["skip-me"])

  const first = humanTrainingRecord("rated-once", 1500, 80, false)
  const duplicate = humanTrainingRecord("rated-once", 1500, 80, true)
  assert.equal(first.duplicate, false)
  assert.equal(duplicate.duplicate, true)
  assert.equal(humanTrainingSession().attempts, 1)
  assert.equal(humanTrainingSession().solved, 0)
})

test("seeded human runs persist the benchmark selector sequence and pool", () => {
  const started = startHumanTrainingSession(42, "sha256:pool", 100)
  assert.deepEqual(started.state, INITIAL_HUMAN_GLICKO_STATE)
  assert.deepEqual(started.selector, {
    version: "deterministic_rating_band_v1",
    seed: 42,
    target_radius: 100,
    pool_hash: "sha256:pool",
    next_sequence: 0,
  })

  const selected = humanTrainingSelected({
    puzzleId: "00abc",
    poolHash: "sha256:pool",
    seed: 42,
    sequence: 0,
    targetRadius: 100,
  })
  assert.equal(selected.selector.next_sequence, 1)
  assert.deepEqual(selected.recent_puzzle_ids, ["00abc"])
})
