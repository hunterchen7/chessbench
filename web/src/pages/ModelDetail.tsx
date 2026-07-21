import { Fragment, type KeyboardEvent, useCallback, useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams, useSearchParams, useLocation } from "react-router-dom"
import { ArrowLeft, Check, ChevronDown, CircleDollarSign, Database, Gauge, GitCompareArrows, Info, Layers3, Play, Scale, X } from "lucide-react"
import { useData } from "@/lib/useData"
import { loadRun, type PuzzleItem, type RatedSessionProtocol, type Run, type RunIndexEntry, type RunTermination } from "@/lib/data"
import { formatRatingDeviation, MODES, modeInfo, pct, pointsText, RESPONSE_STYLES, responseStyleInfo, TIER_ORDER } from "@/lib/format"
import { puzzleContinuation, puzzleModelAttempts, uciLineToSan, type PuzzleContinuationPly } from "@/lib/chess"
import { PUZZLE_ELO_PRIOR, puzzlePerformanceRating, puzzlePerformanceTrajectory } from "@/lib/puzzleRating"
import { PUZZLE_OUTCOME_COLORS, puzzleOutcome, type PuzzleOutcome } from "@/lib/puzzleOutcome"
import { isVisibleUiTrack } from "@/lib/uiTracks"
import { ModelIdentity } from "@/components/ModelIdentity"
import { PerformanceHistorySkeleton, RunDetailsSkeleton } from "@/components/LoadingSkeletons"
import { ResponseStyleBadge } from "@/components/ResponseStyle"
import { ExportButton } from "@/components/ExportButton"
import { ExactPromptBlock, PromptTranscript } from "@/components/PromptTranscript"
import { SortableTableHead, type SortDirection } from "@/components/SortableTableHead"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { comparisonPath } from "@/lib/runComparison"
import { ratedPlayPath } from "@/lib/ratedPlay"
import { reasoningConfigurationEffort, reasoningLabel } from "@/lib/modelReasoning"

const REASONING_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "budget", "provider"]

function suiteIdentity(run: RunIndexEntry) {
  return `${run.track}:${run.suite?.content_hash ?? run.suite?.name ?? "unspecified"}`
}

function conditionIdentity(run: RunIndexEntry) {
  return run.condition_slug || run.condition.slug
}

