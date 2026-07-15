import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { BarChart3, CircleDollarSign, Database, Info, Trophy } from "lucide-react"
import { useData } from "@/lib/useData"
import type { RunIndexEntry } from "@/lib/data"
import { isModelVariant } from "@/lib/participants"
import { MODES, modeInfo, pct, pointsText, responseStyleInfo, type ResponseStyleKey } from "@/lib/format"
import { PuzzleNav } from "@/components/PuzzleNav"
import { ModelIdentity } from "@/components/ModelIdentity"
import { ResponseStyleToggle } from "@/components/ResponseStyle"
import { ExportButton } from "@/components/ExportButton"
import { SortableTableHead, type SortDirection } from "@/components/SortableTableHead"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type Mode = 1 | 2 | 3
type ModeMap = Partial<Record<Mode, RunIndexEntry>>
type SortKey = "model" | "rating" | "points" | "solved" | "legal" | "cost"

const rating = (run?: RunIndexEntry) => run?.summary.puzzle_performance_rating
const ratingText = (run?: RunIndexEntry) => {
  const estimate = rating(run)
  if (!estimate) return "—"
  if (!estimate.bounded) return estimate.rating <= 0 ? "< 0" : "> 4000"
  return String(Math.round(estimate.rating))
}

export function PuzzleLeaderboard() {
  const { runs } = useData()
  const [mode, setMode] = useState<Mode>(2)
  const [suite, setSuite] = useState("")
  const [responseStyle, setResponseStyle] = useState<ResponseStyleKey>("json_rationale")
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({ key: "points", direction: "desc" })
  const standard = useMemo(() => runs.filter((run) => run.track === "puzzle" && run.status === "completed" && isModelVariant(run.model_variant)), [runs])
  const suites = useMemo(() => Array.from(new Set(standard.map((run) => run.suite?.name).filter(Boolean))) as string[], [standard])
  const activeSuite = suite || suites[0] || "standard-lichess-v2"

  const grouped = useMemo(() => {
    const result = new Map<string, ModeMap>()
    for (const run of standard) {
      if (suites.length && run.suite?.name !== activeSuite) continue
      if (responseStyleInfo(run.condition).key !== responseStyle) continue
      const info = modeInfo(run.condition)
      if (!info) continue
      const modes = result.get(run.model_variant.key) ?? {}
      const current = modes[info.n]
      if (!current || run.created > current.created) modes[info.n] = run
      result.set(run.model_variant.key, modes)
    }
    return result
  }, [standard, suites.length, activeSuite, responseStyle])

  const rows = useMemo(() => [...grouped.values()].flatMap((modes) => modes[mode] ? [modes[mode]!] : []).toSorted((a, b) => {
    const direction = sort.direction === "asc" ? 1 : -1
    let value = 0
    if (sort.key === "model") value = a.model_variant.display_name.localeCompare(b.model_variant.display_name)
    else if (sort.key === "rating") value = (rating(a)?.rating ?? -1) - (rating(b)?.rating ?? -1)
    else if (sort.key === "points") value = a.summary.points - b.summary.points
    else if (sort.key === "solved") value = a.summary.solve_rate - b.summary.solve_rate
    else if (sort.key === "legal") value = a.summary.first_move_legal_rate - b.summary.first_move_legal_rate
    else value = (a.summary.cost_usd ?? Number.POSITIVE_INFINITY) - (b.summary.cost_usd ?? Number.POSITIVE_INFINITY)
    return value * direction
  }), [grouped, mode, sort])

  const toggle = (key: SortKey, initial: SortDirection = "desc") => setSort((current) => ({
    key,
    direction: current.key === key ? (current.direction === "desc" ? "asc" : "desc") : initial,
  }))
  const bestRating = rows.reduce<RunIndexEntry | undefined>((best, run) => (
    (rating(run)?.rating ?? -1) > (rating(best)?.rating ?? -1) ? run : best
  ), undefined)
  const totalCost = rows.reduce((sum, run) => sum + (run.summary.cost_usd ?? 0), 0)

  return (
    <div className="space-y-8">
      <section className="grid gap-6 border-b border-border/70 pb-8 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300"><BarChart3 className="size-4" /> Standard tactics</div>
          <h1 className="text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">Puzzle leaderboard</h1>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-muted-foreground">
            Tool-free model performance on fixed, rating-stratified Lichess tactics. Points decide rank; Puzzle Elo estimates the human puzzle rating at which the model would score about 50%.
          </p>
        </div>
        <PuzzleNav count={325} />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card><CardContent className="flex items-center gap-4 pt-6"><Trophy className="size-5 text-amber-500" /><div><div className="font-mono text-2xl font-semibold">{bestRating ? ratingText(bestRating) : "—"}</div><div className="text-xs text-muted-foreground">top Puzzle Elo · mode {mode}</div></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-4 pt-6"><BarChart3 className="size-5 text-emerald-600" /><div><div className="font-mono text-2xl font-semibold">{rows.length}</div><div className="text-xs text-muted-foreground">model-budget variants</div></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-4 pt-6"><Database className="size-5 text-violet-600" /><div><div className="font-mono text-2xl font-semibold">325</div><div className="text-xs text-muted-foreground">canonical public puzzles</div></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-4 pt-6"><CircleDollarSign className="size-5 text-sky-600" /><div><div className="font-mono text-2xl font-semibold">${totalCost.toFixed(2)}</div><div className="text-xs text-muted-foreground">provider-reported cost</div></div></CardContent></Card>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Info className="size-4" /><span><strong className="text-foreground">{activeSuite}</strong> · complete solves only affect Elo; partial line credit still earns points.</span></div>
          <div className="flex flex-wrap items-center gap-2">
            {suites.length > 1 && <Select value={activeSuite} onValueChange={setSuite}><SelectTrigger size="sm" className="w-48"><SelectValue /></SelectTrigger><SelectContent>{suites.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent></Select>}
            <ResponseStyleToggle value={responseStyle} onChange={setResponseStyle} />
            <Tabs value={String(mode)} onValueChange={(value) => setMode(Number(value) as Mode)}><TabsList className="h-9 border bg-card p-1">{MODES.map((item) => <TabsTrigger key={item.n} value={String(item.n)} className="h-7 text-xs">{item.n}. {item.name}</TabsTrigger>)}</TabsList></Tabs>
            <ExportButton track="puzzle" responseStyle={responseStyle} />
          </div>
        </div>

        {rows.length === 0 ? <Card className="border-border/70">
          <CardContent className="py-16 text-center sm:py-20">
            <div className="mx-auto grid size-10 place-items-center rounded-full bg-secondary"><BarChart3 className="size-4 text-muted-foreground" /></div>
            <div className="mt-3 font-medium">Clean slate—no published model scores yet</div>
            <div className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">The 325-puzzle bank and exact suite hashes are registered. The first durable run will appear here item by item without changing the corpus.</div>
            <Badge variant="outline" className="mt-3">mode {mode} · {responseStyle === "move_only" ? "move only" : "JSON + rationale"}</Badge>
          </CardContent>
        </Card> : <Card className="overflow-hidden border-border/70">
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="w-12 text-center">#</TableHead>
                <SortableTableHead label="Model configuration" active={sort.key === "model"} direction={sort.direction} onSort={() => toggle("model", "asc")} />
                <SortableTableHead label="Puzzle Elo" active={sort.key === "rating"} direction={sort.direction} align="right" onSort={() => toggle("rating")} />
                <SortableTableHead label="Points" active={sort.key === "points"} direction={sort.direction} align="right" onSort={() => toggle("points")} />
                <SortableTableHead label="Full solves" active={sort.key === "solved"} direction={sort.direction} align="right" onSort={() => toggle("solved")} />
                <SortableTableHead label="Legal first" active={sort.key === "legal"} direction={sort.direction} align="right" onSort={() => toggle("legal")} />
                <SortableTableHead label="Cost" active={sort.key === "cost"} direction={sort.direction} align="right" onSort={() => toggle("cost", "asc")} />
              </TableRow></TableHeader>
              <TableBody>
                {rows.map((run, index) => {
                  const estimate = rating(run)
                  return <TableRow key={run.run_id}>
                    <TableCell className="text-center font-mono text-xs text-muted-foreground">{index === 0 ? <Trophy className="mx-auto size-4 text-amber-500" /> : index + 1}</TableCell>
                    <TableCell><Link to={`/model/${encodeURIComponent(run.model_variant.key)}`}><ModelIdentity variant={run.model_variant} /></Link></TableCell>
                    <TableCell className="text-right"><div className="font-mono text-base font-semibold tabular-nums">{ratingText(run)}</div><div className="text-[11px] text-muted-foreground">{estimate?.ci95 ? `95% ${Math.round(estimate.ci95[0])}–${Math.round(estimate.ci95[1])}` : estimate ? `${estimate.n} puzzles · bound` : "not estimated"}</div></TableCell>
                    <TableCell className="text-right font-mono font-semibold">{pointsText(run.summary)}</TableCell>
                    <TableCell className="text-right tabular-nums">{run.summary.solved}/{run.summary.n}<div className="text-[11px] text-muted-foreground">{pct(run.summary.solve_rate)}</div></TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{pct(run.summary.first_move_legal_rate)}</TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">{run.summary.cost_usd == null ? "—" : `$${run.summary.cost_usd.toFixed(3)}`}</TableCell>
                  </TableRow>
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>}
      </section>
    </div>
  )
}
