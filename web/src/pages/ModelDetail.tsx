import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { ArrowLeft, Check, ChevronDown, CircleDollarSign, Database, Gauge, GitCompareArrows, Info, Layers3, Scale, X } from "lucide-react"
import { useData } from "@/lib/useData"
import { loadRun, type PuzzleItem, type Run, type RunIndexEntry } from "@/lib/data"
import { MODES, modeInfo, pct, pointsText, RESPONSE_STYLES, responseStyleInfo, TIER_ORDER } from "@/lib/format"
import { puzzleContinuation, puzzleModelAttempts, uciLineToSan, type PuzzleContinuationPly } from "@/lib/chess"
import { puzzlePerformanceRating } from "@/lib/puzzleRating"
import { isVisibleUiTrack } from "@/lib/uiTracks"
import { ModelIdentity } from "@/components/ModelIdentity"
import { ResponseStyleBadge } from "@/components/ResponseStyle"
import { ExportButton } from "@/components/ExportButton"
import { ExactPromptBlock, PromptTranscript } from "@/components/PromptTranscript"
import { SortableTableHead, type SortDirection } from "@/components/SortableTableHead"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

function suiteIdentity(run: RunIndexEntry) {
  return `${run.track}:${run.suite?.content_hash ?? run.suite?.name ?? "unspecified"}`
}

function conditionIdentity(run: RunIndexEntry) {
  return run.condition_slug || run.condition.slug
}

function runConfigurationLabel(run: RunIndexEntry) {
  const mode = modeInfo(run.condition)
  const method = mode ? `${mode.displayN}. ${mode.name}` : run.track === "woodpecker" ? "Full-line calculation" : "Special protocol"
  return `${method} · ${responseStyleInfo(run.condition).label}`
}

function summaryRatingText(run: RunIndexEntry) {
  const estimate = run.summary.puzzle_performance_rating
  if (!estimate) return "—"
  if (!estimate.bounded) return estimate.rating <= 0 ? "≤0" : "≥4,000"
  return Math.round(estimate.rating).toLocaleString()
}

function Stat({ label, value, note, icon: Icon }: { label: string; value: string; note: string; icon: typeof Scale }) {
  return <Card><CardContent className="flex items-start gap-3 pt-6"><Icon className="mt-1 size-4 text-muted-foreground" /><div><div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-1 font-mono text-2xl font-semibold tabular-nums">{value}</div><div className="mt-0.5 text-xs text-muted-foreground">{note}</div></div></CardContent></Card>
}

function Continuation({ plies }: { plies: PuzzleContinuationPly[] }) {
  if (!plies.length) return <span className="text-muted-foreground">no move</span>
  return <span className="inline-flex flex-wrap items-center gap-1.5 font-mono text-xs" title={plies.map((ply) => ply.uci).join(" ")}>
    {plies.map((ply, index) => <span
      key={`${ply.source}-${ply.uci}-${index}`}
      title={`${ply.source === "model" ? "Model move" : "Built-in puzzle reply"} · ${ply.uci}`}
      className={ply.status === "wrong"
        ? "rounded bg-rose-500/12 px-1.5 py-0.5 font-semibold text-rose-700 ring-1 ring-inset ring-rose-500/25 dark:text-rose-300"
        : ply.source === "puzzle"
          ? "rounded bg-muted px-1.5 py-0.5 text-muted-foreground ring-1 ring-inset ring-border"
          : "rounded bg-emerald-500/10 px-1.5 py-0.5 font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-500/20 dark:text-emerald-300"}
    >{ply.san}</span>)}
  </span>
}

interface PerformancePoint {
  puzzleId: string
  rating: number
  score: number
  solved: boolean
  failureReason: string | null
  cumulativePoints: number
  elo: number | null
  eloDelta: number | null
}

type AnswerSortKey = "puzzle" | "rating" | "points"

function pointPosition(index: number, total: number, inset: number) {
  const ratio = total === 1 ? 0.5 : index / (total - 1)
  return { ratio, left: `calc(${ratio * 100}% + ${inset * (1 - 2 * ratio)}px)` }
}

