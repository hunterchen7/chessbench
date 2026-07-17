import { useMemo, useState, type KeyboardEvent } from "react"
import { Link } from "react-router-dom"
import { GitCompareArrows, Rows3 } from "lucide-react"
import type { PuzzleItem, Run } from "@/lib/data"
import { puzzleContinuation, puzzleModelAttempts } from "@/lib/chess"
import { comparisonRunLabel } from "@/lib/runComparison"
import { puzzlePerformanceTrajectory } from "@/lib/puzzleRating"
import { modeInfo, pct, responseStyleInfo } from "@/lib/format"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

type Outcome = "solved" | "partial" | "failed"

interface ComparisonPoint {
  item: PuzzleItem
  outcome: Outcome
  answer: string
  cumulativePoints: number
  cumulativeRate: number
  elo: number
  eloDelta: number | null
  promptTokens: number
  completionTokens: number
  reasoningTokens: number
  cost: number
}

interface ComparisonSeries {
  run: Run
  color: string
  points: ComparisonPoint[]
}

const SERIES_COLORS = ["#8b5cf6", "#06b6d4", "#f59e0b", "#f43f5e"]
const STATUS_COLORS: Record<Outcome, string> = { solved: "#10b981", partial: "#f59e0b", failed: "#f43f5e" }
const CHART_WIDTH = 1000
const ELO_TOP = 18
const ELO_BOTTOM = 170
const RUG_TOP = 198
const RUG_HEIGHT = 10
const RUG_GAP = 6

function itemOutcome(item: PuzzleItem): Outcome {
  if (item.solved) return "solved"
  return item.score > 0 ? "partial" : "failed"
}

function outcomeLabel(point: ComparisonPoint): string {
  if (point.outcome === "solved") return "Full solve"
  if (point.outcome === "partial") return "Partial"
  return point.item.failure_reason?.replaceAll("_", " ") ?? "Zero points"
}

function outcomeClass(outcome: Outcome): string {
  if (outcome === "solved") return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
  if (outcome === "partial") return "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
  return "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300"
}

function modelAnswer(item: PuzzleItem): string {
  const attempts = puzzleModelAttempts(item)
  const correctMoves = item.plies_correct ?? (item.solved
    ? item.solver_plies ?? attempts.length
    : Math.round(item.score * (item.solver_plies ?? Math.ceil((item.solution?.length ?? 0) / 2))))
  return puzzleContinuation(item.fen, attempts, item.solution ?? [], correctMoves).map((ply) => ply.san).join(" ") || "no move"
}

function buildSeries(runs: Run[]): ComparisonSeries[] {
  return runs.map((run, seriesIndex) => {
    const trajectory = puzzlePerformanceTrajectory(run.items)
    let cumulativePoints = 0
    let previousElo: number | null = null
    const points = run.items.map((item, index) => {
      cumulativePoints += item.score
      const elo = trajectory[index].rating
      const turns = item.turns ?? []
      const point: ComparisonPoint = {
        item,
        outcome: itemOutcome(item),
        answer: modelAnswer(item),
        cumulativePoints,
        cumulativeRate: cumulativePoints / Math.max(1, run.summary.max_points),
        elo,
        eloDelta: previousElo == null ? null : elo - previousElo,
        promptTokens: turns.reduce((sum, turn) => sum + turn.prompt_tokens, 0),
        completionTokens: turns.reduce((sum, turn) => sum + turn.completion_tokens, 0),
        reasoningTokens: turns.reduce((sum, turn) => sum + turn.reasoning_tokens, 0),
        cost: turns.reduce((sum, turn) => sum + turn.cost_usd, 0),
      }
      previousElo = elo
      return point
    })
    return { run, color: SERIES_COLORS[seriesIndex], points }
  })
}

function aligned(runs: Run[]): boolean {
  const reference = runs[0]?.items ?? []
  return runs.every((run) => run.items.length === reference.length && run.items.every((item, index) => item.puzzle_id === reference[index]?.puzzle_id))
}

function pointLeft(index: number, total: number) {
  return total <= 1 ? 50 : index / (total - 1) * 100
}

