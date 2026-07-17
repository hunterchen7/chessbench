import { useEffect, useState } from "react"
import { BookMarked, Boxes, Fingerprint } from "lucide-react"
import { loadSuiteCatalog, type SuiteCatalog, type SuiteCatalogEntry } from "@/lib/data"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"

function findSuite(catalog: SuiteCatalog | null | undefined, name: string) {
  return catalog?.suites.find((suite) => suite.name === name) ?? null
}

function Details({ suite }: { suite: SuiteCatalogEntry }) {
  return (
    <dl className="grid grid-cols-3 gap-3 rounded-xl border bg-background/65 p-3 text-xs sm:min-w-[310px]">
      <div>
        <dt className="text-muted-foreground">Release</dt>
        <dd className="mt-1 font-mono font-semibold">{suite.version}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Tasks</dt>
        <dd className="mt-1 flex items-center gap-1 font-mono font-semibold"><Boxes className="size-3" /> {suite.items}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Pinned build</dt>
        <dd className="mt-1 flex items-center gap-1 font-mono font-semibold" title={suite.content_hash}>
          <Fingerprint className="size-3" /> {suite.content_hash.replace("sha256:", "").slice(0, 8)}
        </dd>
      </div>
    </dl>
  )
}

export function SuiteDescriptor({ name }: { name: string }) {
  const [catalog, setCatalog] = useState<SuiteCatalog | null | undefined>(undefined)

  useEffect(() => {
    let active = true
    void loadSuiteCatalog().then((next) => {
      if (active) setCatalog(next)
    }).catch(() => {
      if (active) setCatalog(null)
    })
    return () => { active = false }
  }, [])

  const suite = findSuite(catalog, name)
  if (catalog === undefined) {
    return <div className="h-28 animate-pulse rounded-xl border bg-muted/25" aria-label={`Loading ${name} description`} />
  }
  if (!suite) return null

  return (
    <Card className="overflow-hidden border-border/70 bg-muted/[0.18]">
      <CardContent className="grid gap-5 pt-6 md:grid-cols-[auto_1fr_auto] md:items-center">
        <div className="grid size-11 place-items-center rounded-xl border bg-background text-muted-foreground shadow-xs">
          <BookMarked className="size-5" />
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">About this suite</h2>
            <Badge variant="outline" className="font-mono font-normal">{suite.name}</Badge>
            {suite.current ? <Badge variant="secondary">Current release</Badge> : <Badge variant="outline">Historical release</Badge>}
          </div>
          <p className="mt-2 max-w-4xl text-sm leading-relaxed text-muted-foreground">{suite.description}</p>
        </div>
        <Details suite={suite} />
      </CardContent>
    </Card>
  )
}