function PerformanceTooltip({ point, index, total, inset }: { point: PerformancePoint; index: number; total: number; inset: number }) {
  const position = pointPosition(index, total, inset)
  const translate = position.ratio < 0.18 ? "0" : position.ratio > 0.82 ? "-100%" : "-50%"
  const outcome = point.solved ? "Solved" : point.score > 0 ? "Partial credit" : point.failureReason?.replaceAll("_", " ") ?? "Incorrect"
  const elo = point.elo == null ? "Not bounded" : Math.round(point.elo).toLocaleString()
  const delta = point.eloDelta == null ? null : Math.round(point.eloDelta)

  return <>
    <span className="pointer-events-none absolute inset-y-2 z-10 w-px bg-foreground/25" style={{ left: position.left }} />
    <div role="tooltip" className="pointer-events-none absolute top-1.5 z-20 min-w-44 rounded-lg border bg-popover/95 p-2 text-popover-foreground shadow-lg backdrop-blur" style={{ left: position.left, transform: `translateX(${translate})` }}>
      <div className="flex items-center justify-between gap-4"><span className="font-mono text-xs font-semibold">{point.puzzleId}</span><span className="text-[10px] text-muted-foreground">#{index + 1} of {total}</span></div>
      <div className="mt-1.5 grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-[10px] leading-tight">
        <span className="text-muted-foreground">Result</span><span className={point.solved ? "text-right font-medium text-emerald-700 dark:text-emerald-300" : point.score > 0 ? "text-right font-medium text-amber-700 dark:text-amber-300" : "text-right font-medium text-rose-700 dark:text-rose-300"}>{outcome}</span>
        <span className="text-muted-foreground">Puzzle rating</span><span className="text-right font-mono">{point.rating.toLocaleString()}</span>
        <span className="text-muted-foreground">This puzzle</span><span className="text-right font-mono">+{point.score.toFixed(2)} pt</span>
        <span className="text-muted-foreground">Cumulative</span><span className="text-right font-mono">{point.cumulativePoints.toFixed(2)} pts</span>
        <span className="text-muted-foreground">Puzzle Elo</span><span className="text-right font-mono">{elo}{delta == null ? "" : ` (${delta >= 0 ? "+" : ""}${delta})`}</span>
      </div>
    </div>
  </>
}