function ComparisonTooltip({ series, index }: { series: ComparisonSeries[]; index: number }) {
  const total = series[0].points.length
  const position = pointLeft(index, total)
  const side = position < 50 ? "right" : "left"
  const preferred = side === "right" ? `calc(${position}% + 1rem)` : `calc(${position}% - 33rem)`
  const first = series[0].points[index]
  return <div role="tooltip" data-side={side} className="pointer-events-none absolute top-3 z-20 w-[32rem] max-w-[calc(100%-1rem)] rounded-xl border bg-popover/96 p-3 text-popover-foreground shadow-2xl backdrop-blur" style={{ left: `clamp(0.5rem, ${preferred}, calc(100% - 32.5rem))` }}>
    <div className="flex items-center justify-between gap-4"><div><div className="font-mono text-xs font-semibold">{first.item.puzzle_id}</div><div className="mt-0.5 text-[10px] text-muted-foreground">Rating {first.item.rating.toLocaleString()}</div></div><div className="text-[10px] text-muted-foreground">Puzzle {index + 1}/{total}</div></div>
    <div className="mt-3 grid gap-2">
      {series.map((entry) => {
        const point = entry.points[index]
        return <div key={entry.run.run_id} className="rounded-lg border bg-background/65 p-2.5">
          <div className="flex items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-2"><span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} /><span className="truncate text-xs font-semibold">{entry.run.model_variant.display_name}</span></div><Badge variant="outline" className={cn("h-5 shrink-0 px-1.5 text-[9px] capitalize", outcomeClass(point.outcome))}>{outcomeLabel(point)}</Badge></div>
          <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-3 text-[10px]"><div className="min-w-0"><div className="text-muted-foreground">Played line</div><div className="mt-0.5 truncate font-mono text-foreground" title={point.answer}>{point.answer}</div></div><div className="text-right font-mono tabular-nums"><div>{point.item.score.toFixed(2)} pt · {Math.round(point.elo).toLocaleString()} Elo</div><div className="mt-0.5 text-muted-foreground">{point.eloDelta == null ? "initial estimate" : `${point.eloDelta >= 0 ? "+" : ""}${Math.round(point.eloDelta)} Elo`} · {pct(point.cumulativeRate)} cumulative</div></div></div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 border-t pt-1.5 font-mono text-[9px] text-muted-foreground"><span>{point.promptTokens.toLocaleString()} in</span><span>{point.completionTokens.toLocaleString()} out</span><span>{point.reasoningTokens.toLocaleString()} reasoning</span><span>${point.cost.toFixed(4)}</span></div>
        </div>
      })}
    </div>
  </div>
}

