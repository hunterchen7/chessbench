import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Activity, ArrowRight, CheckCircle2, CircleDollarSign, CircleHelp, Gauge, Search, ShieldCheck, Target } from "lucide-react"
import type { RatedSessionProtocol, RunIndexEntry } from "@/lib/data"
import { isModelVariant } from "@/lib/participants"
import { ModelIdentity } from "@/components/ModelIdentity"
import { SortableTableHead, type SortDirection } from "@/components/SortableTableHead"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

function isRated(run: RunIndexEntry): run is RunIndexEntry & { protocol: RatedSessionProtocol } {
  return run.track === "puzzle" && run.protocol?.kind === "adaptive_glicko2" && isModelVariant(run.model_variant)
}

function rating(run: RunIndexEntry) {
  return run.summary.puzzle_performance_rating
}

function runPath(run: RunIndexEntry) {
  return `/model/${encodeURIComponent(run.model_variant.key)}?run=${encodeURIComponent(run.run_id)}`
}

type RatingSortKey = "model" | "rating" | "record" | "puzzles" | "cost" | "status"

function reasoningEffort(run: RunIndexEntry) {
  return run.condition.reasoning_effort ?? run.model_variant.reasoning.effort ?? "default"
}

function statusRank(run: RunIndexEntry) {
  if (run.status === "running" || run.status === "partial") return 1
  return rating(run)?.settled ? 3 : 2
}

function StatusBadge({ run }: { run: RunIndexEntry }) {
  const estimate = rating(run)
  if (run.status === "running" || run.status === "partial") {
    return <Badge variant="outline" className="border-sky-500/35 bg-sky-500/8 text-sky-700 dark:text-sky-300"><Activity className="size-3" /> In progress</Badge>
  }
  if (estimate?.settled) {
    return <Badge variant="outline" className="border-emerald-500/35 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="size-3" /> Settled</Badge>
  }
  return <Badge variant="outline">Cap reached</Badge>
}