function PerformanceHistory({ items, maxPoints }: { items: PuzzleItem[]; maxPoints: number }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const history = useMemo(() => {
    let points = 0
    let previousElo: number | null = null
    const prefix: PuzzleItem[] = []
    return items.map((item) => {
      points += item.score
      prefix.push(item)
      const estimate = puzzlePerformanceRating(prefix)
      const elo = estimate.bounded ? estimate.rating : null
      const eloDelta = elo == null || previousElo == null ? null : elo - previousElo
      if (elo != null) previousElo = elo
      return {
        puzzleId: item.puzzle_id,
        rating: item.rating,
        score: item.score,
        solved: item.solved,
        failureReason: item.failure_reason,
        cumulativePoints: points,
        elo,
        eloDelta,
      } satisfies PerformancePoint
    })
  }, [items])
  if (!history.length) return null
  const ratingOrdered = items.every((item, index) => {
    if (index === 0) return true
    const previous = items[index - 1]
    return previous.rating < item.rating || (previous.rating === item.rating && previous.puzzle_id <= item.puzzle_id)
  })

  const hoverAt = (clientX: number, left: number, width: number, inset: number) => {
    const ratio = Math.max(0, Math.min(1, (clientX - left - inset) / Math.max(1, width - inset * 2)))
    setHoveredIndex(Math.round(ratio * (history.length - 1)))
  }

  const eloValues = history.flatMap((point) => point.elo == null ? [] : [point.elo])
  const eloMin = eloValues.length ? Math.floor((Math.min(...eloValues) - 50) / 100) * 100 : 0
  const rawMax = eloValues.length ? Math.ceil((Math.max(...eloValues) + 50) / 100) * 100 : 4000
  const eloMax = Math.max(eloMin + 200, rawMax)
  const linePoints = history.flatMap((point, index) => point.elo == null ? [] : [
    `${history.length === 1 ? 500 : index / (history.length - 1) * 1000},${116 - (point.elo - eloMin) / (eloMax - eloMin) * 100}`,
  ]).join(" ")
  const final = history.at(-1)!
  const hovered = hoveredIndex == null ? null : history[hoveredIndex]
  const finalElo = history.findLast((point) => point.elo != null)?.elo ?? null
  const displayedElo = hovered?.elo ?? finalElo
  const firstEloIndex = history.findIndex((point) => point.elo != null)
  const pointsScale = Math.max(1, final.cumulativePoints)
  const hoveredEloY = hovered?.elo == null ? null : (116 - (hovered.elo - eloMin) / (eloMax - eloMin) * 100) / 128 * 100

  return <Card>
    <CardHeader className="space-y-1">
      <CardTitle className="text-base">Performance over suite</CardTitle>
      <p className="text-xs text-muted-foreground">Cumulative points and complete-solve puzzle Elo after each puzzle in {ratingOrdered ? "rating-ascending order" : "the suite’s frozen historical order"}. Hover either chart to inspect an individual result.</p>
    </CardHeader>
    <CardContent className="grid gap-5 lg:grid-cols-2">
      <div>
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Points accumulation</div>
        <div className="relative flex h-32 touch-pan-y items-end gap-px overflow-hidden rounded-lg border bg-secondary/30 p-3" aria-label="Cumulative points by puzzle" onMouseMove={(event) => { const rect = event.currentTarget.getBoundingClientRect(); hoverAt(event.clientX, rect.left, rect.width, 12) }} onMouseLeave={() => setHoveredIndex(null)}>{history.map((point, index) => <div key={point.puzzleId} className={`min-w-0 flex-1 transition-colors ${hoveredIndex === index ? "bg-emerald-500" : "bg-emerald-500/70"}`} style={{ height: `${Math.max(2, point.cumulativePoints / pointsScale * 100)}%` }} aria-label={`After puzzle ${index + 1}: ${point.cumulativePoints.toFixed(2)} points`} />)}{hovered && hoveredIndex != null && <PerformanceTooltip point={hovered} index={hoveredIndex} total={history.length} inset={12} />}</div>
        <div className="mt-2 flex justify-between text-[11px] text-muted-foreground"><span>{ratingOrdered ? `rating ${history[0].rating.toLocaleString()}` : "puzzle 1"}</span><span>{ratingOrdered ? `rating ${final.rating.toLocaleString()} · ` : ""}{final.cumulativePoints.toFixed(2)}/{maxPoints.toFixed(0)} points</span></div>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between gap-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"><span>Puzzle Elo trajectory</span>{displayedElo != null && <span className="font-mono text-violet-700 dark:text-violet-300">{Math.round(displayedElo).toLocaleString()}</span>}</div>
        <div className="relative h-32 touch-pan-y overflow-hidden rounded-lg border bg-secondary/30 p-2" aria-label="Puzzle Elo estimate after each puzzle" onMouseMove={(event) => { const rect = event.currentTarget.getBoundingClientRect(); hoverAt(event.clientX, rect.left, rect.width, 8) }} onMouseLeave={() => setHoveredIndex(null)}>
          {eloValues.length ? <svg viewBox="0 0 1000 128" preserveAspectRatio="none" className="size-full overflow-visible text-violet-500" role="img" aria-label={`Puzzle Elo changed from the first bounded estimate after puzzle ${firstEloIndex + 1} to ${Math.round(finalElo ?? 0)}`}>
            <line x1="0" y1="16" x2="1000" y2="16" className="stroke-border" vectorEffect="non-scaling-stroke" strokeDasharray="3 4" />
            <line x1="0" y1="116" x2="1000" y2="116" className="stroke-border" vectorEffect="non-scaling-stroke" />
            <polyline points={linePoints} fill="none" stroke="currentColor" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
          </svg> : <div className="grid size-full place-items-center text-center text-xs text-muted-foreground">A bounded Elo estimate needs at least one solve and one miss.</div>}
          {eloValues.length > 0 && <><span className="absolute left-2 top-1 font-mono text-[9px] text-muted-foreground">{eloMax}</span><span className="absolute bottom-1 left-2 font-mono text-[9px] text-muted-foreground">{eloMin}</span></>}
          {hoveredIndex != null && hoveredEloY != null && <span className="pointer-events-none absolute z-10 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-500 ring-2 ring-background" style={{ left: pointPosition(hoveredIndex, history.length, 8).left, top: `${hoveredEloY}%` }} />}
          {hovered && hoveredIndex != null && <PerformanceTooltip point={hovered} index={hoveredIndex} total={history.length} inset={8} />}
        </div>
        <div className="mt-2 flex justify-between text-[11px] text-muted-foreground"><span>{firstEloIndex >= 0 ? `first estimate · puzzle ${firstEloIndex + 1}` : "not yet bounded"}</span><span>complete-solve MLE</span></div>
      </div>
    </CardContent>
  </Card>
}

