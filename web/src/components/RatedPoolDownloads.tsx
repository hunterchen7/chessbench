import { Download, FileArchive, FileJson } from "lucide-react"
import { Button } from "@/components/ui/button"

const POOL_INDEX_URL = new URL(
  "../../../corpora/pools/rated-lichess-v1.index.json",
  import.meta.url,
).href
const POOL_ARTIFACT_URL = new URL(
  "../../../corpora/pools/rated-lichess-v1.csv.zst",
  import.meta.url,
).href
const POOL_MANIFEST_URL = new URL(
  "../../../corpora/pools/rated-lichess-v1.manifest.json",
  import.meta.url,
).href

export function RatedPoolDownloads() {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" asChild>
          <a href={POOL_INDEX_URL} download="rated-lichess-v1.index.json"><FileJson /> Download 100k index <span className="text-muted-foreground">1.7 MB</span></a>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <a href={POOL_ARTIFACT_URL} download="rated-lichess-v1.csv.zst"><FileArchive /> Full pool <span className="text-muted-foreground">4.9 MB</span></a>
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <a href={POOL_MANIFEST_URL} download="rated-lichess-v1.manifest.json"><Download /> Manifest + hashes</a>
        </Button>
      </div>
      <details className="rounded-lg border bg-muted/15 px-3 py-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">Exact pairing algorithm</summary>
        <ol className="mt-3 list-decimal space-y-2 pl-4 leading-relaxed">
          <li>Round the current solver rating with Python ties-to-even rounding and begin with its inclusive ±100 rating band.</li>
          <li>Remove puzzle IDs already used in this run. If none remain, expand the radius by 100 and repeat.</li>
          <li>For every eligible ID, SHA-256 the UTF-8 identity below and choose the smallest digest bytes; puzzle ID breaks an impossible digest tie.</li>
          <li>After a solve or miss, apply the frozen-puzzle Glicko-2 update and increment the sequence before pairing again.</li>
        </ol>
        <code className="mt-3 block overflow-x-auto rounded bg-background p-2 text-[11px] text-foreground">deterministic_rating_band_v1:&lt;pool_hash&gt;:&lt;seed&gt;:&lt;sequence&gt;:&lt;puzzle_id&gt;</code>
        <p className="mt-2">Same pool hash + seed + outcome history therefore produces the same path for humans and benchmarked models.</p>
      </details>
    </div>
  )
}