function ComparisonChart({ series }: { series: ComparisonSeries[] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const total = series[0].points.length
  const rugBottom = RUG_TOP + series.length * (RUG_HEIGHT + RUG_GAP) - RUG_GAP
  const pointsTop = rugBottom + 30
  const pointsBottom = pointsTop + 74
  const chartHeight = pointsBottom + 14
  const chart = useMemo(() => {
    const ratings = series.flatMap((entry) => entry.points.map((point) => point.elo))
    const eloMin = Math.floor((Math.min(...ratings) - 75) / 100) * 100
    const eloMax = Math.max(eloMin + 200, Math.ceil((Math.max(...ratings) + 75) / 100) * 100)
    const x = (index: number) => total <= 1 ? CHART_WIDTH / 2 : index / (total - 1) * CHART_WIDTH
    const eloY = (value: number) => ELO_BOTTOM - (value - eloMin) / (eloMax - eloMin) * (ELO_BOTTOM - ELO_TOP)
    const pointsY = (value: number) => pointsBottom - value * (pointsBottom - pointsTop)
    return { eloMin, eloMax, x, eloY, pointsY }
  }, [series, total, pointsBottom, pointsTop])
  const hoveredLeft = hoveredIndex == null ? null : `${pointLeft(hoveredIndex, total)}%`
  const inspect = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
    event.preventDefault()
    setHoveredIndex((current) => {
      if (event.key === "Home") return 0
      if (event.key === "End") return total - 1
      const start = current ?? total - 1
      return Math.max(0, Math.min(total - 1, start + (event.key === "ArrowLeft" ? -1 : 1)))
    })
  }

  return <Card className="overflow-hidden">
    <CardHeader className="gap-4 lg:flex lg:flex-row lg:items-end lg:justify-between">
      <div><CardTitle className="flex items-center gap-2 text-base"><GitCompareArrows className="size-4 text-violet-600" /> Synchronized performance</CardTitle><p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">Bayesian complete-solve Puzzle Elo, per-puzzle outcomes, and cumulative points share one rating-ascending cursor.</p></div>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-[10px]">
        {series.map((entry) => <span key={entry.run.run_id} className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ backgroundColor: entry.color }} /><span className="font-medium">{entry.run.model_variant.display_name}</span><span className="text-muted-foreground">{modeInfo(entry.run.condition)?.displayN}. {modeInfo(entry.run.condition)?.name} · {responseStyleInfo(entry.run.condition).label}</span></span>)}
      </div>
    </CardHeader>
    <CardContent>
      <div className="mb-3 flex flex-wrap items-center justify-end gap-3 text-[10px] text-muted-foreground"><span className="font-medium uppercase tracking-wide">Outcome rugs</span><span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-emerald-500" /> Full</span><span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-amber-500" /> Partial</span><span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-rose-500" /> Zero</span></div>
      <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
        <div className="relative text-[9px] text-muted-foreground" style={{ height: chartHeight }} aria-hidden="true">
          <span className="absolute left-0 font-medium uppercase tracking-wide" style={{ top: ELO_TOP }}>Puzzle Elo</span><span className="absolute right-0 font-mono" style={{ top: ELO_TOP }}>{chart.eloMax.toLocaleString()}</span><span className="absolute bottom-auto right-0 font-mono" style={{ top: ELO_BOTTOM - 8 }}>{chart.eloMin.toLocaleString()}</span>
          <span className="absolute left-0 font-medium uppercase tracking-wide" style={{ top: RUG_TOP - 18 }}>Outcomes</span>
          {series.map((entry, index) => <span key={entry.run.run_id} className="absolute inset-x-0 flex items-center gap-1.5" style={{ top: RUG_TOP + index * (RUG_HEIGHT + RUG_GAP) - 1 }} title={comparisonRunLabel(entry.run)}><span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} /><span className="truncate">{entry.run.model_variant.display_name}</span></span>)}
          <span className="absolute left-0 font-medium uppercase tracking-wide" style={{ top: pointsTop }}>Cumulative</span><span className="absolute right-0 font-mono" style={{ top: pointsTop }}>100%</span><span className="absolute right-0 font-mono" style={{ top: pointsBottom - 8 }}>0%</span>
        </div>
        <div
          className="relative touch-pan-y overflow-hidden rounded-xl border bg-secondary/20 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          style={{ height: chartHeight }}
          tabIndex={0}
          aria-label={`Comparison timeline for ${series.length} runs over ${total} puzzles. Hover, tap, or use arrow keys to inspect.`}
          onPointerMove={(event) => { const rect = event.currentTarget.getBoundingClientRect(); const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))); setHoveredIndex(Math.round(ratio * (total - 1))) }}
          onPointerDown={(event) => { const rect = event.currentTarget.getBoundingClientRect(); const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))); setHoveredIndex(Math.round(ratio * (total - 1))) }}
          onPointerLeave={() => setHoveredIndex(null)}
          onFocus={() => setHoveredIndex((current) => current ?? total - 1)}
          onBlur={() => setHoveredIndex(null)}
          onKeyDown={inspect}
        >
          <svg viewBox={`0 0 ${CHART_WIDTH} ${chartHeight}`} preserveAspectRatio="none" className="size-full" role="img" aria-label="Overlaid Puzzle Elo and cumulative-points lines with one status tile per puzzle and run">
            {[ELO_TOP, (ELO_TOP + ELO_BOTTOM) / 2, ELO_BOTTOM, pointsTop, pointsBottom].map((y) => <line key={y} x1="0" y1={y} x2={CHART_WIDTH} y2={y} className="stroke-border" opacity={y === ELO_BOTTOM || y === pointsBottom ? 1 : 0.65} vectorEffect="non-scaling-stroke" strokeDasharray={y === ELO_BOTTOM || y === pointsBottom ? undefined : "3 4"} />)}
            {series.map((entry) => <g key={entry.run.run_id}>
              <polyline points={entry.points.map((point, index) => `${chart.x(index)},${chart.eloY(point.elo)}`).join(" ")} fill="none" stroke={entry.color} strokeWidth="2.25" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
              <polyline points={entry.points.map((point, index) => `${chart.x(index)},${chart.pointsY(point.cumulativeRate)}`).join(" ")} fill="none" stroke={entry.color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
              {entry.points.map((point, index) => <rect key={point.item.puzzle_id} x={index / total * CHART_WIDTH + 0.35} y={RUG_TOP + series.indexOf(entry) * (RUG_HEIGHT + RUG_GAP)} width={Math.max(1, CHART_WIDTH / total - 0.7)} height={RUG_HEIGHT} rx="1" fill={STATUS_COLORS[point.outcome]} opacity="0.9" />)}
            </g>)}
            {hoveredIndex != null ? <g><line x1={chart.x(hoveredIndex)} y1="8" x2={chart.x(hoveredIndex)} y2={chartHeight - 8} className="stroke-foreground" opacity="0.35" vectorEffect="non-scaling-stroke" />{series.map((entry) => <g key={entry.run.run_id}><circle cx={chart.x(hoveredIndex)} cy={chart.eloY(entry.points[hoveredIndex].elo)} r="4" fill={entry.color} className="stroke-background" strokeWidth="2" vectorEffect="non-scaling-stroke" /><circle cx={chart.x(hoveredIndex)} cy={chart.pointsY(entry.points[hoveredIndex].cumulativeRate)} r="3.5" fill={entry.color} className="stroke-background" strokeWidth="2" vectorEffect="non-scaling-stroke" /></g>)}</g> : null}
          </svg>
          {hoveredIndex != null && hoveredLeft ? <ComparisonTooltip series={series} index={hoveredIndex} /> : null}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-[10px] text-muted-foreground"><span>Rating {series[0].points[0].item.rating.toLocaleString()} → {series[0].points.at(-1)!.item.rating.toLocaleString()}</span><span>{hoveredIndex == null ? "Hover to compare the same puzzle across every run" : `Puzzle ${hoveredIndex + 1}/${total}`}</span></div>
    </CardContent>
  </Card>
}

