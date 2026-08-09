import assert from "node:assert/strict"
import test from "node:test"

import { runItemPage } from "../src/run_pagination.ts"

test("run item pagination has a bounded default page", () => {
  assert.deepEqual(
    runItemPage(new URL("https://example.test/api/runs/run-1")),
    { offset: 0, limit: 5 },
  )
})

test("run item pagination accepts an offset and clamps the page size", () => {
  assert.deepEqual(
    runItemPage(new URL("https://example.test/api/runs/run-1?item_offset=15&item_limit=999")),
    { offset: 15, limit: 10 },
  )
  assert.deepEqual(
    runItemPage(new URL("https://example.test/api/runs/run-1?item_offset=-4&item_limit=0")),
    { offset: 0, limit: 1 },
  )
})

test("run item pagination falls back for invalid numeric values", () => {
  assert.deepEqual(
    runItemPage(new URL("https://example.test/api/runs/run-1?item_offset=12px&item_limit=nope")),
    { offset: 0, limit: 5 },
  )
})
