export const RUN_ITEM_PAYLOAD_INLINE_BYTES = 512 * 1024
export const RUN_ITEM_PAYLOAD_CHUNK_BYTES = 128 * 1024
export const RUN_ITEM_PAYLOAD_ENCODING = "json-utf8-base64-v1"
export const RUN_ITEM_PAYLOAD_REFERENCE_KEY = "$chessbench_payload_chunks"

export interface RunItemPayloadChunks {
  version: 1
  encoding: typeof RUN_ITEM_PAYLOAD_ENCODING
  sha256: string
  byte_length: number
  chunk_count: number
}

export interface StoredRunItemPayloadChunk {
  chunk_index: number
  chunk_count: number
  payload_chunk: string
}

export interface EncodedRunItemPayload {
  descriptor: RunItemPayloadChunks
  chunks: string[]
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export function isRunItemPayloadChunks(value: unknown): value is RunItemPayloadChunks {
  if (!isObject(value)) return false
  return value.version === 1 &&
    value.encoding === RUN_ITEM_PAYLOAD_ENCODING &&
    typeof value.sha256 === "string" && /^[0-9a-f]{64}$/.test(value.sha256) &&
    Number.isInteger(value.byte_length) && Number(value.byte_length) >= 0 &&
    Number.isInteger(value.chunk_count) && Number(value.chunk_count) > 0 &&
    Number(value.chunk_count) <= 10_000
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes)
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

/** Encode one full JSON payload into D1-safe base64 rows without losing content. */
export async function encodeRunItemPayload(payload: Record<string, unknown>): Promise<EncodedRunItemPayload> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  const chunks: string[] = []
  for (let offset = 0; offset < bytes.length; offset += RUN_ITEM_PAYLOAD_CHUNK_BYTES) {
    chunks.push(bytesToBase64(bytes.subarray(offset, offset + RUN_ITEM_PAYLOAD_CHUNK_BYTES)))
  }
  return {
    descriptor: {
      version: 1,
      encoding: RUN_ITEM_PAYLOAD_ENCODING,
      sha256: await sha256Hex(bytes),
      byte_length: bytes.length,
      chunk_count: chunks.length,
    },
    chunks,
  }
}

export function runItemPayloadReferenceJSON(descriptor: RunItemPayloadChunks): string {
  return JSON.stringify({ [RUN_ITEM_PAYLOAD_REFERENCE_KEY]: descriptor })
}

/** Return null for legacy/inline payload_json rows. */
export function parseRunItemPayloadReference(payloadJSON: string): RunItemPayloadChunks | null {
  let value: unknown
  try {
    value = JSON.parse(payloadJSON)
  } catch {
    return null
  }
  if (!isObject(value) || Object.keys(value).length !== 1) return null
  const descriptor = value[RUN_ITEM_PAYLOAD_REFERENCE_KEY]
  return isRunItemPayloadChunks(descriptor) ? descriptor : null
}

export function parseInlineRunItemPayload(payloadJSON: string): Record<string, unknown> {
  const payload = JSON.parse(payloadJSON) as unknown
  if (!isObject(payload)) throw new Error("stored run item payload is not a JSON object")
  return payload
}

/** Reassemble and authenticate a chunked payload before exposing it through the API. */
export async function reassembleRunItemPayload(
  descriptor: RunItemPayloadChunks,
  rows: StoredRunItemPayloadChunk[],
): Promise<Record<string, unknown>> {
  const ordered = [...rows].sort((a, b) => a.chunk_index - b.chunk_index)
  if (ordered.length !== descriptor.chunk_count) {
    throw new Error(`incomplete run item payload: expected ${descriptor.chunk_count} chunks, found ${ordered.length}`)
  }
  const decoded: Uint8Array[] = []
  let byteLength = 0
  for (let index = 0; index < ordered.length; index += 1) {
    const row = ordered[index]
    if (row.chunk_index !== index || row.chunk_count !== descriptor.chunk_count) {
      throw new Error(`invalid run item payload chunk ${row.chunk_index}`)
    }
    const bytes = base64ToBytes(row.payload_chunk)
    decoded.push(bytes)
    byteLength += bytes.length
  }
  if (byteLength !== descriptor.byte_length) {
    throw new Error(`run item payload byte length mismatch: expected ${descriptor.byte_length}, found ${byteLength}`)
  }
  const payloadBytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of decoded) {
    payloadBytes.set(chunk, offset)
    offset += chunk.length
  }
  if (await sha256Hex(payloadBytes) !== descriptor.sha256) {
    throw new Error("run item payload sha256 mismatch")
  }
  const payload = JSON.parse(
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(payloadBytes),
  ) as unknown
  if (!isObject(payload)) throw new Error("chunked run item payload is not a JSON object")
  return payload
}
