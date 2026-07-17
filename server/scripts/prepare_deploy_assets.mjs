import { rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"

// Detailed run snapshots are durable in D1 and served by /api/runs/:id. Keep
// them in web/public for local/offline exports, but do not duplicate them into
// Workers Assets where Cloudflare enforces a 25 MiB per-file limit.
const deployRunSnapshots = fileURLToPath(
  new URL("../../web/dist/data/runs", import.meta.url),
)

await rm(deployRunSnapshots, { recursive: true, force: true })
console.log("Excluded static run snapshots from the Cloudflare asset bundle")
