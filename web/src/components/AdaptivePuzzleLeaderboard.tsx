import { type ReactNode, useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Activity, ArrowRight, Check, CheckCircle2, ChevronDown, ChevronRight, CircleDollarSign, CircleHelp, Gauge, Layers3, List, Play, Search, ShieldCheck, Target } from "lucide-react"
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
import { reasoningConfigurationEffort, reasoningEffortLabel } from "@/lib/modelReasoning"
import { ratedPlayPath } from "@/lib/ratedPlay"
import { formatRatingDeviation } from "@/lib/format"
import { cn } from "@/lib/utils"

function isRated(run: RunIndexEntry): run is RunIndexEntry & { protocol: RatedSessionProtocol } {
  return run.track === "puzzle" && run.protocol?.kind === "adaptive_glicko2" && isModelVariant(run.model_variant)
}

function rating(run: RunIndexEntry) {
  return run.summary.puzzle_performance_rating
}

function aggregateIsProvisional(aggregate: RatedRunAggregate) {
  return aggregate.ratingRuns.some((run) => rating(run)?.provisional !== false)
}

function RatingEstimate({
  rating: value,
  deviation,
  provisional,
  className = "text-xl",
}: {
  rating: number | null
  deviation: number | null
  provisional: boolean
  className?: string
}) {
  if (value == null) return <><div className={cn("font-mono font-semibold", className)}>—</div><div className="text-[10px] text-muted-foreground">rating syncing</div></>
  return <>
    <div className={cn("whitespace-nowrap font-mono font-semibold tabular-nums", className)}>{Math.round(value).toLocaleString()}</div>
    <div className="whitespace-nowrap font-mono text-[10px] text-muted-foreground">
      RD {formatRatingDeviation(deviation)}{provisional ? " · provisional" : " · settled"}
    </div>
  </>
}

function runPath(run: RunIndexEntry) {
  return `/model/${encodeURIComponent(run.model_variant.key)}?run=${encodeURIComponent(run.run_id)}`
}

type RatingSortKey = "model" | "rating" | "spread" | "record" | "puzzles" | "runs" | "cost" | "status"
type LeaderboardView = "model" | "configuration"

interface RatedModelGroup {
  key: string
  configurations: RatedRunAggregate[]
  representative: RatedRunAggregate
  bestRating: number | null
  minimumRating: number | null
  maximumRating: number | null
  solved: number
  attempted: number
  cost: number
  visibleRunCount: number
}

const REASONING_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "budget", "provider"]
const LEADERBOARD_VIEW_STORAGE_KEY = "chessbench.puzzle-leaderboard-view.v1"

function savedLeaderboardView(): LeaderboardView {
  try {
    const saved = localStorage.getItem(LEADERBOARD_VIEW_STORAGE_KEY)
    return saved === "configuration" || saved === "model" ? saved : "model"
  } catch {
    return "model"
  }
}

function reasoningEffort(run: RunIndexEntry) {
  return reasoningConfigurationEffort(run.model_variant)
}

function aggregateStatusRank(aggregate: RatedRunAggregate) {
  if (aggregate.runs.some((run) => run.status === "running" || run.status === "partial")) return 3
  if (aggregate.settledRuns.length > 0) return 2
  return 1
}

function runStatusRank(run: RunIndexEntry) {
  if (run.status === "running" || run.status === "partial") return 3
  if (rating(run)?.settled) return 2
  return 1
}

type SortValue = string | number | null

function compareSortValues(a: SortValue, b: SortValue, direction: SortDirection) {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  const comparison = typeof a === "string" && typeof b === "string" ? a.localeCompare(b) : Number(a) - Number(b)
  return comparison * (direction === "asc" ? 1 : -1)
}

function configurationSortValue(aggregate: RatedRunAggregate, key: RatingSortKey): SortValue {
  if (key === "model") return reasoningEffortLabel(reasoningEffort(aggregate.representative)).toLocaleLowerCase()
  if (key === "rating") return aggregate.meanRating
  if (key === "spread") return aggregate.runStandardDeviation
  if (key === "record") return aggregate.attempted ? aggregate.solved / aggregate.attempted : null
  if (key === "puzzles") return aggregate.attempted
  if (key === "runs") return aggregate.runs.filter((run) => run.status !== "failed").length
  if (key === "cost") return aggregate.cost
  return aggregateStatusRank(aggregate)
}