export function AdaptivePuzzleLeaderboard({ runs }: { runs: RunIndexEntry[] }) {
  const navigate = useNavigate()
  const [modelSearch, setModelSearch] = useState("")
  const [reasoningFilter, setReasoningFilter] = useState("all")
  const [sort, setSort] = useState<{ key: RatingSortKey; direction: SortDirection }>({ key: "rating", direction: "desc" })
  const ratedRuns = useMemo(() => runs.filter(isRated), [runs])
  const reasoningOptions = useMemo(() => Array.from(new Set(ratedRuns.map(reasoningEffort))).toSorted((a, b) => {
    const order = ["minimal", "low", "medium", "high", "max", "default"]
    const aRank = order.indexOf(a)
    const bRank = order.indexOf(b)
    return (aRank < 0 ? order.length : aRank) - (bRank < 0 ? order.length : bRank) || a.localeCompare(b)
  }), [ratedRuns])
  const visibleRuns = useMemo(() => {
    const query = modelSearch.trim().toLocaleLowerCase()
    const filtered = ratedRuns.filter((run) => {
      if (reasoningFilter !== "all" && reasoningEffort(run) !== reasoningFilter) return false
      if (!query) return true
      return [run.model_variant.display_name, run.model_variant.label, run.model_variant.model_id, run.model_variant.provider]
        .some((value) => value?.toLocaleLowerCase().includes(query))
    })
    const value = (run: RunIndexEntry) => {
      if (sort.key === "model") return run.model_variant.display_name.toLocaleLowerCase()
      if (sort.key === "rating") return rating(run)?.rating ?? -Infinity
      if (sort.key === "record") return run.summary.solve_rate
      if (sort.key === "puzzles") return run.progress.completed
      if (sort.key === "cost") return run.summary.cost_usd ?? -Infinity
      return statusRank(run)
    }
    return filtered.toSorted((a, b) => {
      const aValue = value(a)
      const bValue = value(b)
      const comparison = typeof aValue === "string" && typeof bValue === "string" ? aValue.localeCompare(bValue) : Number(aValue) - Number(bValue)
      return comparison * (sort.direction === "asc" ? 1 : -1)
        || (rating(b)?.rating ?? -Infinity) - (rating(a)?.rating ?? -Infinity)
        || a.model_variant.display_name.localeCompare(b.model_variant.display_name)
    })
  }, [modelSearch, ratedRuns, reasoningFilter, sort])
  const toggleSort = (key: RatingSortKey, initialDirection: SortDirection = key === "model" ? "asc" : "desc") => setSort((current) => current.key === key
    ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
    : { key, direction: initialDirection })
  const protocol = ratedRuns[0]?.protocol
  const targetRd = protocol?.stopping.target_rating_deviation ?? 75
  const completed = ratedRuns.filter((run) => run.status === "completed")
  const totals = {
    models: new Set(ratedRuns.map((run) => run.model_variant.key)).size,
    settled: completed.filter((run) => rating(run)?.settled).length,
    attempts: ratedRuns.reduce((sum, run) => sum + run.progress.completed, 0),
    cost: ratedRuns.reduce((sum, run) => sum + (run.summary.cost_usd ?? 0), 0),
  }

  return <div className="space-y-7">
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Card><CardContent className="flex items-center gap-4 pt-6"><Gauge className="size-5 text-emerald-600" /><div><div className="font-mono text-2xl font-semibold">{totals.models}</div><div className="text-xs text-muted-foreground">rated configurations</div></div></CardContent></Card>
      <Card><CardContent className="flex items-center gap-4 pt-6"><ShieldCheck className="size-5 text-violet-600" /><div><div className="font-mono text-2xl font-semibold">{totals.settled}</div><div className="text-xs text-muted-foreground">settled ratings</div></div></CardContent></Card>
      <Card><CardContent className="flex items-center gap-4 pt-6"><Target className="size-5 text-amber-500" /><div><div className="font-mono text-2xl font-semibold">{totals.attempts.toLocaleString()}</div><div className="text-xs text-muted-foreground">adaptive puzzles played</div></div></CardContent></Card>
      <Card><CardContent className="flex items-center gap-4 pt-6"><CircleDollarSign className="size-5 text-sky-600" /><div><div className="font-mono text-2xl font-semibold">${totals.cost.toFixed(2)}</div><div className="text-xs text-muted-foreground">recorded provider cost</div></div></CardContent></Card>
    </section>

    <Card className="overflow-hidden border-emerald-500/20 bg-emerald-500/[0.025]">
      <CardHeader className="gap-2 border-b border-emerald-500/15">
        <CardTitle className="flex items-center gap-2 text-base"><Target className="size-4 text-emerald-600" /> One canonical chess test</CardTitle>
        <p className="max-w-4xl text-sm leading-relaxed text-muted-foreground">Each model starts at 1,500 with high uncertainty and receives deterministic, unused puzzles near its current rating. Puzzle ratings stay frozen. A complete solve is a Glicko win; any wrong or illegal move is a loss. The session stops after at least {protocol?.stopping.minimum_puzzles ?? 50} puzzles when RD reaches {protocol?.stopping.target_rating_deviation ?? 75}, or at {protocol?.stopping.maximum_puzzles ?? 100} puzzles.</p>
      </CardHeader>
      <CardContent className="grid gap-3 py-4 text-xs sm:grid-cols-2 xl:grid-cols-4">
        {["Raw FEN + piece locations", "UCI move only", "No legal list or coaching", "Conversation continues within one puzzle"].map((label) => <div key={label} className="flex items-center gap-2 rounded-lg border bg-background/70 px-3 py-2"><CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" /><span>{label}</span></div>)}
      </CardContent>
    </Card>

    <Card className="overflow-hidden border-border/70">
      <CardHeader className="gap-4 border-b">
        <div className="space-y-1.5">
          <CardTitle className="text-base">Model ratings</CardTitle>
          <p className="max-w-4xl text-xs leading-relaxed text-muted-foreground">Performance moves the rating; evidence narrows RD. Because settled sessions share an RD ≤ {targetRd} stopping rule, their final uncertainty is expected to be similar. Configurations include provider, reasoning budget, and output policy.</p>
        </div>
        {ratedRuns.length > 0 ? <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="relative block w-full sm:max-w-xs">
            <span className="sr-only">Filter model configurations</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="Filter model name…" className="bg-background pl-9" />
          </label>
          <Select value={reasoningFilter} onValueChange={setReasoningFilter}>
            <SelectTrigger className="w-full bg-background sm:w-48" aria-label="Filter by reasoning effort"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All reasoning efforts</SelectItem>
              {reasoningOptions.map((effort) => <SelectItem key={effort} value={effort}>{effort === "default" ? "Default" : effort[0].toUpperCase() + effort.slice(1)} reasoning</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground sm:ml-auto">{visibleRuns.length} of {ratedRuns.length} configurations</span>
        </div> : null}
      </CardHeader>
      {ratedRuns.length === 0 ? <CardContent className="py-16 text-center">
        <div className="mx-auto grid size-11 place-items-center rounded-full bg-secondary"><Gauge className="size-5 text-muted-foreground" /></div>
        <div className="mt-3 font-medium">No adaptive ratings have been published yet</div>
        <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">The calibrated 100,000-puzzle pool and runner are ready. Fixed-suite results remain available in the suite lab while the first canonical session is published.</p>
      </CardContent> : <TooltipProvider delayDuration={150}><div className="overflow-x-auto"><Table className="min-w-[980px]">
        <TableHeader><TableRow>
          <TableHead className="w-14 text-center">#</TableHead>
          <SortableTableHead label="Model configuration" active={sort.key === "model"} direction={sort.direction} onSort={() => toggleSort("model")} />
          <SortableTableHead label="Rating ± RD" active={sort.key === "rating"} direction={sort.direction} align="right" onSort={() => toggleSort("rating")} suffix={<Tooltip><TooltipTrigger asChild><button type="button" className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Explain rating deviation"><CircleHelp className="size-3.5" /></button></TooltipTrigger><TooltipContent side="top" sideOffset={8} className="max-w-xs space-y-1 px-3 py-2 leading-relaxed"><p>Rating is estimated playing strength. RD is one standard deviation of uncertainty, not performance.</p><p>A 95% interval is approximately rating ± 1.96 RD. Settled runs intentionally converge near RD {targetRd}.</p></TooltipContent></Tooltip>} />
          <SortableTableHead label="Record" active={sort.key === "record"} direction={sort.direction} align="right" onSort={() => toggleSort("record")} />
          <SortableTableHead label="Puzzles" active={sort.key === "puzzles"} direction={sort.direction} align="right" onSort={() => toggleSort("puzzles")} />
          <SortableTableHead label="Cost" active={sort.key === "cost"} direction={sort.direction} align="right" onSort={() => toggleSort("cost")} />
          <SortableTableHead label="Status" active={sort.key === "status"} direction={sort.direction} onSort={() => toggleSort("status")} />
          <TableHead className="w-10" />
        </TableRow></TableHeader>
        <TableBody>{visibleRuns.length === 0 ? <TableRow><TableCell colSpan={8} className="h-32 text-center"><div className="font-medium">No matching model configurations</div><button type="button" className="mt-1 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground" onClick={() => { setModelSearch(""); setReasoningFilter("all") }}>Clear filters</button></TableCell></TableRow> : visibleRuns.map((run, index) => {
          const estimate = rating(run)
          return <TableRow key={run.run_id} tabIndex={0} role="link" className={cn("cursor-pointer transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none", run.status !== "completed" && "bg-sky-500/[0.025]")} onClick={() => navigate(runPath(run))} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") navigate(runPath(run)) }}>
            <TableCell className="text-center font-mono text-muted-foreground">{index + 1}</TableCell>
            <TableCell><ModelIdentity variant={run.model_variant} compact /><div className="mt-1 font-mono text-[10px] text-muted-foreground">seed {run.protocol.selection.seed} · {run.condition.reasoning_effort ?? "default"} reasoning</div></TableCell>
            <TableCell className="text-right"><div className="whitespace-nowrap font-mono text-xl font-semibold tabular-nums">{estimate ? <>{Math.round(estimate.rating).toLocaleString()} <span className="text-sm font-medium text-muted-foreground">±{estimate.rating_deviation == null ? "—" : Math.round(estimate.rating_deviation)}</span></> : "—"}</div>{estimate?.provisional ? <div className="text-[10px] uppercase tracking-wide text-muted-foreground">provisional</div> : null}</TableCell>
            <TableCell className="text-right"><div className="font-mono font-medium">{run.summary.solved}–{run.progress.completed - run.summary.solved}</div><div className="text-[10px] text-muted-foreground">{(run.summary.solve_rate * 100).toFixed(1)}% solved</div></TableCell>
            <TableCell className="text-right font-mono tabular-nums">{run.progress.completed}<span className="text-muted-foreground">/{run.progress.total}</span></TableCell>
            <TableCell className="text-right font-mono text-xs">{run.summary.cost_usd == null ? "—" : `$${run.summary.cost_usd.toFixed(3)}`}</TableCell>
            <TableCell><StatusBadge run={run} /></TableCell>
            <TableCell><ArrowRight className="size-4 text-muted-foreground" /></TableCell>
          </TableRow>
        })}</TableBody>
      </Table></div></TooltipProvider>}
    </Card>
  </div>
}
