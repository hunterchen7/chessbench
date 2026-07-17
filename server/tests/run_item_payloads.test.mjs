import assert from "node:assert/strict"
import test from "node:test"

import {
  encodeRunItemPayload,
  isRunItemPayloadChunkBatch,
  parseInlineRunItemPayload,
  parseRunItemPayloadReference,
  reassembleRunItemPayload,
  runItemPayloadReferenceJSON,
} from "../src/run_item_payloads.ts"

test("legacy inline payload_json remains readable", () => {
  const payload = { puzzle_id: "small", turns: [{ raw: "e2e4" }] }
  const stored = JSON.stringify(payload)
  assert.equal(parseRunItemPayloadReference(stored), null)
  assert.deepEqual(parseInlineRunItemPayload(stored), payload)
})

test("large full conversations round-trip through authenticated chunks", async () => {
  const payload = {
    puzzle_id: "wwxHC",
    turns: [{
      prompt: "raw FEN",
      provider_response: { reasoning: "深い読みλ".repeat(200_000) },
    }],
  }
  const encoded = await encodeRunItemPayload(payload)
  assert.ok(encoded.chunks.length > 1)
  const batch = {
    run_id: "run-large",
    item_id: "wwxHC",
    payload_sha256: encoded.descriptor.sha256,
    chunk_count: encoded.descriptor.chunk_count,
    chunks: encoded.chunks.map((payload_chunk, chunk_index) => ({ chunk_index, payload_chunk })),
  }
  assert.equal(isRunItemPayloadChunkBatch(batch), true)
  assert.equal(
    isRunItemPayloadChunkBatch({ ...batch, chunks: batch.chunks.slice(1) }),
    false,
    "the batch endpoint requires one complete dense chunk set",
  )

  const reference = runItemPayloadReferenceJSON(encoded.descriptor)
  assert.ok(reference.length < 512)
  assert.deepEqual(parseRunItemPayloadReference(reference), encoded.descriptor)

  const rows = encoded.chunks.map((payload_chunk, chunk_index) => ({
    chunk_index,
    chunk_count: encoded.descriptor.chunk_count,
    payload_chunk,
  }))
  assert.deepEqual(
    await reassembleRunItemPayload(encoded.descriptor, rows),
    payload,
  )
})

test("reassembly rejects missing or altered chunks", async () => {
  const encoded = await encodeRunItemPayload({ transcript: "x".repeat(200_000) })
  const rows = encoded.chunks.map((payload_chunk, chunk_index) => ({
    chunk_index,
    chunk_count: encoded.descriptor.chunk_count,
    payload_chunk,
  }))
  await assert.rejects(
    reassembleRunItemPayload(encoded.descriptor, rows.slice(1)),
    /incomplete run item payload/,
  )
  rows[0] = { ...rows[0], payload_chunk: `A${rows[0].payload_chunk.slice(1)}` }
  await assert.rejects(
    reassembleRunItemPayload(encoded.descriptor, rows),
    /sha256 mismatch/,
  )
})