function runSeed(run: RunIndexEntry) {
  return run.protocol?.kind === "adaptive_glicko2"
    ? (run.protocol as RatedSessionProtocol).selection.seed
    : null
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

function terminationStatusLabel(termination: RunTermination) {
  if (termination.kind === "rating_settled") return "Settled"
  if (termination.kind === "operator_rounded") return "Rounded"
  return "Stopped"
}

function terminationTitle(termination: RunTermination) {
  if (termination.kind === "rating_settled") return "Rating uncertainty reached the stopping target"
  if (termination.kind === "operator_rounded") return "Rating uncertainty rounded to the stopping target"
  if (termination.kind === "maximum_puzzles") return "Completed at the rated-session safety cap"
  return "Completed by the consecutive-miss stopping rule"
}

function Stat({ label, value, note, icon: Icon, loading = false }: { label: string; value: string; note: string; icon: typeof Scale; loading?: boolean }) {
  return <Card><CardContent className="flex items-start gap-3 pt-6"><Icon className="mt-1 size-4 text-muted-foreground" /><div className="min-w-0 flex-1"><div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>{loading ? <><Skeleton className="mt-2 h-7 w-24" /><Skeleton className="mt-2 h-3 w-40 max-w-full" /></> : <><div className="mt-1 font-mono text-2xl font-semibold tabular-nums">{value}</div><div className="mt-0.5 text-xs text-muted-foreground">{note}</div></>}</div></CardContent></Card>
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
  outcome: PuzzleOutcome
  failureReason: string | null
  cumulativePoints: number
  elo: number
  eloDelta: number | null
  eloCi95: [number, number]
  eloDeviation: number
  eloProvisional: boolean
}

type AnswerSortKey = "puzzle" | "rating" | "points"

const PERFORMANCE_VIEWBOX_HEIGHT = 280
const ELO_PLOT_TOP = 16
const ELO_PLOT_BOTTOM = 174
const OUTCOME_RUG_TOP = 188
const OUTCOME_RUG_HEIGHT = 9
const POINTS_PLOT_TOP = 210
const POINTS_PLOT_BOTTOM = 262

function pointPosition(index: number, total: number, inset: number) {
  const ratio = (index + 0.5) / Math.max(1, total)
  return { ratio, left: `calc(${ratio * 100}% + ${inset * (1 - 2 * ratio)}px)` }
}

function PerformanceTooltip({ point, index, total, inset }: { point: PerformancePoint; index: number; total: number; inset: number }) {
  const position = pointPosition(index, total, inset)
  const outcome = point.solved ? "Solved" : point.score > 0 ? "Partial credit" : point.failureReason?.replaceAll("_", " ") ?? "Incorrect"
  const elo = Math.round(point.elo).toLocaleString()
  const delta = point.eloDelta == null ? null : Math.round(point.eloDelta)
  const side = position.ratio < 0.5 ? "right" : "left"
  const preferredLeft = side === "right"
    ? `calc(${position.left} + 1rem)`
    : `calc(${position.left} - 15rem)`
  const clampedLeft = `clamp(0.5rem, ${preferredLeft}, calc(100% - 14.5rem))`

  return <div role="tooltip" data-side={side} className="pointer-events-none absolute top-3 z-20 w-56 rounded-lg border bg-popover/95 p-3 text-popover-foreground shadow-xl backdrop-blur" style={{ left: clampedLeft }}>
      <div className="flex items-center justify-between gap-4"><span className="font-mono text-xs font-semibold">{point.puzzleId}</span><span className="text-[10px] text-muted-foreground">#{index + 1} of {total}</span></div>
      <div className="mt-2 grid grid-cols-[auto_auto] gap-x-5 gap-y-1 text-[11px] leading-tight">
        <span className="text-muted-foreground">Result</span><span className={point.solved ? "text-right font-medium text-emerald-700 dark:text-emerald-300" : point.score > 0 ? "text-right font-medium text-amber-700 dark:text-amber-300" : "text-right font-medium text-rose-700 dark:text-rose-300"}>{outcome}</span>
        <span className="text-muted-foreground">Puzzle rating</span><span className="text-right font-mono">{point.rating.toLocaleString()}</span>
        <span className="text-muted-foreground">This puzzle</span><span className="text-right font-mono">+{point.score.toFixed(2)} pt</span>
        <span className="text-muted-foreground">Cumulative</span><span className="text-right font-mono">{point.cumulativePoints.toFixed(2)} pts</span>
        <span className="text-muted-foreground">Puzzle Elo</span><span className="text-right font-mono">{elo}{delta == null ? "" : ` (${delta >= 0 ? "+" : ""}${delta})`}</span>
        <span className="text-muted-foreground">95% interval</span><span className="text-right font-mono">{Math.round(point.eloCi95[0]).toLocaleString()}–{Math.round(point.eloCi95[1]).toLocaleString()}</span>
        <span className="text-muted-foreground">Rating deviation</span><span className="text-right font-mono">{formatRatingDeviation(point.eloDeviation)}{point.eloProvisional ? " · provisional" : ""}</span>
      </div>
    </div>
}

function PerformanceHistory({ items, maxPoints, totalItems, termination }: { items: PuzzleItem[]; maxPoints: number; totalItems: number; termination?: RunIndexEntry["termination"] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const adaptive = items.some((item) => item.solver_rating_after != null)
  const zeroScoredTail = termination?.kind === "consecutive_unsolved"
  const chartItems = adaptive ? items.length : totalItems
  const history = useMemo(() => {
    let points = 0
    let previousElo: number | null = items[0]?.solver_rating_before?.rating ?? null
    const trajectory = puzzlePerformanceTrajectory(items)
    return items.map((item, index) => {
      points += item.score
      const recorded = item.solver_rating_after
      const estimate = recorded ? {
        rating: recorded.rating,
        ci95: recorded.ci95,
        rating_deviation: recorded.rating_deviation,
        provisional: recorded.provisional,
      } : trajectory[index]
      const elo = estimate.rating
      const eloDelta = previousElo == null ? null : elo - previousElo
      previousElo = elo
      return {
        puzzleId: item.puzzle_id,
        rating: item.rating,
        score: item.score,
        solved: item.solved,
        outcome: puzzleOutcome(item),
        failureReason: item.failure_reason,
        cumulativePoints: points,
        elo,
        eloDelta,
        eloCi95: estimate.ci95,
        eloDeviation: estimate.rating_deviation,
        eloProvisional: estimate.provisional,
      } satisfies PerformancePoint
    })
  }, [items])
  const ratingOrdered = items.every((item, index) => {
    if (index === 0) return true
    const previous = items[index - 1]
    return previous.rating < item.rating || (previous.rating === item.rating && previous.puzzle_id <= item.puzzle_id)
  })

  const hoverAt = (clientX: number, left: number, width: number) => {
    const inset = 8
    const ratio = Math.max(0, Math.min(1, (clientX - left - inset) / Math.max(1, width - inset * 2)))
    const plottedItems = items.some((item) => "solver_rating_after" in item && item.solver_rating_after != null)
      ? history.length
      : totalItems
    const index = Math.min(plottedItems - 1, Math.floor(ratio * plottedItems))
    setHoveredIndex(index < history.length ? index : null)
  }

  const chart = useMemo(() => {
    if (!history.length) return null
    const intervalValues = history.flatMap((point) => point.eloCi95)
    const eloMin = Math.floor((Math.min(...intervalValues) - 50) / 100) * 100
    const rawMax = Math.ceil((Math.max(...intervalValues) + 50) / 100) * 100
    const eloMax = Math.max(eloMin + 200, rawMax)
    const x = (index: number) => (index + 0.5) / chartItems * 1000
    const eloY = (rating: number) => ELO_PLOT_BOTTOM - (rating - eloMin) / (eloMax - eloMin) * (ELO_PLOT_BOTTOM - ELO_PLOT_TOP)
    const pointsY = (points: number) => POINTS_PLOT_BOTTOM - points / Math.max(1, maxPoints) * (POINTS_PLOT_BOTTOM - POINTS_PLOT_TOP)
    const eloLine = history.map((point, index) => `${x(index)},${eloY(point.elo)}`).join(" ")
    const upperInterval = history.map((point, index) => `${x(index)},${eloY(point.eloCi95[1])}`)
    const lowerInterval = history.map((point, index) => `${x(index)},${eloY(point.eloCi95[0])}`)
    const attemptedPointsLine = history.map((point, index) => `${x(index)},${pointsY(point.cumulativePoints)}`).join(" ")
    const pointsLine = zeroScoredTail ? `${attemptedPointsLine} 1000,${pointsY(history.at(-1)!.cumulativePoints)}` : attemptedPointsLine
    return {
      eloMin,
      eloMax,
      eloY,
      pointsY,
      eloLine,
      upperInterval,
      lowerInterval,
      intervalBand: [...upperInterval, ...lowerInterval.toReversed()].join(" "),
      pointsLine,
      pointsArea: `0,${POINTS_PLOT_BOTTOM} ${pointsLine} 1000,${POINTS_PLOT_BOTTOM}`,
      finalX: x(history.length - 1),
    }
  }, [chartItems, history, maxPoints, zeroScoredTail])
  if (!history.length || !chart) return null
  const final = history.at(-1)!
  const hovered = hoveredIndex == null ? null : history[hoveredIndex]
  const displayed = hovered ?? final
  const hoveredPosition = hoveredIndex == null ? null : pointPosition(hoveredIndex, chartItems, 8)
  const innerTop = (y: number) => `calc(${y / PERFORMANCE_VIEWBOX_HEIGHT * 100}% + ${8 - y / PERFORMANCE_VIEWBOX_HEIGHT * 16}px)`
  const inspectWithKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return
    event.preventDefault()
    setHoveredIndex((current) => {
      if (event.key === "Home") return 0
      if (event.key === "End") return history.length - 1
      const startingIndex = current ?? history.length - 1
      return Math.max(0, Math.min(history.length - 1, startingIndex + (event.key === "ArrowLeft" ? -1 : 1)))
    })
  }

  return <Card>
    <CardHeader className="gap-3 sm:flex sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        <CardTitle className="text-base">{adaptive ? "Adaptive rating path" : "Performance over suite"}</CardTitle>
        <p className="max-w-3xl text-xs text-muted-foreground">{adaptive ? "The exact Glicko state after every deterministically selected puzzle. Puzzle ratings remain frozen; the shaded 95% uncertainty band changes with every win or loss." : <>A shared timeline for cumulative points, per-puzzle outcomes, and Bayesian complete-solve Puzzle Elo in {ratingOrdered ? "rating-ascending order" : "the suite’s frozen historical order"}. The shaded 95% posterior band narrows as evidence accumulates.</>}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
        <span className="text-muted-foreground">{hoveredIndex == null ? (termination ? `${terminationStatusLabel(termination)} after ${items.length} puzzles` : "Final") : `Puzzle ${hoveredIndex + 1}/${items.length}`}</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-violet-500" /><span className="font-mono font-semibold text-violet-700 dark:text-violet-300">{Math.round(displayed.elo).toLocaleString()}</span><span className="font-mono text-muted-foreground">RD {formatRatingDeviation(displayed.eloDeviation)}</span>{displayed.eloProvisional ? <Badge variant="outline" className="h-4 px-1 text-[8px] uppercase tracking-wide">provisional</Badge> : null}</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-emerald-500" /><span className="font-mono font-semibold text-emerald-700 dark:text-emerald-300">{displayed.cumulativePoints.toFixed(2)}/{maxPoints.toFixed(0)}</span></span>
      </div>
    </CardHeader>
    <CardContent className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center justify-end gap-3 text-[10px] text-muted-foreground"><span className="font-medium uppercase tracking-wide">Puzzle outcomes</span><span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-emerald-500" /> Full</span><span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-amber-500" /> Partial</span><span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-rose-500" /> Zero</span></div>
      <div
        className="relative h-72 touch-pan-y overflow-hidden rounded-xl border bg-secondary/25 p-2 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:h-80"
        aria-label="Combined Puzzle Elo, puzzle outcomes, and cumulative points timeline. Hover, tap, or use the arrow keys to inspect a puzzle."
        tabIndex={0}
        onPointerMove={(event) => { const rect = event.currentTarget.getBoundingClientRect(); hoverAt(event.clientX, rect.left, rect.width) }}
        onPointerDown={(event) => { const rect = event.currentTarget.getBoundingClientRect(); hoverAt(event.clientX, rect.left, rect.width) }}
        onPointerLeave={() => setHoveredIndex(null)}
        onFocus={() => setHoveredIndex((current) => current ?? history.length - 1)}
        onBlur={() => setHoveredIndex(null)}
        onKeyDown={inspectWithKeys}
      >
        <svg viewBox={`0 0 1000 ${PERFORMANCE_VIEWBOX_HEIGHT}`} preserveAspectRatio="none" className="size-full overflow-visible" role="img" aria-label={`${adaptive ? "Glicko puzzle rating" : "Bayesian Puzzle Elo"} changed from ${Math.round(history[0].elo)} to ${Math.round(final.elo)} while cumulative points reached ${final.cumulativePoints.toFixed(2)} of ${maxPoints.toFixed(0)}`}>
          <line x1="0" y1={ELO_PLOT_TOP} x2="1000" y2={ELO_PLOT_TOP} className="stroke-border" vectorEffect="non-scaling-stroke" strokeDasharray="3 4" />
          <line x1="0" y1={(ELO_PLOT_TOP + ELO_PLOT_BOTTOM) / 2} x2="1000" y2={(ELO_PLOT_TOP + ELO_PLOT_BOTTOM) / 2} className="stroke-border" opacity="0.65" vectorEffect="non-scaling-stroke" strokeDasharray="3 4" />
          <line x1="0" y1={ELO_PLOT_BOTTOM} x2="1000" y2={ELO_PLOT_BOTTOM} className="stroke-border" vectorEffect="non-scaling-stroke" />
          <polygon points={chart.intervalBand} className="fill-violet-500" opacity="0.12" />
          <polyline points={chart.upperInterval.join(" ")} fill="none" className="stroke-violet-500" strokeWidth="1" opacity="0.35" vectorEffect="non-scaling-stroke" strokeDasharray="3 3" />
          <polyline points={chart.lowerInterval.join(" ")} fill="none" className="stroke-violet-500" strokeWidth="1" opacity="0.35" vectorEffect="non-scaling-stroke" strokeDasharray="3 3" />
          <polyline points={chart.eloLine} fill="none" className="stroke-violet-500" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
          {history.map((point, index) => <rect key={point.puzzleId} x={index / chartItems * 1000 + 0.35} y={OUTCOME_RUG_TOP} width={Math.max(1, 1000 / chartItems - 0.7)} height={OUTCOME_RUG_HEIGHT} rx="1" fill={PUZZLE_OUTCOME_COLORS[point.outcome]} opacity="0.9" />)}
          {zeroScoredTail ? <rect x={history.length / totalItems * 1000} y={OUTCOME_RUG_TOP} width={(totalItems - history.length) / totalItems * 1000} height={OUTCOME_RUG_HEIGHT} rx="1" className="fill-muted-foreground" opacity="0.22" /> : null}
          <line x1="0" y1={POINTS_PLOT_TOP} x2="1000" y2={POINTS_PLOT_TOP} className="stroke-border" vectorEffect="non-scaling-stroke" strokeDasharray="3 4" />
          <line x1="0" y1={POINTS_PLOT_BOTTOM} x2="1000" y2={POINTS_PLOT_BOTTOM} className="stroke-border" vectorEffect="non-scaling-stroke" />
          <polygon points={chart.pointsArea} className="fill-emerald-500" opacity="0.16" />
          <polyline points={chart.pointsLine} fill="none" className="stroke-emerald-500" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
          <line x1={chart.finalX} y1={chart.eloY(final.eloCi95[1])} x2={chart.finalX} y2={chart.eloY(final.eloCi95[0])} className="stroke-violet-500" strokeWidth="1.5" opacity="0.75" vectorEffect="non-scaling-stroke" />
          {zeroScoredTail ? <line x1={history.length / totalItems * 1000} y1={ELO_PLOT_TOP} x2={history.length / totalItems * 1000} y2={POINTS_PLOT_BOTTOM} className="stroke-amber-500" strokeWidth="1.5" opacity="0.8" vectorEffect="non-scaling-stroke" strokeDasharray="5 4" /> : null}
        </svg>
        <span className="pointer-events-none absolute left-3 top-2 rounded bg-background/80 px-1 font-mono text-[9px] text-muted-foreground">Elo {chart.eloMax.toLocaleString()}</span>
        <span className="pointer-events-none absolute left-3 rounded bg-background/80 px-1 font-mono text-[9px] text-muted-foreground" style={{ top: innerTop(ELO_PLOT_BOTTOM) }}>{chart.eloMin.toLocaleString()}</span>
        <span className="pointer-events-none absolute left-3 rounded bg-background/80 px-1 font-mono text-[9px] text-muted-foreground" style={{ top: innerTop(POINTS_PLOT_TOP) }}>Points {maxPoints.toFixed(0)}</span>
        <span className="pointer-events-none absolute bottom-2 left-3 rounded bg-background/80 px-1 font-mono text-[9px] text-muted-foreground">0</span>
        {hovered && hoveredIndex != null && hoveredPosition ? <>
          <span className="pointer-events-none absolute inset-y-2 z-10 w-px bg-foreground/25" style={{ left: hoveredPosition.left }} />
          <span className="pointer-events-none absolute z-10 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-500 ring-2 ring-background" style={{ left: hoveredPosition.left, top: innerTop(chart.eloY(hovered.elo)) }} />
          <span className="pointer-events-none absolute z-10 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-emerald-500 ring-2 ring-background" style={{ left: hoveredPosition.left, top: innerTop(chart.pointsY(hovered.cumulativePoints)) }} />
          <PerformanceTooltip point={hovered} index={hoveredIndex} total={items.length} inset={8} />
        </> : null}
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span>{zeroScoredTail ? `${history.length} attempted · ${termination?.unattempted ?? totalItems - history.length} unattempted puzzles score zero` : adaptive ? `${history.length} adaptive selections · ${termination?.message ?? "rating still settling"}` : ratingOrdered ? `rating ${history[0].rating.toLocaleString()} → ${final.rating.toLocaleString()}` : `puzzle 1 → ${history.length}`}</span>
        <span>{adaptive ? "violet band · 95% Glicko interval · initial 1,500 ± 500.00 RD" : `violet band · 95% posterior · MAP prior ${PUZZLE_ELO_PRIOR.mean.toLocaleString()} ± ${PUZZLE_ELO_PRIOR.sd.toLocaleString()}`}</span>
      </div>
    </CardContent>
  </Card>
}

export function ModelDetail() {
  const location = useLocation()
  const { model = "" } = useParams()
  const navigate = useNavigate()
  const key = decodeURIComponent(model)
  const { runs } = useData()
  const [searchParams, setSearchParams] = useSearchParams()
  const updateSearchParams = useCallback((update: (next: URLSearchParams) => void) => setSearchParams((current) => {
    const next = new URLSearchParams(current)
    update(next)
    return next
  }, { replace: true }), [setSearchParams])
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
  const selectRun = useCallback((runId: string) => updateSearchParams((next) => {
    next.set("run", runId)
    next.delete("answer")
  }), [updateSearchParams])
  const [run, setRun] = useState<Run | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const requestedFilter = searchParams.get("answers")
  const filter: "all" | "solved" | "failed" = requestedFilter === "solved" || requestedFilter === "failed" ? requestedFilter : "all"
  const requestedAnswerSort = searchParams.get("sort")
  const answerSort: { key: AnswerSortKey | null; direction: SortDirection } = {
    key: requestedAnswerSort === "puzzle" || requestedAnswerSort === "rating" || requestedAnswerSort === "points" ? requestedAnswerSort : null,
    direction: searchParams.get("direction") === "desc" ? "desc" : "asc",
  }
  const openPuzzle = searchParams.get("answer")
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

  const setFilter = useCallback((value: "all" | "solved" | "failed") => updateSearchParams((next) => {
    if (value === "all") next.delete("answers")
    else next.set("answers", value)
  }), [updateSearchParams])
  const setOpenPuzzle = useCallback((puzzleId: string | null) => updateSearchParams((next) => {
    if (puzzleId) next.set("answer", puzzleId)
    else next.delete("answer")
  }), [updateSearchParams])
  const toggleAnswerSort = useCallback((key: AnswerSortKey) => {
    const direction = answerSort.key === key ? (answerSort.direction === "asc" ? "desc" : "asc") : key === "points" ? "desc" : "asc"
    updateSearchParams((next) => {
      next.set("sort", key)
      next.set("direction", direction)
    })
  }, [answerSort.key, answerSort.direction, updateSearchParams])

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
  const reasoningVariants = Array.from(runs
    .filter((candidate) => isVisibleUiTrack(candidate.track) && candidate.status !== "failed" && candidate.model_variant.base_key === variant.base_key)
    .reduce((groups, candidate) => {
      const existing = groups.get(candidate.model_variant.key)
      if (existing) existing.push(candidate)
      else groups.set(candidate.model_variant.key, [candidate])
      return groups
    }, new Map<string, RunIndexEntry[]>()))
    .map(([variantKey, candidates]) => {
      const destination = candidates.toSorted((a, b) =>
        Number(suiteIdentity(b) === activeSuiteKey) - Number(suiteIdentity(a) === activeSuiteKey)
        || Number(conditionIdentity(b) === conditionIdentity(meta)) - Number(conditionIdentity(a) === conditionIdentity(meta))
        || Number(runSeed(b) === runSeed(meta)) - Number(runSeed(a) === runSeed(meta))
        || Number(b.status === "completed") - Number(a.status === "completed")
        || (b.completed_at ?? b.updated_at ?? b.created).localeCompare(a.completed_at ?? a.updated_at ?? a.created),
      )[0]
      return { key: variantKey, destination, runCount: candidates.length }
    })
    .toSorted((a, b) => {
      const aEffort = reasoningConfigurationEffort(a.destination.model_variant)
      const bEffort = reasoningConfigurationEffort(b.destination.model_variant)
      return (REASONING_ORDER.indexOf(aEffort) + 1 || REASONING_ORDER.length + 1)
        - (REASONING_ORDER.indexOf(bEffort) + 1 || REASONING_ORDER.length + 1)
        || a.destination.model_variant.provider.localeCompare(b.destination.model_variant.provider)
    })

  const byTier = TIER_ORDER.map((tier) => {
    const items = displayRun.items.filter((item) => item.categories?.tier?.includes(tier))
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
  const ratedProtocol = meta.protocol?.kind === "adaptive_glicko2"
    ? meta.protocol as RatedSessionProtocol
    : null
  const adaptive = ratedProtocol != null
  const playSameSeedPath = ratedProtocol ? ratedPlayPath(ratedProtocol) : null
  const performance = adaptive && meta.summary.puzzle_performance_rating
    ? meta.summary.puzzle_performance_rating
    : puzzlePerformanceRating(displayRun.items)
  const performanceValue = !run || performance.n === 0 ? "—" : Math.round(performance.rating).toLocaleString()
  const performanceNote = performance.ci95 && performance.rating_deviation != null
    ? `${performance.provisional ? "provisional · " : "settled" in performance && performance.settled ? "settled · " : ""}RD ${formatRatingDeviation(performance.rating_deviation)} · 95% ${Math.round(performance.ci95[0]).toLocaleString()}–${Math.round(performance.ci95[1]).toLocaleString()}`
    : "requires puzzle outcomes"

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
      <div className="flex flex-wrap gap-2">{playSameSeedPath && <Button asChild><Link to={playSameSeedPath}><Play /> Play seed {ratedProtocol?.selection.seed}</Link></Button>}<Button variant="outline" asChild><Link to={comparisonPath([meta.run_id])}><GitCompareArrows /> Compare this run</Link></Button><ExportButton run={meta.run_id} label="Export this run" /></div>
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
        <div className="grid items-end gap-3 border-t pt-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,300px)_minmax(0,420px)_1fr]">
          <div className="space-y-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Reasoning configuration</div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="h-10 w-full cursor-pointer justify-between gap-3 bg-background px-3 font-normal" aria-label="Choose reasoning configuration">
                  <span className="min-w-0 truncate text-left"><span className="font-medium">{reasoningLabel(variant)}</span><span className="text-muted-foreground"> · {variant.provider}</span></span>
                  <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-72 max-w-[calc(100vw-2rem)]">
                <DropdownMenuLabel>Same model, different reasoning</DropdownMenuLabel>
                {reasoningVariants.map(({ key: siblingKey, destination, runCount }) => {
                  const active = siblingKey === variant.key
                  return <DropdownMenuItem key={siblingKey} onSelect={() => {
                    if (!active) navigate(`/model/${encodeURIComponent(siblingKey)}?run=${encodeURIComponent(destination.run_id)}`)
                  }} className="items-start py-2.5">
                    <Check className={cn("mt-0.5 size-4 shrink-0", active ? "text-emerald-600 opacity-100" : "opacity-0")} />
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{reasoningLabel(destination.model_variant)}</span><span className="mt-0.5 block text-[11px] text-muted-foreground">{destination.model_variant.provider} · {runCount} run{runCount === 1 ? "" : "s"} · opens seed {runSeed(destination) ?? "—"}</span></span>
                  </DropdownMenuItem>
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="space-y-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Run configuration</div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="h-10 w-full cursor-pointer justify-between gap-3 bg-background px-3 font-normal" aria-label="Choose run configuration">
                  <span className="min-w-0 truncate text-left"><span className="font-medium">{runConfigurationLabel(meta)}</span><span className="text-muted-foreground"> · {meta.status}</span></span>
                  <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-72 max-w-[calc(100vw-2rem)]">
                <DropdownMenuLabel>Choose a run configuration</DropdownMenuLabel>
                {activeSuiteGroup.runs.toSorted((a, b) => (modeInfo(a.condition)?.displayN ?? 99) - (modeInfo(b.condition)?.displayN ?? 99) || responseStyleInfo(a.condition).label.localeCompare(responseStyleInfo(b.condition).label)).map((candidate) => {
                  const active = candidate.run_id === meta.run_id
                  return <DropdownMenuItem key={candidate.run_id} onSelect={() => selectRun(candidate.run_id)} className="items-start py-2.5">
                    <Check className={cn("mt-0.5 size-4 shrink-0", active ? "text-emerald-600 opacity-100" : "opacity-0")} />
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{runConfigurationLabel(candidate)}</span><span className="mt-0.5 block text-[11px] text-muted-foreground">{candidate.status} · {candidate.progress.completed}/{candidate.progress.total} durable items</span></span>
                  </DropdownMenuItem>
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-dashed px-3 py-2.5 text-xs leading-relaxed text-muted-foreground sm:col-span-2 xl:col-span-1"><Info className="mt-0.5 size-3.5 shrink-0" /><span>Puzzles are isolated from one another. Conversation state persists only between moves of the same puzzle.</span></div>
        </div>
      </CardContent>
    </Card>

    {meta.termination ? <Card className={cn(meta.termination.kind === "rating_settled" ? "border-emerald-500/35 bg-emerald-500/[0.055]" : "border-amber-500/35 bg-amber-500/[0.055]")}><CardContent className="flex gap-3 py-5"><Info className={cn("mt-0.5 size-5 shrink-0", meta.termination.kind === "rating_settled" ? "text-emerald-600 dark:text-emerald-300" : "text-amber-600 dark:text-amber-300")} /><div><div className="font-semibold">{terminationTitle(meta.termination)}</div><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{meta.termination.message}</p>{meta.termination.kind === "consecutive_unsolved" ? <p className="mt-1 text-xs text-muted-foreground">The fixed suite keeps its full denominator: {meta.termination.unattempted} unattempted tail puzzles receive zero points, while the answer sheet preserves only genuine model responses.</p> : meta.termination.kind === "operator_rounded" ? <p className="mt-1 text-xs text-muted-foreground">The exact RD remains stored for auditability; only its rounded display was accepted as the stopping target. No synthetic results were added.</p> : <p className="mt-1 text-xs text-muted-foreground">Adaptive sessions contain only genuine attempts. Stopping at convergence does not add synthetic losses or change the frozen puzzle ratings.</p>}</div></CardContent></Card> : null}

    <section className={`grid gap-3 sm:grid-cols-2 ${meta.track === "puzzle" ? "xl:grid-cols-5" : "xl:grid-cols-4"}`}>
      <Stat icon={Scale} label="Points" value={pointsText(meta.summary)} note="fractional prefix credit" />
      <Stat icon={Check} label="Complete solves" value={`${meta.summary.solved}/${meta.summary.n}`} note={pct(meta.summary.solve_rate)} />
      {meta.track === "puzzle" && <Stat icon={Gauge} label={adaptive ? "Puzzle rating" : "Puzzle performance"} value={performanceValue} note={adaptive ? performanceNote : `${performanceNote} · secondary`} loading={!run && !runError} />}
      <Stat icon={Database} label="Legal first" value={pct(meta.summary.first_move_legal_rate)} note={meta.summary.response_format_valid_rate == null ? `${meta.progress.completed}/${meta.progress.total} durable items` : `${pct(meta.summary.response_format_valid_rate)} ${activeResponseStyle.key === "move_only" ? "parseable text" : "valid JSON"} · ${meta.progress.completed}/${meta.progress.total} durable`} />
      <Stat icon={CircleDollarSign} label="Recorded cost" value={meta.summary.cost_usd == null ? "—" : `$${meta.summary.cost_usd.toFixed(4)}`} note={costNote} />
    </section>

    {modeRuns.filter((item) => item.run).length > 1 && <Card><CardHeader><CardTitle className="flex flex-wrap items-center gap-2 text-base">Prompt-method comparison <ResponseStyleBadge condition={meta.condition} compact /></CardTitle></CardHeader><CardContent className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">{modeRuns.map(({ mode, run: candidate }) => <button key={mode.n} type="button" disabled={!candidate} onClick={() => candidate && selectRun(candidate.run_id)} className={cn("cursor-pointer rounded-lg border p-4 text-left transition-all hover:-translate-y-0.5 hover:border-foreground/25 hover:shadow-sm disabled:cursor-not-allowed disabled:hover:translate-y-0", candidate?.run_id === meta.run_id && "border-primary/40 bg-primary/[0.035] shadow-sm")}><div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{mode.displayN}. {mode.name}</div><div className="mt-2 font-mono text-xl font-semibold">{candidate ? pointsText(candidate.summary) : "—"}</div><div className="mt-1 text-xs text-muted-foreground">{candidate ? `${pct(candidate.summary.solve_rate)} complete · click to view` : "not run"}</div></button>)}</CardContent></Card>}

    {meta.track === "puzzle" && activeMode && <Card><CardHeader><CardTitle className="text-base">Response-style ablation · Method {activeMode.displayN} {activeMode.name}</CardTitle></CardHeader><CardContent className="grid gap-2 sm:grid-cols-2">{responseRuns.map(({ style, run: candidate }) => <button type="button" disabled={!candidate} onClick={() => candidate && selectRun(candidate.run_id)} key={style.key} className={cn("cursor-pointer rounded-xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:border-foreground/25 hover:shadow-sm disabled:cursor-not-allowed disabled:hover:translate-y-0", style.key === activeResponseStyle.key && "border-primary/35 bg-primary/[0.025] shadow-sm")}><ResponseStyleBadge condition={style.key === "move_only" ? "plain-text-v1" : "json-rationale"} /><div className="mt-3 font-mono text-xl font-semibold">{candidate ? pointsText(candidate.summary) : "—"}</div><div className="mt-1 text-xs text-muted-foreground">{candidate ? `${pct(candidate.summary.solve_rate)} complete · ${candidate.status} · click to view` : "not run for this suite"}</div></button>)}</CardContent></Card>}

    <Card>
      <CardHeader className="space-y-1"><CardTitle className="flex items-center gap-2 text-base"><GitCompareArrows className="size-4 text-violet-600" /> Suite comparison</CardTitle><p className="text-xs leading-relaxed text-muted-foreground">Same model configuration, prompt method, and response style across frozen test sets. Compare percentages and Puzzle Elo; raw points are only directly comparable when suite sizes match.</p></CardHeader>
      <CardContent className="p-0">
        <Table reorderableKey="model-suite-comparison"><TableHeader><TableRow><TableHead>Suite</TableHead><TableHead className="text-right">Items</TableHead><TableHead className="text-right">Points</TableHead><TableHead className="text-right">Full solves</TableHead><TableHead className="text-right">Puzzle Elo</TableHead><TableHead className="text-right">Cost</TableHead></TableRow></TableHeader><TableBody>{comparableSuiteRuns.map(({ group, run: candidate }) => <TableRow key={group.key} className={group.key === activeSuiteKey ? "bg-primary/[0.025]" : undefined}><TableCell><button type="button" disabled={!candidate} onClick={() => candidate && selectRun(candidate.run_id)} className="cursor-pointer text-left disabled:cursor-not-allowed"><span className="font-medium hover:underline">{group.suite?.name ?? "Unversioned suite"}</span><span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">{group.suite?.content_hash?.replace("sha256:", "") ?? "no content hash"}{group.key === activeSuiteKey ? " · identical order" : " · different frozen suite"}</span></button></TableCell><TableCell className="text-right tabular-nums">{candidate?.summary.n ?? "—"}</TableCell><TableCell className="text-right">{candidate ? <><div className="font-mono font-semibold">{pct(candidate.summary.points / Math.max(1, candidate.summary.max_points))}</div><div className="text-[10px] text-muted-foreground">{pointsText(candidate.summary)}</div></> : "Not run"}</TableCell><TableCell className="text-right">{candidate ? <><div className="font-mono font-semibold">{pct(candidate.summary.solve_rate)}</div><div className="text-[10px] text-muted-foreground">{candidate.summary.solved}/{candidate.summary.n}</div></> : "—"}</TableCell><TableCell className="text-right font-mono font-semibold">{candidate ? summaryRatingText(candidate) : "—"}</TableCell><TableCell className="text-right font-mono text-xs text-muted-foreground">{candidate?.summary.cost_usd == null ? "—" : `$${candidate.summary.cost_usd.toFixed(3)}`}</TableCell></TableRow>)}</TableBody></Table>
        {suiteGroups.length === 1 && <div className="border-t px-4 py-3 text-xs text-muted-foreground">Only one frozen suite has been published for this model configuration. Additional suites will appear here automatically once matching runs exist.</div>}
      </CardContent>
    </Card>

    {run ? <PerformanceHistory items={displayRun.items} maxPoints={meta.summary.max_points} totalItems={meta.progress.total} termination={meta.termination} /> : !runError ? <PerformanceHistorySkeleton adaptive={adaptive} /> : null}

    {run ? <div className="grid min-w-0 gap-5 2xl:grid-cols-[360px_minmax(0,1fr)]">
      <Card><CardHeader><CardTitle className="text-base">Difficulty breakdown</CardTitle></CardHeader><CardContent className="p-0"><div className="border-b px-4 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Numeric puzzle rating</div><Table reorderableKey="model-difficulty-breakdown"><TableHeader><TableRow><TableHead>Rating band</TableHead><TableHead className="text-right">Points</TableHead><TableHead className="text-right">Solved</TableHead></TableRow></TableHeader><TableBody>{byRating.map((row) => <TableRow key={row.low}><TableCell className="font-mono">{row.low}–{row.low + 399}</TableCell><TableCell className="text-right font-mono">{row.points.toFixed(2)}/{row.n}</TableCell><TableCell className="text-right text-muted-foreground">{row.solved}/{row.n}</TableCell></TableRow>)}<TableRow className="hover:bg-transparent"><TableCell colSpan={3} className="border-y px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Named tier</TableCell></TableRow>{byTier.map((row) => <TableRow key={row.tier}><TableCell className="capitalize">{row.tier}</TableCell><TableCell className="text-right font-mono">{row.points.toFixed(2)}/{row.n}</TableCell><TableCell className="text-right text-muted-foreground">{row.solved}/{row.n}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>

      <Card className="flex max-h-[calc(100dvh-2rem)] min-w-0 flex-col overflow-hidden"><CardHeader className="shrink-0 flex-row items-center justify-between gap-4 space-y-0"><div className="min-w-0"><CardTitle className="text-base">Answer sheet <span className="ml-2 font-normal text-muted-foreground">{displayRun.condition.puzzle_protocol === "full_line" ? "full variations" : "move by move"}</span></CardTitle><div className="mt-2 flex flex-wrap gap-3 text-[10px] text-muted-foreground"><span className="inline-flex items-center gap-1"><i className="size-2 rounded-sm bg-emerald-500/70" /> model move</span><span className="inline-flex items-center gap-1"><i className="size-2 rounded-sm border bg-muted" /> built-in puzzle reply</span><span className="inline-flex items-center gap-1"><i className="size-2 rounded-sm bg-rose-500/70" /> wrong / missing move</span><span>Click any row for its exact prompts and response.</span></div></div><Tabs value={filter} onValueChange={(value) => setFilter(value as typeof filter)}><TabsList className="h-8">{(["all", "solved", "failed"] as const).map((value) => <TabsTrigger key={value} value={value} className="h-6 text-xs capitalize">{value}</TabsTrigger>)}</TabsList></Tabs></CardHeader>
        <CardContent className="min-h-0 min-w-0 flex-1 overflow-auto p-0"><Table reorderableKey="model-answer-sheet" className="min-w-[1040px] table-fixed"><TableHeader className="sticky top-0 z-10 bg-card"><TableRow><TableHead className="w-8" /><SortableTableHead label="Puzzle" active={answerSort.key === "puzzle"} direction={answerSort.direction} className="w-20" onSort={() => toggleAnswerSort("puzzle")} /><SortableTableHead label="Rating" active={answerSort.key === "rating"} direction={answerSort.direction} align="right" className="w-20" onSort={() => toggleAnswerSort("rating")} /><SortableTableHead label="Points" active={answerSort.key === "points"} direction={answerSort.direction} align="right" className="w-20" onSort={() => toggleAnswerSort("points")} /><TableHead className="w-[300px]">Model answer</TableHead><TableHead className="w-[260px]">Correct line</TableHead><TableHead className="w-[150px]">Outcome</TableHead></TableRow></TableHeader><TableBody>{answerItems.map((item) => {
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
          return <Fragment key={item.puzzle_id}><TableRow className={hasAudit ? "cursor-pointer" : undefined} onClick={() => hasAudit && setOpenPuzzle(open ? null : item.puzzle_id)}><TableCell>{item.solved ? <Check className="size-4 text-emerald-600" /> : <X className={`size-4 ${item.score > 0 ? "text-amber-500" : "text-rose-500"}`} />}</TableCell><TableCell><Link to={`/puzzles/${item.puzzle_id}`} state={{ from: location.pathname + location.search }} onClick={(event) => event.stopPropagation()} className="font-mono text-xs hover:underline">{item.puzzle_id}</Link></TableCell><TableCell className="text-right font-mono text-xs tabular-nums">{item.rating}</TableCell><TableCell className="text-right font-mono">{item.score.toFixed(2)}/1</TableCell><TableCell className="whitespace-normal"><span className="inline-flex flex-wrap items-center gap-1"><Continuation plies={modelLine} />{item.score > 0 && !item.solved && <span className="ml-1 text-xs text-amber-700 dark:text-amber-300">missed later</span>}{hasAudit && <ChevronDown className={`ml-1 inline size-3 transition-transform ${open ? "rotate-180" : ""}`} />}</span></TableCell><TableCell className="whitespace-normal font-mono text-xs leading-6 text-emerald-700 dark:text-emerald-300" title={correctLine}>{correctLine || "—"}</TableCell><TableCell className="space-x-1 whitespace-normal"><Badge variant={item.solved ? "secondary" : "outline"} className={item.score > 0 && !item.solved ? "border-amber-500/30 text-amber-700 dark:text-amber-300" : undefined}>{outcome}</Badge>{item.answer_response_format_valid != null && <Badge variant={item.answer_response_format_valid ? "outline" : "destructive"}>{item.answer_response_format_valid ? (activeResponseStyle.key === "move_only" ? "plain text" : "JSON") : "recovered"}</Badge>}</TableCell></TableRow>{open && hasAudit && <TableRow className="animate-in fade-in-0 slide-in-from-top-1 duration-200"><TableCell /><TableCell colSpan={6} className="max-w-0 whitespace-normal p-4"><div className="min-w-0 max-w-full space-y-3 overflow-hidden">{rationale ? <p className="text-sm leading-relaxed text-muted-foreground"><span className="font-medium text-foreground">Model rationale: </span>{rationale}</p> : null}{item.turns?.length ? <PromptTranscript turns={item.turns} /> : <ExactPromptBlock label="Visible model response" text={item.answer_raw ?? "—"} tone="schema" />}</div></TableCell></TableRow>}</Fragment>
        })}</TableBody></Table></CardContent></Card>
    </div> : !runError ? <RunDetailsSkeleton /> : null}
  </div>
}
