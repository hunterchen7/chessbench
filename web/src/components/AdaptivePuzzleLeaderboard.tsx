import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Activity, ArrowRight, Check, CheckCircle2, ChevronDown, ChevronRight, CircleDollarSign, CircleHelp, Gauge, Search, ShieldCheck, Target } from "lucide-react"
import type { RatedSessionProtocol, RunIndexEntry } from "@/lib/data"
import { aggregateRatedRuns, type RatedRunAggregate } from "@/lib/ratedAggregates"
import { isModelVariant } from "@/lib/participants"
import { ModelIdentity } from "@/components/ModelIdentity"
import { SortableTableHead, type SortDirection } from "@/components/SortableTableHead"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItemIndicator, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { effectiveReasoningEffort, reasoningEffortLabel } from "@/lib/modelReasoning"
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

type RatingSortKey = "model" | "rating" | "spread" | "record" | "puzzles" | "runs" | "cost" | "status"

function reasoningEffort(run: RunIndexEntry) {
  return effectiveReasoningEffort(run.model_variant)
}

function aggregateStatusRank(aggregate: RatedRunAggregate) {
  if (aggregate.runs.some((run) => run.status === "running" || run.status === "partial")) return 3
  if (aggregate.settledRuns.length > 0) return 2
  return 1
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

function AggregateStatusBadge({ aggregate }: { aggregate: RatedRunAggregate }) {
  if (aggregate.runs.some((run) => run.status === "running" || run.status === "partial")) {
    return <Badge variant="outline" className="border-sky-500/35 bg-sky-500/8 text-sky-700 dark:text-sky-300"><Activity className="size-3" /> In progress</Badge>
  }
  if (aggregate.settledRuns.length > 0) {
    return <Badge variant="outline" className="border-emerald-500/35 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="size-3" /> Settled</Badge>
  }
  return <Badge variant="outline">Cap reached</Badge>
}

export function AdaptivePuzzleLeaderboard({ runs }: { runs: RunIndexEntry[] }) {
  const navigate = useNavigate()
  const [modelSearch, setModelSearch] = useState("")
  const [reasoningFilters, setReasoningFilters] = useState<Set<string>>(() => new Set())
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [sort, setSort] = useState<{ key: RatingSortKey; direction: SortDirection }>({ key: "rating", direction: "desc" })
  const ratedRuns = useMemo(() => runs.filter(isRated), [runs])
  const aggregates = useMemo(() => aggregateRatedRuns(ratedRuns), [ratedRuns])
  const reasoningOptions = useMemo(() => Array.from(new Set(ratedRuns.map(reasoningEffort))).toSorted((a, b) => {
    const order = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "budget", "provider"]
    const aRank = order.indexOf(a)
    const bRank = order.indexOf(b)
    return (aRank < 0 ? order.length : aRank) - (bRank < 0 ? order.length : bRank) || a.localeCompare(b)
  }), [ratedRuns])
  const visibleAggregates = useMemo(() => {
    const query = modelSearch.trim().toLocaleLowerCase()
    const filtered = aggregates.filter((aggregate) => {
      const run = aggregate.representative
      if (reasoningFilters.size > 0 && !reasoningFilters.has(reasoningEffort(run))) return false
      if (!query) return true
      return [run.model_variant.display_name, run.model_variant.label, run.model_variant.model_id, run.model_variant.provider]
        .some((value) => value?.toLocaleLowerCase().includes(query))
    })
    const value = (aggregate: RatedRunAggregate) => {
      const run = aggregate.representative
      if (sort.key === "model") return run.model_variant.display_name.toLocaleLowerCase()
      if (sort.key === "rating") return aggregate.meanRating ?? -Infinity
      if (sort.key === "spread") return aggregate.runStandardDeviation ?? Infinity
      if (sort.key === "record") return aggregate.attempted ? aggregate.solved / aggregate.attempted : -Infinity
      if (sort.key === "puzzles") return aggregate.attempted
      if (sort.key === "runs") return aggregate.completedRuns.length
      if (sort.key === "cost") return aggregate.cost
      return aggregateStatusRank(aggregate)
    }
    return filtered.toSorted((a, b) => {
      const aValue = value(a)
      const bValue = value(b)
      const comparison = typeof aValue === "string" && typeof bValue === "string" ? aValue.localeCompare(bValue) : Number(aValue) - Number(bValue)
      return comparison * (sort.direction === "asc" ? 1 : -1)
        || (b.meanRating ?? -Infinity) - (a.meanRating ?? -Infinity)
        || a.representative.model_variant.display_name.localeCompare(b.representative.model_variant.display_name)
    })
  }, [aggregates, modelSearch, reasoningFilters, sort])
  const reasoningFilterLabel = reasoningFilters.size === 0
    ? "All reasoning efforts"
    : reasoningFilters.size === 1
      ? reasoningEffortLabel(reasoningFilters.values().next().value ?? "")
      : `${reasoningFilters.size} reasoning efforts`
  const toggleReasoningFilter = (effort: string, checked: boolean) => setReasoningFilters((current) => {
    const next = new Set(current)
    if (checked) next.add(effort)
    else next.delete(effort)
    return next
  })
  const toggleSort = (key: RatingSortKey, initialDirection: SortDirection = key === "model" ? "asc" : "desc") => setSort((current) => current.key === key
    ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
    : { key, direction: initialDirection })
  const protocol = ratedRuns[0]?.protocol
  const targetRd = protocol?.stopping.target_rating_deviation ?? 75
  const totals = {
    models: aggregates.length,
    settled: aggregates.filter((aggregate) => aggregate.settledRuns.length > 0).length,
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
        <CardTitle className="flex items-center gap-2 text-base"><Target className="size-4 text-emerald-600" /> One protocol, one run is enough</CardTitle>
        <p className="max-w-4xl text-sm leading-relaxed text-muted-foreground">Every session starts at 1,500 and receives unused puzzles near its current rating; a complete solve is a Glicko win and any wrong or illegal move is a loss. A single run is a valid headline result. When additional seeded runs exist, the rating becomes their live average and run SD shows how much their paths disagree.</p>
      </CardHeader>
      <CardContent className="grid gap-3 py-4 text-xs sm:grid-cols-2 xl:grid-cols-4">
        {["Raw FEN + piece locations", "UCI move only", "No legal list or coaching", "Conversation continues within one puzzle"].map((label) => <div key={label} className="flex items-center gap-2 rounded-lg border bg-background/70 px-3 py-2"><CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" /><span>{label}</span></div>)}
      </CardContent>
    </Card>

    <Card className="overflow-hidden border-border/70">
      <CardHeader className="gap-4 border-b">
        <div className="space-y-1.5">
          <CardTitle className="text-base">Model ratings</CardTitle>
          <p className="max-w-4xl text-xs leading-relaxed text-muted-foreground">Each run stops after at least {protocol?.stopping.minimum_puzzles ?? 50} puzzles at RD ≤ {targetRd}, or at its safety cap. Current partial ratings appear immediately. When more than one run exists, the headline averages them and run SD measures their disagreement. Expand any configuration to inspect every session.</p>
        </div>
        {ratedRuns.length > 0 ? <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="relative block w-full sm:max-w-xs">
            <span className="sr-only">Filter model configurations</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="Filter model name…" className="bg-background pl-9" />
          </label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-full justify-between bg-background px-3 font-normal sm:w-52" aria-label={`Filter by reasoning effort: ${reasoningFilterLabel}`}>
                <span className="truncate">{reasoningFilterLabel}</span>
                <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-52">
              <DropdownMenuCheckboxItem
                checked={reasoningFilters.size === 0}
                onCheckedChange={() => setReasoningFilters(new Set())}
                onSelect={(event) => event.preventDefault()}
                className="relative flex cursor-pointer select-none items-center rounded-md py-2 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground"
              >
                <span className="absolute left-2 flex size-4 items-center justify-center"><DropdownMenuItemIndicator><Check className="size-4" /></DropdownMenuItemIndicator></span>
                All reasoning efforts
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              {reasoningOptions.map((effort) => <DropdownMenuCheckboxItem
                key={effort}
                checked={reasoningFilters.has(effort)}
                onCheckedChange={(checked) => toggleReasoningFilter(effort, checked === true)}
                onSelect={(event) => event.preventDefault()}
                className="relative flex cursor-pointer select-none items-center rounded-md py-2 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground"
              >
                <span className="absolute left-2 flex size-4 items-center justify-center"><DropdownMenuItemIndicator><Check className="size-4" /></DropdownMenuItemIndicator></span>
                {reasoningEffortLabel(effort)}
              </DropdownMenuCheckboxItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground sm:ml-auto">{visibleAggregates.length} of {aggregates.length} configurations</span>
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
          <SortableTableHead label="Rating" active={sort.key === "rating"} direction={sort.direction} align="right" onSort={() => toggleSort("rating")} suffix={<Tooltip><TooltipTrigger asChild><button type="button" className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Explain rating"><CircleHelp className="size-3.5" /></button></TooltipTrigger><TooltipContent side="top" sideOffset={8} className="max-w-xs space-y-1 px-3 py-2 leading-relaxed"><p>The current rating for one run, or the arithmetic mean when multiple seeded runs exist. Partial runs update this value as they progress.</p><p>Expand a configuration to see each session’s rating and RD.</p></TooltipContent></Tooltip>} />
          <SortableTableHead label="Run SD" active={sort.key === "spread"} direction={sort.direction} align="right" onSort={() => toggleSort("spread", "asc")} suffix={<Tooltip><TooltipTrigger asChild><button type="button" className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Explain run standard deviation"><CircleHelp className="size-3.5" /></button></TooltipTrigger><TooltipContent side="top" sideOffset={8} className="max-w-xs px-3 py-2 leading-relaxed">When multiple runs exist, this shows their rating variation. A single run remains a complete, valid leaderboard result.</TooltipContent></Tooltip>} />
          <SortableTableHead label="Record" active={sort.key === "record"} direction={sort.direction} align="right" onSort={() => toggleSort("record")} />
          <SortableTableHead label="Puzzles" active={sort.key === "puzzles"} direction={sort.direction} align="right" onSort={() => toggleSort("puzzles")} />
          <SortableTableHead label="Runs" active={sort.key === "runs"} direction={sort.direction} align="right" onSort={() => toggleSort("runs")} />
          <SortableTableHead label="Cost" active={sort.key === "cost"} direction={sort.direction} align="right" onSort={() => toggleSort("cost")} />
          <SortableTableHead label="Status" active={sort.key === "status"} direction={sort.direction} onSort={() => toggleSort("status")} />
          <TableHead className="w-10" />
        </TableRow></TableHeader>
        <TableBody>{visibleAggregates.length === 0 ? <TableRow><TableCell colSpan={10} className="h-32 text-center"><div className="font-medium">No matching model configurations</div><button type="button" className="mt-1 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground" onClick={() => { setModelSearch(""); setReasoningFilters(new Set()) }}>Clear filters</button></TableCell></TableRow> : visibleAggregates.flatMap((aggregate, index) => {
          const run = aggregate.representative
          const expanded = expandedKey === aggregate.key
          const visibleRunCount = aggregate.runs.filter((individual) => individual.status !== "failed").length
          const rows = [<TableRow key={aggregate.key} tabIndex={0} role="button" aria-expanded={expanded} className={cn("cursor-pointer transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none", aggregate.runs.some((individual) => individual.status === "running" || individual.status === "partial") && "bg-sky-500/[0.025]")} onClick={() => setExpandedKey((current) => current === aggregate.key ? null : aggregate.key)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setExpandedKey((current) => current === aggregate.key ? null : aggregate.key) }}>
            <TableCell className="text-center font-mono text-muted-foreground">{index + 1}</TableCell>
            <TableCell><ModelIdentity variant={run.model_variant} compact /><div className="mt-1 font-mono text-[10px] text-muted-foreground">{visibleRunCount} run{visibleRunCount === 1 ? "" : "s"}</div></TableCell>
            <TableCell className="text-right"><div className="whitespace-nowrap font-mono text-xl font-semibold tabular-nums">{aggregate.meanRating == null ? "—" : Math.round(aggregate.meanRating).toLocaleString()}</div><div className="text-[10px] text-muted-foreground">{aggregate.ratingRuns.length > 1 ? `mean of ${aggregate.ratingRuns.length} runs` : aggregate.ratingRuns.length === 0 ? "rating syncing" : aggregate.runs.some((individual) => individual.status === "running" || individual.status === "partial") ? "current estimate" : "single run"}</div></TableCell>
            <TableCell className="text-right"><div className="font-mono font-medium tabular-nums">{aggregate.runStandardDeviation == null ? "—" : `±${Math.round(aggregate.runStandardDeviation)}`}</div><div className="text-[10px] text-muted-foreground">{aggregate.runStandardDeviation == null ? "single run" : "between runs"}</div></TableCell>
            <TableCell className="text-right"><div className="font-mono font-medium">{aggregate.solved}–{aggregate.attempted - aggregate.solved}</div><div className="text-[10px] text-muted-foreground">{aggregate.attempted ? `${(aggregate.solved / aggregate.attempted * 100).toFixed(1)}% solved` : "—"}</div></TableCell>
            <TableCell className="text-right font-mono tabular-nums">{aggregate.attempted.toLocaleString()}</TableCell>
            <TableCell className="text-right font-mono tabular-nums">{visibleRunCount}</TableCell>
            <TableCell className="text-right font-mono text-xs">${aggregate.cost.toFixed(3)}</TableCell>
            <TableCell><AggregateStatusBadge aggregate={aggregate} /></TableCell>
            <TableCell>{expanded ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}</TableCell>
          </TableRow>]
          if (expanded) rows.push(...aggregate.runs.map((individual) => {
            const individualEstimate = rating(individual)
            return <TableRow key={individual.run_id} tabIndex={0} role="link" className="cursor-pointer bg-muted/20 transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none" onClick={() => navigate(runPath(individual))} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") navigate(runPath(individual)) }}>
              <TableCell />
              <TableCell className="pl-10"><div className="font-medium">Seed {individual.protocol.selection.seed}</div><div className="font-mono text-[10px] text-muted-foreground">{individual.run_id.slice(0, 8)}</div></TableCell>
              <TableCell className="text-right font-mono font-semibold tabular-nums">{individualEstimate ? <>{Math.round(individualEstimate.rating).toLocaleString()} <span className="text-xs font-normal text-muted-foreground">±{individualEstimate.rating_deviation == null ? "—" : Math.round(individualEstimate.rating_deviation)}</span></> : "—"}</TableCell>
              <TableCell className="text-right text-xs text-muted-foreground">individual RD</TableCell>
              <TableCell className="text-right"><div className="font-mono text-sm">{individual.summary.solved}–{individual.progress.completed - individual.summary.solved}</div></TableCell>
              <TableCell className="text-right font-mono text-sm tabular-nums">{individual.progress.completed}</TableCell>
              <TableCell className="text-right font-mono text-sm">1 run</TableCell>
              <TableCell className="text-right font-mono text-xs">{individual.summary.cost_usd == null ? "—" : `$${individual.summary.cost_usd.toFixed(3)}`}</TableCell>
              <TableCell><StatusBadge run={individual} /></TableCell>
              <TableCell><ArrowRight className="size-4 text-muted-foreground" /></TableCell>
            </TableRow>
          }))
          return rows
        })}</TableBody>
      </Table></div></TooltipProvider>}
    </Card>
  </div>
}