function individualRunSortValue(run: RatedRunAggregate["runs"][number], key: RatingSortKey): SortValue {
  const estimate = rating(run)
  if (key === "model") return run.protocol.selection.seed
  if (key === "rating") return estimate?.rating ?? null
  if (key === "spread") return estimate?.rating_deviation ?? null
  if (key === "record") return run.progress.completed ? run.summary.solved / run.progress.completed : null
  if (key === "puzzles") return run.progress.completed
  if (key === "runs") return 1
  if (key === "cost") return run.summary.cost_usd
  return runStatusRank(run)
}

function modelGroupStatusRank(group: RatedModelGroup) {
  if (group.configurations.some((aggregate) => aggregate.runs.some((run) => run.status === "running" || run.status === "partial"))) return 3
  if (group.configurations.some((aggregate) => aggregate.settledRuns.length > 0)) return 2
  return 1
}

function modelGroupKey(aggregate: RatedRunAggregate) {
  const run = aggregate.representative
  return [
    run.model_variant.base_key,
    run.protocol.pool.content_hash,
    run.protocol.version,
    run.protocol.prompt.version,
  ].join("::")
}

function groupRatedModels(aggregates: RatedRunAggregate[]): RatedModelGroup[] {
  const groups = new Map<string, RatedRunAggregate[]>()
  aggregates.forEach((aggregate) => {
    const key = modelGroupKey(aggregate)
    const current = groups.get(key)
    if (current) current.push(aggregate)
    else groups.set(key, [aggregate])
  })

  return Array.from(groups, ([key, configurations]) => {
    const ordered = configurations.toSorted((a, b) => {
      const aEffort = reasoningEffort(a.representative)
      const bEffort = reasoningEffort(b.representative)
      const aRank = REASONING_ORDER.indexOf(aEffort)
      const bRank = REASONING_ORDER.indexOf(bEffort)
      return (aRank < 0 ? REASONING_ORDER.length : aRank) - (bRank < 0 ? REASONING_ORDER.length : bRank)
        || aEffort.localeCompare(bEffort)
        || (b.meanRating ?? -Infinity) - (a.meanRating ?? -Infinity)
    })
    const ratings = ordered.flatMap((aggregate) => aggregate.meanRating == null ? [] : [aggregate.meanRating])
    const representative = ordered.toSorted((a, b) =>
      (b.meanRating ?? -Infinity) - (a.meanRating ?? -Infinity)
      || a.representative.model_variant.display_name.localeCompare(b.representative.model_variant.display_name),
    )[0]
    return {
      key,
      configurations: ordered,
      representative,
      bestRating: ratings.length > 0 ? Math.max(...ratings) : null,
      minimumRating: ratings.length > 0 ? Math.min(...ratings) : null,
      maximumRating: ratings.length > 0 ? Math.max(...ratings) : null,
      solved: ordered.reduce((sum, aggregate) => sum + aggregate.solved, 0),
      attempted: ordered.reduce((sum, aggregate) => sum + aggregate.attempted, 0),
      cost: ordered.reduce((sum, aggregate) => sum + aggregate.cost, 0),
      visibleRunCount: ordered.reduce((sum, aggregate) => sum + aggregate.runs.filter((run) => run.status !== "failed").length, 0),
    }
  })
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

function ModelGroupStatusBadge({ group }: { group: RatedModelGroup }) {
  if (modelGroupStatusRank(group) === 3) {
    return <Badge variant="outline" className="border-sky-500/35 bg-sky-500/8 text-sky-700 dark:text-sky-300"><Activity className="size-3" /> In progress</Badge>
  }
  if (modelGroupStatusRank(group) === 2) {
    return <Badge variant="outline" className="border-emerald-500/35 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="size-3" /> Settled</Badge>
  }
  return <Badge variant="outline">Cap reached</Badge>
}

function ModelGroupIdentity({ group }: { group: RatedModelGroup }) {
  const variant = group.representative.representative.model_variant
  const efforts = Array.from(new Set(group.configurations.map((aggregate) => reasoningEffort(aggregate.representative))))
  return <div className="min-w-0">
    <div className="truncate font-medium">{variant.display_name}</div>
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      <Badge variant="outline" className="h-5 border-border/70 px-1.5 text-[10px] font-normal uppercase tracking-wide">{variant.provider}</Badge>
      <span className="text-[10px] text-muted-foreground">
        {group.configurations.length} reasoning configuration{group.configurations.length === 1 ? "" : "s"} · {efforts.map(reasoningEffortLabel).join(", ")}
      </span>
    </div>
  </div>
}

function AnimatedDetailCell({
  open,
  className,
  children,
}: {
  open: boolean
  className?: string
  children?: ReactNode
}) {
  return <TableCell className="p-0">
    <div className={cn(
      "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
      open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
    )}>
      <div className="min-h-0 overflow-hidden">
        <div className={cn(
          "px-2 transition-[padding] duration-200 ease-out motion-reduce:transition-none",
          open ? "py-2" : "py-0",
          className,
        )}>{children}</div>
      </div>
    </div>
  </TableCell>
}

export function AdaptivePuzzleLeaderboard({ runs }: { runs: RunIndexEntry[] }) {
  const navigate = useNavigate()
  const [modelSearch, setModelSearch] = useState("")
  const [reasoningFilters, setReasoningFilters] = useState<Set<string>>(() => new Set())
  const [view, setView] = useState<LeaderboardView>(savedLeaderboardView)
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set())
  const [expandedModelKeys, setExpandedModelKeys] = useState<Set<string>>(() => new Set())
  const [expandedConfigurationKeys, setExpandedConfigurationKeys] = useState<Set<string>>(() => new Set())
  const [sort, setSort] = useState<{ key: RatingSortKey; direction: SortDirection }>({ key: "rating", direction: "desc" })
  useEffect(() => {
    try {
      localStorage.setItem(LEADERBOARD_VIEW_STORAGE_KEY, view)
    } catch {
      // Private browsing or storage policy can make persistence unavailable.
    }
  }, [view])
  const ratedRuns = useMemo(() => runs.filter(isRated), [runs])
  const aggregates = useMemo(() => aggregateRatedRuns(ratedRuns), [ratedRuns])
  const modelGroups = useMemo(() => groupRatedModels(aggregates), [aggregates])
  const reasoningOptions = useMemo(() => Array.from(new Set(ratedRuns.map(reasoningEffort))).toSorted((a, b) => {
    const aRank = REASONING_ORDER.indexOf(a)
    const bRank = REASONING_ORDER.indexOf(b)
    return (aRank < 0 ? REASONING_ORDER.length : aRank) - (bRank < 0 ? REASONING_ORDER.length : bRank) || a.localeCompare(b)
  }), [ratedRuns])
  const filteredAggregates = useMemo(() => {
    const query = modelSearch.trim().toLocaleLowerCase()
    return aggregates.filter((aggregate) => {
      const run = aggregate.representative
      if (reasoningFilters.size > 0 && !reasoningFilters.has(reasoningEffort(run))) return false
      if (!query) return true
      return [run.model_variant.display_name, run.model_variant.label, run.model_variant.model_id, run.model_variant.provider]
        .some((value) => value?.toLocaleLowerCase().includes(query))
    })
  }, [aggregates, modelSearch, reasoningFilters])
  const visibleAggregates = useMemo(() => {
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
    return filteredAggregates.toSorted((a, b) => {
      const aValue = value(a)
      const bValue = value(b)
      const comparison = typeof aValue === "string" && typeof bValue === "string" ? aValue.localeCompare(bValue) : Number(aValue) - Number(bValue)
      return comparison * (sort.direction === "asc" ? 1 : -1)
        || (b.meanRating ?? -Infinity) - (a.meanRating ?? -Infinity)
        || a.representative.model_variant.display_name.localeCompare(b.representative.model_variant.display_name)
    })
  }, [filteredAggregates, sort])
  const visibleModelGroups = useMemo(() => {
    const groups = groupRatedModels(filteredAggregates).map((group) => ({
      ...group,
      configurations: group.configurations.toSorted((a, b) =>
        compareSortValues(configurationSortValue(a, sort.key), configurationSortValue(b, sort.key), sort.direction)
        || reasoningEffort(a.representative).localeCompare(reasoningEffort(b.representative))
        || a.key.localeCompare(b.key),
      ),
    }))
    const value = (group: RatedModelGroup) => {
      const run = group.representative.representative
      if (sort.key === "model") return run.model_variant.display_name.toLocaleLowerCase()
      if (sort.key === "rating") return group.bestRating ?? -Infinity
      if (sort.key === "spread") return group.minimumRating == null || group.maximumRating == null ? Infinity : group.maximumRating - group.minimumRating
      if (sort.key === "record") return group.attempted ? group.solved / group.attempted : -Infinity
      if (sort.key === "puzzles") return group.attempted
      if (sort.key === "runs") return group.visibleRunCount
      if (sort.key === "cost") return group.cost
      return modelGroupStatusRank(group)
    }
    return groups.toSorted((a, b) => {
      const aValue = value(a)
      const bValue = value(b)
      const comparison = typeof aValue === "string" && typeof bValue === "string" ? aValue.localeCompare(bValue) : Number(aValue) - Number(bValue)
      return comparison * (sort.direction === "asc" ? 1 : -1)
        || (b.bestRating ?? -Infinity) - (a.bestRating ?? -Infinity)
        || a.representative.representative.model_variant.display_name.localeCompare(b.representative.representative.model_variant.display_name)
    })
  }, [filteredAggregates, sort])
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
  const toggleExpandedConfiguration = (key: string) => setExpandedConfigurationKeys((current) => {
    const next = new Set(current)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
  const toggleExpanded = (key: string) => setExpandedKeys((current) => {
    const next = new Set(current)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
  const toggleExpandedModel = (key: string) => setExpandedModelKeys((current) => {
    const next = new Set(current)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
  const protocol = ratedRuns[0]?.protocol
  const targetRd = protocol?.stopping.target_rating_deviation ?? 77
  const totals = {
    models: modelGroups.length,
    configurations: aggregates.length,
    settled: aggregates.filter((aggregate) => aggregate.settledRuns.length > 0).length,
    attempts: ratedRuns.reduce((sum, run) => sum + run.progress.completed, 0),
    cost: ratedRuns.reduce((sum, run) => sum + (run.summary.cost_usd ?? 0), 0),
  }
  const individualRunRows = (aggregate: RatedRunAggregate, open: boolean, nested = false) => aggregate.runs.toSorted((a, b) =>
    compareSortValues(individualRunSortValue(a, sort.key), individualRunSortValue(b, sort.key), sort.direction)
    || a.protocol.selection.seed - b.protocol.selection.seed
    || a.run_id.localeCompare(b.run_id),
  ).map((individual) => {
    const individualEstimate = rating(individual)
    return <TableRow
      key={`run::${aggregate.key}::${individual.run_id}`}
      tabIndex={open ? 0 : -1}
      role="link"
      aria-hidden={!open}
      className={cn(
        "bg-muted/20 transition-[background-color,border-color] duration-200 motion-reduce:transition-none",
        open
          ? "cursor-pointer border-border hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none"
          : "pointer-events-none border-transparent",
      )}
      onClick={open ? () => navigate(runPath(individual)) : undefined}
      onKeyDown={open ? (event) => {
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        navigate(runPath(individual))
      } : undefined}
    >
      <AnimatedDetailCell open={open} />
      <AnimatedDetailCell open={open} className={nested ? "pl-16" : "pl-10"}>
        <div className="font-medium">Seed {individual.protocol.selection.seed}</div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-[10px] text-muted-foreground">{individual.run_id.slice(0, 8)}</span>
          <Link
            to={ratedPlayPath(individual.protocol)}
            className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-300"
            aria-label={`Play model session seed ${individual.protocol.selection.seed}`}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <Play className="size-2.5 fill-current" /> Play this seed
          </Link>
        </div>
      </AnimatedDetailCell>
      <AnimatedDetailCell open={open} className="text-right font-mono font-semibold tabular-nums">{individualEstimate ? Math.round(individualEstimate.rating).toLocaleString() : "—"}</AnimatedDetailCell>
      <AnimatedDetailCell open={open} className="text-right font-mono text-sm tabular-nums"><span title="Rating deviation">{individualEstimate ? `±${formatRatingDeviation(individualEstimate.rating_deviation)}` : "—"}</span></AnimatedDetailCell>
      <AnimatedDetailCell open={open} className="text-right"><div className="font-mono text-sm">{individual.summary.solved}–{individual.progress.completed - individual.summary.solved}</div></AnimatedDetailCell>
      <AnimatedDetailCell open={open} className="text-right font-mono text-sm tabular-nums">{individual.progress.completed}</AnimatedDetailCell>
      <AnimatedDetailCell open={open} className="text-right font-mono text-sm">1 run</AnimatedDetailCell>
      <AnimatedDetailCell open={open} className="text-right font-mono text-xs">{individual.summary.cost_usd == null ? "—" : `$${individual.summary.cost_usd.toFixed(3)}`}</AnimatedDetailCell>
      <AnimatedDetailCell open={open}><StatusBadge run={individual} /></AnimatedDetailCell>
      <AnimatedDetailCell open={open}><ArrowRight className="size-4 text-muted-foreground" /></AnimatedDetailCell>
    </TableRow>
  })

  return <div className="space-y-7">
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Card><CardContent className="flex items-center gap-4 pt-6"><Gauge className="size-5 text-emerald-600" /><div><div className="font-mono text-2xl font-semibold">{totals.models}</div><div className="text-xs text-muted-foreground">models · {totals.configurations} configurations</div></div></CardContent></Card>
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
        <Button asChild className="sm:col-span-2 xl:col-span-4"><Link to="/puzzles/play"><Play className="fill-current" /> Play the same seeded protocol yourself</Link></Button>
      </CardContent>
    </Card>

    <Card className="overflow-hidden border-border/70">
      <CardHeader className="gap-4 border-b">
        <div className="space-y-1.5">
          <CardTitle className="text-base">Model ratings</CardTitle>
          <p className="max-w-4xl text-xs leading-relaxed text-muted-foreground">Each run stops after at least {protocol?.stopping.minimum_puzzles ?? 50} puzzles at RD ≤ {formatRatingDeviation(targetRd)}, or at its safety cap. Current partial ratings appear immediately. Group by model to compare reasoning efforts together, then expand a configuration to inspect every session.</p>
        </div>
        {ratedRuns.length > 0 ? <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex shrink-0 rounded-lg border bg-background p-1" role="group" aria-label="Leaderboard grouping">
            <Button size="sm" variant={view === "model" ? "secondary" : "ghost"} className="h-7 px-2.5 text-xs" aria-pressed={view === "model"} onClick={() => setView("model")}><Layers3 className="size-3.5" /> By model</Button>
            <Button size="sm" variant={view === "configuration" ? "secondary" : "ghost"} className="h-7 px-2.5 text-xs" aria-pressed={view === "configuration"} onClick={() => setView("configuration")}><List className="size-3.5" /> By configuration</Button>
          </div>
          <label className="relative block w-full sm:max-w-xs">
            <span className="sr-only">Filter models</span>
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
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground sm:ml-auto">{view === "model" ? `${visibleModelGroups.length} of ${modelGroups.length} models` : `${visibleAggregates.length} of ${aggregates.length} configurations`}</span>
        </div> : null}
      </CardHeader>
      {ratedRuns.length === 0 ? <CardContent className="py-16 text-center">
        <div className="mx-auto grid size-11 place-items-center rounded-full bg-secondary"><Gauge className="size-5 text-muted-foreground" /></div>
        <div className="mt-3 font-medium">No adaptive ratings have been published yet</div>
        <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">The calibrated 100,000-puzzle pool and runner are ready. Fixed-suite results remain available in the suite lab while the first canonical session is published.</p>
      </CardContent> : <TooltipProvider delayDuration={150}><div className="overflow-x-auto"><Table reorderableKey="adaptive-puzzle-leaderboard" className="min-w-[980px]">
        <TableHeader><TableRow>
          <TableHead className="w-14 text-center">#</TableHead>
          <SortableTableHead label={view === "model" ? "Model" : "Model configuration"} active={sort.key === "model"} direction={sort.direction} onSort={() => toggleSort("model")} />
          <SortableTableHead label={view === "model" ? "Best rating" : "Rating"} active={sort.key === "rating"} direction={sort.direction} align="right" onSort={() => toggleSort("rating")} suffix={<Tooltip><TooltipTrigger asChild><button type="button" className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Explain rating"><CircleHelp className="size-3.5" /></button></TooltipTrigger><TooltipContent side="top" sideOffset={8} className="max-w-xs space-y-1 px-3 py-2 leading-relaxed"><p>{view === "model" ? "The strongest current reasoning configuration for this base model. Expand the model to compare every effort directly." : "The current rating for one run, or the arithmetic mean when multiple seeded runs exist. Partial runs update this value as they progress."}</p><p>Expand a configuration to see each session’s rating and RD.</p></TooltipContent></Tooltip>} />
          <SortableTableHead label={view === "model" ? "Config range" : "Run SD"} active={sort.key === "spread"} direction={sort.direction} align="right" onSort={() => toggleSort("spread", "asc")} suffix={<Tooltip><TooltipTrigger asChild><button type="button" className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={view === "model" ? "Explain configuration range" : "Explain run standard deviation"}><CircleHelp className="size-3.5" /></button></TooltipTrigger><TooltipContent side="top" sideOffset={8} className="max-w-xs px-3 py-2 leading-relaxed">{view === "model" ? "The lowest and highest headline ratings across the model’s visible reasoning configurations." : "When multiple runs exist, this shows their rating variation. A single run remains a complete, valid leaderboard result."}</TooltipContent></Tooltip>} />
          <SortableTableHead label="Record" active={sort.key === "record"} direction={sort.direction} align="right" onSort={() => toggleSort("record")} />
          <SortableTableHead label="Puzzles" active={sort.key === "puzzles"} direction={sort.direction} align="right" onSort={() => toggleSort("puzzles")} />
          <SortableTableHead label="Runs" active={sort.key === "runs"} direction={sort.direction} align="right" onSort={() => toggleSort("runs")} />
          <SortableTableHead label="Cost" active={sort.key === "cost"} direction={sort.direction} align="right" onSort={() => toggleSort("cost")} />
          <SortableTableHead label="Status" active={sort.key === "status"} direction={sort.direction} onSort={() => toggleSort("status")} />
          <TableHead className="w-10" />
        </TableRow></TableHeader>
        <TableBody>{(view === "model" ? visibleModelGroups.length : visibleAggregates.length) === 0 ? <TableRow><TableCell colSpan={10} className="h-32 text-center"><div className="font-medium">No matching models</div><button type="button" className="mt-1 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground" onClick={() => { setModelSearch(""); setReasoningFilters(new Set()) }}>Clear filters</button></TableCell></TableRow> : view === "configuration" ? visibleAggregates.flatMap((aggregate, index) => {
          const run = aggregate.representative
          const expanded = expandedKeys.has(aggregate.key)
          const visibleRunCount = aggregate.runs.filter((individual) => individual.status !== "failed").length
          const toggle = () => toggleExpanded(aggregate.key)
          return [<TableRow key={`configuration::${aggregate.key}`} tabIndex={0} role="button" aria-expanded={expanded} className={cn("cursor-pointer transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none", aggregate.runs.some((individual) => individual.status === "running" || individual.status === "partial") && "bg-sky-500/[0.025]")} onClick={toggle} onKeyDown={(event) => { if (event.key !== "Enter" && event.key !== " ") return; event.preventDefault(); toggle() }}>
            <TableCell className="text-center font-mono text-muted-foreground">{index + 1}</TableCell>
            <TableCell><ModelIdentity variant={run.model_variant} compact /><div className="mt-1 font-mono text-[10px] text-muted-foreground">{visibleRunCount} run{visibleRunCount === 1 ? "" : "s"}</div></TableCell>
            <TableCell className="text-right"><RatingEstimate rating={aggregate.meanRating} deviation={aggregate.meanRatingDeviation} provisional={aggregateIsProvisional(aggregate)} /></TableCell>
            <TableCell className="text-right"><div className="font-mono font-medium tabular-nums">{aggregate.runStandardDeviation == null ? "—" : `±${Math.round(aggregate.runStandardDeviation)}`}</div><div className="text-[10px] text-muted-foreground">{aggregate.runStandardDeviation == null ? "1 run · RD shown with rating" : "between runs"}</div></TableCell>
            <TableCell className="text-right"><div className="font-mono font-medium">{aggregate.solved}–{aggregate.attempted - aggregate.solved}</div><div className="text-[10px] text-muted-foreground">{aggregate.attempted ? `${(aggregate.solved / aggregate.attempted * 100).toFixed(1)}% solved` : "—"}</div></TableCell>
            <TableCell className="text-right font-mono tabular-nums">{aggregate.attempted.toLocaleString()}</TableCell>
            <TableCell className="text-right font-mono tabular-nums">{visibleRunCount}</TableCell>
            <TableCell className="text-right font-mono text-xs">${aggregate.cost.toFixed(3)}</TableCell>
            <TableCell><AggregateStatusBadge aggregate={aggregate} /></TableCell>
            <TableCell><ChevronRight className={cn("size-4 text-muted-foreground transition-transform duration-200 ease-out motion-reduce:transition-none", expanded && "rotate-90")} /></TableCell>
          </TableRow>, ...individualRunRows(aggregate, expanded)]
        }) : visibleModelGroups.flatMap((group, index) => {
          const expanded = expandedModelKeys.has(group.key)
          const toggle = () => toggleExpandedModel(group.key)
          const bestEffort = reasoningEffort(group.representative.representative)
          const rows = [<TableRow key={`model::${group.key}`} tabIndex={0} role="button" aria-expanded={expanded} className={cn("cursor-pointer transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none", modelGroupStatusRank(group) === 3 && "bg-sky-500/[0.025]")} onClick={toggle} onKeyDown={(event) => { if (event.key !== "Enter" && event.key !== " ") return; event.preventDefault(); toggle() }}>
            <TableCell className="text-center font-mono text-muted-foreground">{index + 1}</TableCell>
            <TableCell><ModelGroupIdentity group={group} /><div className="mt-1 font-mono text-[10px] text-muted-foreground">{group.visibleRunCount} run{group.visibleRunCount === 1 ? "" : "s"} total</div></TableCell>
            <TableCell className="text-right"><RatingEstimate rating={group.bestRating} deviation={group.representative.meanRatingDeviation} provisional={aggregateIsProvisional(group.representative)} /><div className="text-[10px] text-muted-foreground">{group.bestRating == null ? null : reasoningEffortLabel(bestEffort)}</div></TableCell>
            <TableCell className="text-right"><div className="whitespace-nowrap font-mono font-medium tabular-nums">{group.minimumRating == null || group.maximumRating == null ? "—" : group.minimumRating === group.maximumRating ? Math.round(group.minimumRating).toLocaleString() : `${Math.round(group.minimumRating).toLocaleString()}–${Math.round(group.maximumRating).toLocaleString()}`}</div><div className="text-[10px] text-muted-foreground">{group.configurations.length === 1 ? "one configuration" : `${group.configurations.length} configurations`}</div></TableCell>
            <TableCell className="text-right"><div className="font-mono font-medium">{group.solved}–{group.attempted - group.solved}</div><div className="text-[10px] text-muted-foreground">{group.attempted ? `${(group.solved / group.attempted * 100).toFixed(1)}% solved` : "—"}</div></TableCell>
            <TableCell className="text-right font-mono tabular-nums">{group.attempted.toLocaleString()}</TableCell>
            <TableCell className="text-right font-mono tabular-nums">{group.visibleRunCount}</TableCell>
            <TableCell className="text-right font-mono text-xs">${group.cost.toFixed(3)}</TableCell>
            <TableCell><ModelGroupStatusBadge group={group} /></TableCell>
            <TableCell><ChevronRight className={cn("size-4 text-muted-foreground transition-transform duration-200 ease-out motion-reduce:transition-none", expanded && "rotate-90")} /></TableCell>
          </TableRow>]
          group.configurations.forEach((aggregate) => {
            const run = aggregate.representative
            const configurationExpanded = expanded && expandedConfigurationKeys.has(aggregate.key)
            const visibleRunCount = aggregate.runs.filter((individual) => individual.status !== "failed").length
            const toggleConfiguration = () => toggleExpandedConfiguration(aggregate.key)
            rows.push(<TableRow key={`nested-configuration::${aggregate.key}`} tabIndex={expanded ? 0 : -1} role="button" aria-expanded={configurationExpanded} aria-hidden={!expanded} className={cn("transition-[background-color,border-color] duration-200 motion-reduce:transition-none", expanded ? "cursor-pointer border-border bg-muted/25 hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none" : "pointer-events-none border-transparent")} onClick={expanded ? toggleConfiguration : undefined} onKeyDown={expanded ? (event) => { if (event.key !== "Enter" && event.key !== " ") return; event.preventDefault(); toggleConfiguration() } : undefined}>
              <AnimatedDetailCell open={expanded} />
              <AnimatedDetailCell open={expanded} className="pl-8"><ModelIdentity variant={run.model_variant} compact /><div className="mt-1 font-mono text-[10px] text-muted-foreground">Reasoning configuration · {visibleRunCount} run{visibleRunCount === 1 ? "" : "s"}</div></AnimatedDetailCell>
              <AnimatedDetailCell open={expanded} className="text-right"><RatingEstimate rating={aggregate.meanRating} deviation={aggregate.meanRatingDeviation} provisional={aggregateIsProvisional(aggregate)} className="text-lg" /></AnimatedDetailCell>
              <AnimatedDetailCell open={expanded} className="text-right"><div className="font-mono font-medium tabular-nums">{aggregate.runStandardDeviation == null ? "—" : `±${Math.round(aggregate.runStandardDeviation)}`}</div><div className="text-[10px] text-muted-foreground">{aggregate.runStandardDeviation == null ? "1 run · RD at left" : "run SD"}</div></AnimatedDetailCell>
              <AnimatedDetailCell open={expanded} className="text-right"><div className="font-mono font-medium">{aggregate.solved}–{aggregate.attempted - aggregate.solved}</div><div className="text-[10px] text-muted-foreground">{aggregate.attempted ? `${(aggregate.solved / aggregate.attempted * 100).toFixed(1)}% solved` : "—"}</div></AnimatedDetailCell>
              <AnimatedDetailCell open={expanded} className="text-right font-mono tabular-nums">{aggregate.attempted.toLocaleString()}</AnimatedDetailCell>
              <AnimatedDetailCell open={expanded} className="text-right font-mono tabular-nums">{visibleRunCount}</AnimatedDetailCell>
              <AnimatedDetailCell open={expanded} className="text-right font-mono text-xs">${aggregate.cost.toFixed(3)}</AnimatedDetailCell>
              <AnimatedDetailCell open={expanded}><AggregateStatusBadge aggregate={aggregate} /></AnimatedDetailCell>
              <AnimatedDetailCell open={expanded}><ChevronRight className={cn("size-4 text-muted-foreground transition-transform duration-200 ease-out motion-reduce:transition-none", configurationExpanded && "rotate-90")} /></AnimatedDetailCell>
            </TableRow>)
            rows.push(...individualRunRows(aggregate, configurationExpanded, true))
          })
          return rows
        })}</TableBody>
      </Table></div></TooltipProvider>}
    </Card>
  </div>
}