function DisagreementTable({ series }: { series: ComparisonSeries[] }) {
  const [filter, setFilter] = useState<"differences" | "all">("differences")
  const rows = useMemo(() => series[0].points.map((point, index) => {
    const points = series.map((entry) => entry.points[index])
    const differs = new Set(points.map((entry) => `${entry.outcome}:${entry.item.score.toFixed(6)}`)).size > 1
    return { index, point, points, differs }
  }), [series])
  const visible = filter === "differences" ? rows.filter((row) => row.differs) : rows
  return <Card className="overflow-hidden">
    <CardHeader className="gap-4 sm:flex sm:flex-row sm:items-end sm:justify-between"><div><CardTitle className="flex items-center gap-2 text-base"><Rows3 className="size-4 text-amber-600" /> Puzzle-by-puzzle comparison</CardTitle><p className="mt-1 text-xs text-muted-foreground">Differences include any change in full, partial, or zero-credit outcomes.</p></div><Tabs value={filter} onValueChange={(value) => setFilter(value as "differences" | "all")}><TabsList><TabsTrigger value="differences">Disagreements · {rows.filter((row) => row.differs).length}</TabsTrigger><TabsTrigger value="all">All · {rows.length}</TabsTrigger></TabsList></Tabs></CardHeader>
    <CardContent className="max-h-[680px] overflow-auto p-0">
      <Table style={{ minWidth: 310 + series.length * 250 }}><TableHeader className="sticky top-0 z-10 bg-card"><TableRow><TableHead className="w-28">Puzzle</TableHead><TableHead className="w-20 text-right">Rating</TableHead>{series.map((entry) => <TableHead key={entry.run.run_id}><span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ backgroundColor: entry.color }} />{entry.run.model_variant.display_name}</span></TableHead>)}</TableRow></TableHeader><TableBody>
        {visible.map(({ point, points, index }) => <TableRow key={point.item.puzzle_id} style={{ contentVisibility: "auto", containIntrinsicSize: "0 58px" }}><TableCell><Link to={`/puzzles/${encodeURIComponent(point.item.puzzle_id)}`} className="font-mono font-semibold hover:underline">{point.item.puzzle_id}</Link><div className="mt-0.5 text-[9px] text-muted-foreground">#{index + 1}</div></TableCell><TableCell className="text-right font-mono tabular-nums">{point.item.rating.toLocaleString()}</TableCell>{points.map((entry, seriesIndex) => <TableCell key={series[seriesIndex].run.run_id} className="max-w-[260px] whitespace-normal"><div className="flex items-center gap-2"><Badge variant="outline" className={cn("h-5 px-1.5 text-[9px] capitalize", outcomeClass(entry.outcome))}>{entry.outcome === "failed" ? "zero" : entry.outcome}</Badge><span className="font-mono text-xs font-semibold tabular-nums">{entry.item.score.toFixed(2)} pt</span></div><div className="mt-1 truncate font-mono text-[10px] text-muted-foreground" title={entry.answer}>{entry.answer}</div></TableCell>)}</TableRow>)}
        {visible.length === 0 ? <TableRow><TableCell colSpan={2 + series.length} className="h-32 text-center text-sm text-muted-foreground">Every selected run received the same score on every puzzle.</TableCell></TableRow> : null}
      </TableBody></Table>
    </CardContent>
  </Card>
}

export function RunComparisonResults({ runs }: { runs: Run[] }) {
  const series = useMemo(() => buildSeries(runs), [runs])
  if (!aligned(runs)) return <div className="rounded-xl border border-destructive/30 bg-destructive/[0.05] p-4 text-sm text-destructive">The suite identifiers match, but the detailed puzzle order does not. The overlay was stopped to prevent a false comparison.</div>
  if (!series.length || !series[0].points.length) return null
  return <><ComparisonChart series={series} /><DisagreementTable series={series} /></>
}