export function ModelDetail() {
  const { model = "" } = useParams()
  const navigate = useNavigate()
  const key = decodeURIComponent(model)
  const { runs } = useData()
  const [searchParams, setSearchParams] = useSearchParams()
  const goBack = useCallback(() => {
    const historyIndex = window.history.state?.idx
    if (typeof historyIndex === "number" && historyIndex > 0) navigate(-1)
    else navigate("/")
  }, [navigate])
  const mine = useMemo(() => runs
    .filter((run) => isVisibleUiTrack(run.track) && run.model_variant.key === key)
    .sort((a, b) => b.created.localeCompare(a.created)), [runs, key])
  const requestedRun = searchParams.get("run")
  const activeId = requestedRun && mine.some((candidate) => candidate.run_id === requestedRun)
    ? requestedRun
    : mine[0]?.run_id || ""
  const meta = mine.find((run) => run.run_id === activeId) ?? mine[0]
  const selectRun = useCallback((runId: string) => setSearchParams({ run: runId }), [setSearchParams])
  const [run, setRun] = useState<Run | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [filter, setFilter] = useState<"all" | "solved" | "failed">("all")
  const [answerSort, setAnswerSort] = useState<{ key: AnswerSortKey | null; direction: SortDirection }>({ key: null, direction: "asc" })
  const [openPuzzle, setOpenPuzzle] = useState<string | null>(null)
  const metaFile = meta?.file

  const answerItems = useMemo(() => {
    const filtered = (run?.items ?? []).filter((item) => filter === "all" || (filter === "solved" ? item.solved : !item.solved))
    if (!answerSort.key) return filtered
    const multiplier = answerSort.direction === "asc" ? 1 : -1
    return filtered.toSorted((a, b) => {
      const comparison = answerSort.key === "puzzle"
        ? a.puzzle_id.localeCompare(b.puzzle_id)
        : answerSort.key === "rating"
          ? a.rating - b.rating
          : a.score - b.score
      return comparison * multiplier || a.puzzle_id.localeCompare(b.puzzle_id)
    })
  }, [run, filter, answerSort.key, answerSort.direction])

  const toggleAnswerSort = useCallback((key: AnswerSortKey) => setAnswerSort((current) => ({
    key,
    direction: current.key === key ? (current.direction === "asc" ? "desc" : "asc") : key === "points" ? "desc" : "asc",
  })), [])

  useEffect(() => {
    if (!metaFile) return
    let active = true
    setRun(null)
    setRunError(null)
    void loadRun(metaFile).then((value) => { if (active) setRun(value) }).catch((reason) => { if (active) setRunError(String(reason)) })
    return () => { active = false }
  }, [metaFile])

  if (!meta) return <div><p>No published runs for {key}.</p><button type="button" onClick={goBack} className="cursor-pointer text-sm underline">Go back</button></div>
  const displayRun = run ?? ({ ...meta, schema: "", themes: [], items: [] } as Run)
  const variant = meta.model_variant
  const activeResponseStyle = responseStyleInfo(meta.condition)
  const activeSuiteKey = suiteIdentity(meta)
  const suiteGroups = Array.from(mine.reduce((groups, candidate) => {
    const candidateKey = suiteIdentity(candidate)
    const existing = groups.get(candidateKey)
    if (existing) existing.runs.push(candidate)
    else groups.set(candidateKey, { key: candidateKey, track: candidate.track, suite: candidate.suite, runs: [candidate] })
    return groups
  }, new Map<string, { key: string; track: RunIndexEntry["track"]; suite: RunIndexEntry["suite"]; runs: RunIndexEntry[] }>()).values())
  const activeSuiteGroup = suiteGroups.find((group) => group.key === activeSuiteKey) ?? suiteGroups[0]
  const chooseSuite = (nextKey: string) => {
    const group = suiteGroups.find((candidate) => candidate.key === nextKey)
    if (!group) return
    const activeModeNumber = modeInfo(meta.condition)?.n
    const next = group.runs.find((candidate) =>
      modeInfo(candidate.condition)?.n === activeModeNumber &&
      responseStyleInfo(candidate.condition).key === activeResponseStyle.key
    ) ?? group.runs.find((candidate) => responseStyleInfo(candidate.condition).key === activeResponseStyle.key) ?? group.runs[0]
    selectRun(next.run_id)
  }
  const comparableSuiteRuns = suiteGroups.map((group) => ({
    group,
    run: group.runs.find((candidate) => conditionIdentity(candidate) === conditionIdentity(meta)),
  }))

  const byTier = TIER_ORDER.map((tier) => {
    const items = displayRun.items.filter((item) => item.categories.tier?.includes(tier))
    return { tier, n: items.length, solved: items.filter((item) => item.solved).length, points: items.reduce((sum, item) => sum + item.score, 0) }
  }).filter((row) => row.n)
  const byRating = Array.from(
    displayRun.items.reduce((bands, item) => {
      const low = Math.floor(item.rating / 400) * 400
      const current = bands.get(low) ?? { low, n: 0, solved: 0, points: 0 }
      current.n += 1
      current.solved += item.solved ? 1 : 0
      current.points += item.score
      bands.set(low, current)
      return bands
    }, new Map<number, { low: number; n: number; solved: number; points: number }>()),
  ).map(([, band]) => band).toSorted((a, b) => a.low - b.low)
  const performance = puzzlePerformanceRating(displayRun.items)
  const performanceValue = !run
    ? "—"
    : performance.bounded
      ? Math.round(performance.rating).toLocaleString()
      : performance.n === 0
        ? "—"
        : displayRun.items.every((item) => item.solved) ? "≥4,000" : "≤0"
  const performanceNote = performance.ci95
    ? `95% CI ${Math.round(performance.ci95[0]).toLocaleString()}–${Math.round(performance.ci95[1]).toLocaleString()}`
    : performance.n ? "outside the calibrated 0–4,000 range" : "requires puzzle outcomes"

  const sameSuite = (candidate: (typeof mine)[number]) =>
    (candidate.suite?.content_hash ?? candidate.suite?.name) === (meta.suite?.content_hash ?? meta.suite?.name)
  const modeRuns = MODES.map((mode) => ({ mode, run: mine.find((candidate) =>
    modeInfo(candidate.condition)?.n === mode.n &&
    candidate.track === "puzzle" &&
    sameSuite(candidate) &&
    responseStyleInfo(candidate.condition).key === activeResponseStyle.key
  ) }))
  const activeMode = modeInfo(meta.condition)
  const responseRuns = RESPONSE_STYLES.map((style) => ({
    style,
    run: mine.find((candidate) =>
      candidate.track === meta.track &&
      sameSuite(candidate) &&
      modeInfo(candidate.condition)?.n === activeMode?.n &&
      responseStyleInfo(candidate.condition).key === style.key
    ),
  }))
  const cacheRead = meta.usage?.cache_read_tokens ?? 0
  const cacheRate = cacheRead / Math.max(1, meta.usage?.prompt_tokens ?? 0)
  const costNote = cacheRead > 0
    ? `${pct(cacheRate)} prompt cache · ${cacheRead.toLocaleString()} tokens read`
    : `${meta.usage?.reasoning_tokens?.toLocaleString() ?? 0} reasoning tokens`

  return <div className="space-y-8">
    <section className="flex flex-wrap items-end justify-between gap-5 border-b border-border/70 pb-7">
      <div>
        <button type="button" onClick={goBack} className="mb-4 inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" /> Back</button>
        <h1 className="sr-only">{variant.display_name} benchmark configuration</h1>
        <div className="flex flex-wrap items-start gap-3"><ModelIdentity variant={variant} /><ResponseStyleBadge condition={meta.condition} /></div>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">Provider model <span className="font-mono text-xs text-foreground">{variant.model_id}</span>. Reasoning and output-limit policy are part of this participant’s identity.</p>
      </div>
      <ExportButton run={meta.run_id} label="Export this run" />
    </section>

    {runError && <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"><span className="font-medium text-destructive">Detailed run data could not be loaded.</span> <span className="text-muted-foreground">{runError}</span></div>}

    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="border-b bg-muted/20 py-4">
        <CardTitle className="flex items-center gap-2 text-base"><Layers3 className="size-4 text-emerald-600" /> Benchmark suite</CardTitle>
        <p className="text-xs leading-relaxed text-muted-foreground">Choose the frozen test set first, then the run configuration. A shared suite hash means identical puzzles in identical order.</p>
      </CardHeader>
      <CardContent className="space-y-4 py-4">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {suiteGroups.map((group) => {
            const active = group.key === activeSuiteKey
            const latest = group.runs[0]
            return <button key={group.key} type="button" aria-pressed={active} onClick={() => chooseSuite(group.key)} className={cn("cursor-pointer rounded-xl border p-3 text-left transition-all hover:-translate-y-0.5 hover:border-foreground/25 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring/60", active ? "border-emerald-500/45 bg-emerald-500/[0.05] shadow-sm" : "bg-background")}>
              <div className="flex items-start justify-between gap-3"><span className="font-semibold">{group.suite?.name ?? "Unversioned suite"}</span>{active ? <Badge className="bg-emerald-600 text-white">Viewing</Badge> : <Badge variant="outline">{group.track}</Badge>}</div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground"><span>{latest.summary.n} items</span><span>{group.runs.length} configuration{group.runs.length === 1 ? "" : "s"}</span><span>{group.suite?.visibility ?? "unspecified"}</span></div>
              <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground" title={group.suite?.content_hash ?? undefined}>{group.suite?.version ? `v${group.suite.version} · ` : ""}{group.suite?.content_hash?.replace("sha256:", "") ?? "no content hash"}</div>
            </button>
          })}
        </div>
        <div className="grid items-end gap-3 border-t pt-4 sm:grid-cols-[minmax(0,420px)_1fr]">
          <div className="space-y-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Run configuration</div>
            <Select value={meta.run_id} onValueChange={selectRun}>
              <SelectTrigger className="w-full bg-background"><SelectValue /></SelectTrigger>
              <SelectContent align="start">{activeSuiteGroup.runs.toSorted((a, b) => (modeInfo(a.condition)?.displayN ?? 99) - (modeInfo(b.condition)?.displayN ?? 99) || responseStyleInfo(a.condition).label.localeCompare(responseStyleInfo(b.condition).label)).map((candidate) => <SelectItem key={candidate.run_id} value={candidate.run_id}>{runConfigurationLabel(candidate)} · {candidate.status}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-dashed px-3 py-2.5 text-xs leading-relaxed text-muted-foreground"><Info className="mt-0.5 size-3.5 shrink-0" /><span>Puzzles are isolated from one another. Conversation state persists only between moves of the same puzzle.</span></div>
        </div>
      </CardContent>
    </Card>

    <section className={`grid gap-3 sm:grid-cols-2 ${meta.track === "puzzle" ? "xl:grid-cols-5" : "xl:grid-cols-4"}`}>
      <Stat icon={Scale} label="Points" value={pointsText(meta.summary)} note="fractional prefix credit" />
      <Stat icon={Check} label="Complete solves" value={`${meta.summary.solved}/${meta.summary.n}`} note={pct(meta.summary.solve_rate)} />
      {meta.track === "puzzle" && <Stat icon={Gauge} label="Puzzle performance" value={performanceValue} note={`${performanceNote} · secondary`} />}
      <Stat icon={Database} label="Legal first" value={pct(meta.summary.first_move_legal_rate)} note={meta.summary.response_format_valid_rate == null ? `${meta.progress.completed}/${meta.progress.total} durable items` : `${pct(meta.summary.response_format_valid_rate)} ${activeResponseStyle.key === "move_only" ? "parseable text" : "valid JSON"} · ${meta.progress.completed}/${meta.progress.total} durable`} />
      <Stat icon={CircleDollarSign} label="Recorded cost" value={meta.summary.cost_usd == null ? "—" : `$${meta.summary.cost_usd.toFixed(4)}`} note={costNote} />
    </section>

    {modeRuns.filter((item) => item.run).length > 1 && <Card><CardHeader><CardTitle className="flex flex-wrap items-center gap-2 text-base">Prompt-method comparison <ResponseStyleBadge condition={meta.condition} compact /></CardTitle></CardHeader><CardContent className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">{modeRuns.map(({ mode, run: candidate }) => <button key={mode.n} type="button" disabled={!candidate} onClick={() => candidate && selectRun(candidate.run_id)} className={cn("cursor-pointer rounded-lg border p-4 text-left transition-all hover:-translate-y-0.5 hover:border-foreground/25 hover:shadow-sm disabled:cursor-not-allowed disabled:hover:translate-y-0", candidate?.run_id === meta.run_id && "border-primary/40 bg-primary/[0.035] shadow-sm")}><div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{mode.displayN}. {mode.name}</div><div className="mt-2 font-mono text-xl font-semibold">{candidate ? pointsText(candidate.summary) : "—"}</div><div className="mt-1 text-xs text-muted-foreground">{candidate ? `${pct(candidate.summary.solve_rate)} complete · click to view` : "not run"}</div></button>)}</CardContent></Card>}

    {meta.track === "puzzle" && activeMode && <Card><CardHeader><CardTitle className="text-base">Response-style ablation · Method {activeMode.displayN} {activeMode.name}</CardTitle></CardHeader><CardContent className="grid gap-2 sm:grid-cols-2">{responseRuns.map(({ style, run: candidate }) => <button type="button" disabled={!candidate} onClick={() => candidate && selectRun(candidate.run_id)} key={style.key} className={cn("cursor-pointer rounded-xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:border-foreground/25 hover:shadow-sm disabled:cursor-not-allowed disabled:hover:translate-y-0", style.key === activeResponseStyle.key && "border-primary/35 bg-primary/[0.025] shadow-sm")}><ResponseStyleBadge condition={style.key === "move_only" ? "plain-text-v1" : "json-rationale"} /><div className="mt-3 font-mono text-xl font-semibold">{candidate ? pointsText(candidate.summary) : "—"}</div><div className="mt-1 text-xs text-muted-foreground">{candidate ? `${pct(candidate.summary.solve_rate)} complete · ${candidate.status} · click to view` : "not run for this suite"}</div></button>)}</CardContent></Card>}

    <Card>
      <CardHeader className="space-y-1"><CardTitle className="flex items-center gap-2 text-base"><GitCompareArrows className="size-4 text-violet-600" /> Suite comparison</CardTitle><p className="text-xs leading-relaxed text-muted-foreground">Same model configuration, prompt method, and response style across frozen test sets. Compare percentages and Puzzle Elo; raw points are only directly comparable when suite sizes match.</p></CardHeader>
      <CardContent className="p-0">
        <Table><TableHeader><TableRow><TableHead>Suite</TableHead><TableHead className="text-right">Items</TableHead><TableHead className="text-right">Points</TableHead><TableHead className="text-right">Full solves</TableHead><TableHead className="text-right">Puzzle Elo</TableHead><TableHead className="text-right">Cost</TableHead></TableRow></TableHeader><TableBody>{comparableSuiteRuns.map(({ group, run: candidate }) => <TableRow key={group.key} className={group.key === activeSuiteKey ? "bg-primary/[0.025]" : undefined}><TableCell><button type="button" disabled={!candidate} onClick={() => candidate && selectRun(candidate.run_id)} className="cursor-pointer text-left disabled:cursor-not-allowed"><span className="font-medium hover:underline">{group.suite?.name ?? "Unversioned suite"}</span><span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">{group.suite?.content_hash?.replace("sha256:", "") ?? "no content hash"}{group.key === activeSuiteKey ? " · identical order" : " · different frozen suite"}</span></button></TableCell><TableCell className="text-right tabular-nums">{candidate?.summary.n ?? "—"}</TableCell><TableCell className="text-right">{candidate ? <><div className="font-mono font-semibold">{pct(candidate.summary.points / Math.max(1, candidate.summary.max_points))}</div><div className="text-[10px] text-muted-foreground">{pointsText(candidate.summary)}</div></> : "Not run"}</TableCell><TableCell className="text-right">{candidate ? <><div className="font-mono font-semibold">{pct(candidate.summary.solve_rate)}</div><div className="text-[10px] text-muted-foreground">{candidate.summary.solved}/{candidate.summary.n}</div></> : "—"}</TableCell><TableCell className="text-right font-mono font-semibold">{candidate ? summaryRatingText(candidate) : "—"}</TableCell><TableCell className="text-right font-mono text-xs text-muted-foreground">{candidate?.summary.cost_usd == null ? "—" : `$${candidate.summary.cost_usd.toFixed(3)}`}</TableCell></TableRow>)}</TableBody></Table>
        {suiteGroups.length === 1 && <div className="border-t px-4 py-3 text-xs text-muted-foreground">Only one frozen suite has been published for this model configuration. Additional suites will appear here automatically once matching runs exist.</div>}
      </CardContent>
    </Card>

    {run && <PerformanceHistory items={displayRun.items} maxPoints={meta.summary.max_points} />}

    {run && <div className="grid min-w-0 gap-5 2xl:grid-cols-[360px_minmax(0,1fr)]">
      <Card><CardHeader><CardTitle className="text-base">Difficulty breakdown</CardTitle></CardHeader><CardContent className="space-y-5 p-0"><div><div className="border-b px-4 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Numeric puzzle rating</div><Table><TableHeader><TableRow><TableHead>Rating band</TableHead><TableHead className="text-right">Points</TableHead><TableHead className="text-right">Solved</TableHead></TableRow></TableHeader><TableBody>{byRating.map((row) => <TableRow key={row.low}><TableCell className="font-mono">{row.low}–{row.low + 399}</TableCell><TableCell className="text-right font-mono">{row.points.toFixed(2)}/{row.n}</TableCell><TableCell className="text-right text-muted-foreground">{row.solved}/{row.n}</TableCell></TableRow>)}</TableBody></Table></div><div className="border-t"><div className="border-b px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Named tier</div><Table><TableBody>{byTier.map((row) => <TableRow key={row.tier}><TableCell className="capitalize">{row.tier}</TableCell><TableCell className="text-right font-mono">{row.points.toFixed(2)}/{row.n}</TableCell><TableCell className="text-right text-muted-foreground">{row.solved}/{row.n}</TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card>

      <Card className="min-w-0 overflow-hidden"><CardHeader className="flex-row items-center justify-between gap-4 space-y-0"><div className="min-w-0"><CardTitle className="text-base">Answer sheet <span className="ml-2 font-normal text-muted-foreground">{displayRun.condition.puzzle_protocol === "full_line" ? "full variations" : "move by move"}</span></CardTitle><div className="mt-2 flex flex-wrap gap-3 text-[10px] text-muted-foreground"><span className="inline-flex items-center gap-1"><i className="size-2 rounded-sm bg-emerald-500/70" /> model move</span><span className="inline-flex items-center gap-1"><i className="size-2 rounded-sm border bg-muted" /> built-in puzzle reply</span><span className="inline-flex items-center gap-1"><i className="size-2 rounded-sm bg-rose-500/70" /> wrong / missing move</span><span>Click any row for its exact prompts and response.</span></div></div><Tabs value={filter} onValueChange={(value) => setFilter(value as typeof filter)}><TabsList className="h-8">{(["all", "solved", "failed"] as const).map((value) => <TabsTrigger key={value} value={value} className="h-6 text-xs capitalize">{value}</TabsTrigger>)}</TabsList></Tabs></CardHeader>
        <CardContent className="min-w-0 max-h-[640px] overflow-auto p-0"><Table className="min-w-[1040px] table-fixed"><TableHeader className="sticky top-0 z-10 bg-card"><TableRow><TableHead className="w-8" /><SortableTableHead label="Puzzle" active={answerSort.key === "puzzle"} direction={answerSort.direction} className="w-20" onSort={() => toggleAnswerSort("puzzle")} /><SortableTableHead label="Rating" active={answerSort.key === "rating"} direction={answerSort.direction} align="right" className="w-20" onSort={() => toggleAnswerSort("rating")} /><SortableTableHead label="Points" active={answerSort.key === "points"} direction={answerSort.direction} align="right" className="w-20" onSort={() => toggleAnswerSort("points")} /><TableHead className="w-[300px]">Model answer</TableHead><TableHead className="w-[260px]">Correct line</TableHead><TableHead className="w-[150px]">Outcome</TableHead></TableRow></TableHeader><TableBody>{answerItems.map((item) => {
          const open = openPuzzle === item.puzzle_id
          const attempts = puzzleModelAttempts(item)
          const correctSolverMoves = item.plies_correct ?? (item.solved ? item.solver_plies ?? attempts.length : Math.round(item.score * (item.solver_plies ?? Math.ceil((item.solution?.length ?? 0) / 2))))
          const modelLine: PuzzleContinuationPly[] = displayRun.track === "woodpecker"
            ? uciLineToSan(item.fen, attempts).map((san, index) => ({ uci: attempts[index], san, source: "model", status: index < correctSolverMoves ? "correct" : "wrong" }))
            : puzzleContinuation(item.fen, attempts, item.solution ?? [], correctSolverMoves)
          const correctLine = uciLineToSan(item.fen, item.solution ?? []).join(" ") || item.solution?.join(" ")
          const rationale = item.answer_rationale ?? item.answer_explanation
          const hasAudit = Boolean(item.turns?.length || item.answer_raw || rationale)
          const outcome = item.solved ? "solved" : item.score > 0 ? "partial" : item.failure_reason?.replaceAll("_", " ") ?? "incorrect"
          return <Fragment key={item.puzzle_id}><TableRow className={hasAudit ? "cursor-pointer" : undefined} onClick={() => hasAudit && setOpenPuzzle(open ? null : item.puzzle_id)}><TableCell>{item.solved ? <Check className="size-4 text-emerald-600" /> : <X className={`size-4 ${item.score > 0 ? "text-amber-500" : "text-rose-500"}`} />}</TableCell><TableCell><Link to={`/puzzles/${item.puzzle_id}`} onClick={(event) => event.stopPropagation()} className="font-mono text-xs hover:underline">{item.puzzle_id}</Link></TableCell><TableCell className="text-right font-mono text-xs tabular-nums">{item.rating}</TableCell><TableCell className="text-right font-mono">{item.score.toFixed(2)}/1</TableCell><TableCell className="whitespace-normal"><span className="inline-flex flex-wrap items-center gap-1"><Continuation plies={modelLine} />{item.score > 0 && !item.solved && <span className="ml-1 text-xs text-amber-700 dark:text-amber-300">missed later</span>}{hasAudit && <ChevronDown className={`ml-1 inline size-3 transition-transform ${open ? "rotate-180" : ""}`} />}</span></TableCell><TableCell className="whitespace-normal font-mono text-xs leading-6 text-emerald-700 dark:text-emerald-300" title={correctLine}>{correctLine || "—"}</TableCell><TableCell className="space-x-1 whitespace-normal"><Badge variant={item.solved ? "secondary" : "outline"} className={item.score > 0 && !item.solved ? "border-amber-500/30 text-amber-700 dark:text-amber-300" : undefined}>{outcome}</Badge>{item.answer_response_format_valid != null && <Badge variant={item.answer_response_format_valid ? "outline" : "destructive"}>{item.answer_response_format_valid ? (activeResponseStyle.key === "move_only" ? "plain text" : "JSON") : "recovered"}</Badge>}</TableCell></TableRow>{open && hasAudit && <TableRow className="animate-in fade-in-0 slide-in-from-top-1 duration-200"><TableCell /><TableCell colSpan={6} className="max-w-0 whitespace-normal p-4"><div className="min-w-0 max-w-full space-y-3 overflow-hidden">{rationale ? <p className="text-sm leading-relaxed text-muted-foreground"><span className="font-medium text-foreground">Model rationale: </span>{rationale}</p> : null}{item.turns?.length ? <PromptTranscript turns={item.turns} /> : <ExactPromptBlock label="Visible model response" text={item.answer_raw ?? "—"} tone="schema" />}</div></TableCell></TableRow>}</Fragment>
        })}</TableBody></Table></CardContent></Card>
    </div>}
  </div>
}
