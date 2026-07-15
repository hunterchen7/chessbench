import assert from "node:assert/strict"
import test from "node:test"

import { includesTournaments } from "../src/export_filters.ts"

const globalExport = { track: null, model: null, runId: null, status: null }

test("global and explicit game exports include tournaments", () => {
  assert.equal(includesTournaments(globalExport), true)
  assert.equal(includesTournaments({ ...globalExport, track: "game" }), true)
})

test("run-table filters do not append unrelated tournaments", () => {
  assert.equal(includesTournaments({ ...globalExport, track: "puzzle" }), false)
  assert.equal(includesTournaments({ ...globalExport, model: "model-a" }), false)
  assert.equal(includesTournaments({ ...globalExport, runId: "run-a" }), false)
  assert.equal(includesTournaments({ ...globalExport, status: "partial" }), false)
})
