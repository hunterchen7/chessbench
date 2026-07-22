import { memo, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { ArrowUpRight, Check, ChevronDown, CircleDollarSign, Eye, EyeOff, Gauge, ListFilter, RotateCcw, Search, Tags, UserRound } from "lucide-react"
import type { RatedRunAggregate } from "@/lib/ratedAggregates"
import { costPerformancePoints, type CostPerformancePoint } from "@/lib/costPerformance"
import { effectiveReasoningEffort, reasoningEffortLabel, reasoningLabel } from "@/lib/modelReasoning"
import { fetchHumanTrainingProfileByRun, type HumanTrainingProfile } from "@/lib/backend"
import { useData } from "@/lib/useData"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItemIndicator, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"

const WIDTH = 1300
const HEIGHT = 462
const PLOT = { left: 76, right: 34, top: 44, bottom: 58 }
const NORMALIZED_PUZZLES = 50
const MINIMUM_RATING = 400
const RATING_AXIS_FLOOR = 100
const HUMAN_HOURLY_RATE = 50
const HUMAN_RUN_IDS = [
  "legacy:af491903-33b9-46c3-9f1f-f551054600fa",
  "e5ab2979-f16b-43a3-a603-e728355a1002",
  "7caff0c9-9117-4a18-9c53-aa2f636ec235",
] as const
const HUMAN_LABEL = "hunter (me)"
const HUMAN_COLOR = "#d946ef"
const CHART_STATE_STORAGE_KEY = "chessbench.rating-efficiency-state.v1"
type EfficiencyMetric = "cost" | "tokens"
type CostScale = "log" | "fourth" | "sqrt" | "linear"
const COST_SCALE_OPTIONS: Array<{ value: CostScale; label: string; axisLabel: string }> = [
  { value: "log", label: "Log", axisLabel: "log" },
  { value: "fourth", label: "4th root", axisLabel: "fourth root" },
  { value: "sqrt", label: "Sqrt", axisLabel: "square root" },
  { value: "linear", label: "Linear", axisLabel: "linear" },
]
const MODEL_COLORS = [
  "#2d6cdf", "#e95f0c", "#8e44ad", "#00897b", "#d81b60",
  "#6a994e", "#f4a261", "#5e60ce", "#9c6644", "#00a6a6",
  "#c44536", "#7a5195", "#ef5675", "#003f5c", "#bc5090",
  "#ffa600", "#4c78a8", "#f58518", "#54a24b", "#e45756",
  "#72b7b2", "#b279a2", "#ff7f9d", "#826251",
]
const MODEL_COLOR_BY_KEY: Record<string, string> = {
  "claude-fable-5": "#d81b60",
  "claude-opus-4.8": "#7a5195",
  "deepseek-v4": "#2d6cdf",
  "deepseek-v4-flash": "#4c78a8",
  "gemini-3.1-flash-lite": "#00a6a6",
  "gemini-3.5-flash": "#00897b",
  "glm-5.2": "#6a994e",
  "gpt-5.4-nano": "#f4a261",
  "gpt-5.6": "#ef5675",
  "gpt-5.6-luna": "#003f5c",
  "gpt-5.6-sol": "#5e60ce",
  "grok-4.5": "#e95f0c",
  inkling: "#9c6644",
  "kimi-k2.6": "#c44536",
  "kimi-k3": "#ffa600",
  "llama-3.1-8b-instruct": "#bc5090",
  "mercury-2": "#54a24b",
  "minimax-m3": "#72b7b2",
  "mistral-small-4": "#f58518",
  "nemotron-3-super": "#b279a2",
  "qwen-2.5-7b-instruct": "#e45756",
  "qwen3.5-flash": "#8e44ad",
  "qwen3.7-max": "#ff7f9d",
  "step-3.7-flash": "#826251",
}

interface SavedChartState {
  metric: EfficiencyMetric
  costScale: CostScale
  ratingMin: number | null
  ratingMax: number | null
  modelSearch: string
  reasoningFilters: string[]
  hiddenModelKeys: string[]
  hiddenModelReasoningKeys: string[]
  showHuman: boolean
  showLabels: boolean
  showLegend: boolean
}

function savedChartState(): SavedChartState {
  const fallback: SavedChartState = {
    metric: "cost",
    costScale: "log",
    ratingMin: null,
    ratingMax: null,
    modelSearch: "",
    reasoningFilters: [],
    hiddenModelKeys: [],
    hiddenModelReasoningKeys: [],
    showHuman: true,
    showLabels: true,
    showLegend: false,
  }
  try {
    const parsed = JSON.parse(localStorage.getItem(CHART_STATE_STORAGE_KEY) ?? "null") as Partial<SavedChartState> | null
    if (!parsed || typeof parsed !== "object") return fallback
    const strings = (value: unknown) => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []
    const optionalNumber = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null
    return {
      metric: parsed.metric === "tokens" ? "tokens" : fallback.metric,
      costScale: parsed.costScale === "fourth" || parsed.costScale === "sqrt" || parsed.costScale === "linear" ? parsed.costScale : fallback.costScale,
      ratingMin: optionalNumber(parsed.ratingMin),
      ratingMax: optionalNumber(parsed.ratingMax),
      modelSearch: typeof parsed.modelSearch === "string" ? parsed.modelSearch : fallback.modelSearch,
      reasoningFilters: strings(parsed.reasoningFilters),
      hiddenModelKeys: strings(parsed.hiddenModelKeys),
      hiddenModelReasoningKeys: strings(parsed.hiddenModelReasoningKeys),
      showHuman: typeof parsed.showHuman === "boolean" ? parsed.showHuman : fallback.showHuman,
      showLabels: typeof parsed.showLabels === "boolean" ? parsed.showLabels : fallback.showLabels,
      showLegend: typeof parsed.showLegend === "boolean" ? parsed.showLegend : fallback.showLegend,
    }
  } catch {
    return fallback
  }
}

function formatCost(value: number) {
  if (value === 0) return "$0.00"
  if (value < 0.000001) return `$${value.toExponential(1)}`
  if (value < 0.0001) return `$${value.toFixed(6)}`
  if (value < 0.01) return `$${value.toFixed(4)}`
  if (value < 1) return `$${value.toFixed(3)}`
  return `$${value.toFixed(2)}`
}

const COMPACT_TOKEN_FORMAT = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })

function formatTokens(value: number, compact = false) {
  if (compact) return COMPACT_TOKEN_FORMAT.format(value)
  if (value < 10) return value.toFixed(1)
  return Math.round(value).toLocaleString()
}

const REASONING_TEXT_CLASSES: Record<string, string> = {
  none: "fill-slate-600 dark:fill-slate-300",
  minimal: "fill-sky-600 dark:fill-sky-300",
  low: "fill-cyan-600 dark:fill-cyan-300",
  medium: "fill-emerald-600 dark:fill-emerald-300",
  high: "fill-amber-600 dark:fill-amber-300",
  xhigh: "fill-orange-600 dark:fill-orange-300",
  max: "fill-rose-600 dark:fill-rose-300",
  budget: "fill-violet-600 dark:fill-violet-300",
  provider: "fill-zinc-600 dark:fill-zinc-300",
}
const REASONING_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "budget", "provider"]

function compactReasoningLabel(effort: string) {
  if (effort === "none") return "off"
  if (effort === "minimal") return "min"
  if (effort === "medium") return "med"
  if (effort === "provider") return "off"
  return effort
}

interface HumanCostPerformancePoint {
  kind: "human"
  key: string
  runId: string
  rating: number
  ratingDeviation: number
  costPerPuzzle: number
  totalCost: number
  attempts: number
  solved: number
  runCount: number
  profiles: HumanTrainingProfile[]
}

type ChartPoint = CostPerformancePoint | HumanCostPerformancePoint

function isHumanPoint(point: ChartPoint): point is HumanCostPerformancePoint {
  return "kind" in point && point.kind === "human"
}

function metricValue(point: ChartPoint, metric: EfficiencyMetric) {
  if (metric === "cost") return point.costPerPuzzle * NORMALIZED_PUZZLES
  return isHumanPoint(point) ? null : point.tokensPerMove
}

function modelPointReasoningEffort(point: CostPerformancePoint) {
  const variant = point.representative.model_variant
  const resolved = effectiveReasoningEffort(variant)
  return resolved === "provider" ? "none" : resolved
}

function modelReasoningVisibilityKey(modelKey: string, effort: string) {
  return JSON.stringify([modelKey, effort])
}

function pointLabelParts(point: ChartPoint) {
  if (isHumanPoint(point)) return { firstLine: HUMAN_LABEL, secondModel: "", effort: "", effortLabel: "" }
  const effort = modelPointReasoningEffort(point)
  const effortLabel = compactReasoningLabel(effort)
  const model = point.representative.model_variant.display_name
  if (model.length <= 15) return { firstLine: model, secondModel: "", effort, effortLabel }

  const middle = model.length / 2
  const breaks = Array.from(model.matchAll(/-/g), (match) => match.index)
  const split = breaks.toSorted((a, b) => Math.abs(a - middle) - Math.abs(b - middle))[0] ?? Math.round(middle)
  return {
    firstLine: model.slice(0, split),
    secondModel: model.slice(split + (model[split] === "-" ? 1 : 0)),
    effort,
    effortLabel,
  }
}

function pointLabelLines(point: ChartPoint): string[] {
  const label = pointLabelParts(point)
  if (isHumanPoint(point)) return [label.firstLine]
  return [label.firstLine, label.secondModel ? `${label.secondModel} · ${label.effortLabel}` : label.effortLabel]
}

function logTicks(min: number, max: number) {
  const values: number[] = []
  const start = Math.floor(Math.log10(min))
  const end = Math.ceil(Math.log10(max))
  for (let power = start; power <= end; power += 1) {
    for (const multiplier of [1, 2, 5]) {
      const value = multiplier * 10 ** power
      if (value >= min && value <= max) values.push(value)
    }
  }
  if (values.length <= 7) return values
  const stride = Math.ceil(values.length / 7)
  return values.filter((_, index) => index % stride === 0 || index === values.length - 1)
}

function transformCost(value: number, scale: CostScale) {
  if (scale === "log") return Math.log10(value)
  if (scale === "fourth") return value ** 0.25
  if (scale === "sqrt") return Math.sqrt(value)
  return value
}

function inverseCost(value: number, scale: CostScale) {
  if (scale === "log") return 10 ** value
  if (scale === "fourth") return value ** 4
  if (scale === "sqrt") return value ** 2
  return value
}

function costTicks(min: number, max: number, scale: CostScale) {
  if (scale === "log") return logTicks(10 ** min, 10 ** max)
  const rough = (max - min) / 6
  const power = 10 ** Math.floor(Math.log10(Math.max(rough, Number.EPSILON)))
  const normalized = rough / power
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * power
  const values: number[] = []
  for (let value = Math.ceil(min / step) * step; value <= max + Number.EPSILON; value += step) {
    values.push(inverseCost(value, scale))
  }
  return values
}

function niceStep(range: number) {
  const rough = range / 5
  const power = 10 ** Math.floor(Math.log10(Math.max(rough, 1)))
  const normalized = rough / power
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return multiplier * power
}

function runPath(point: ChartPoint) {
  if (isHumanPoint(point)) return `/human/${encodeURIComponent(point.runId)}`
  return `/model/${encodeURIComponent(point.representative.model_variant.key)}?run=${encodeURIComponent(point.representative.run_id)}`
}

function RunPickerSheet({ point, metric, onOpenChange }: { point: ChartPoint | null; metric: EfficiencyMetric; onOpenChange: (open: boolean) => void }) {
  const title = point && isHumanPoint(point) ? HUMAN_LABEL : point?.representative.model_variant.display_name ?? "Choose a run"
  return <Sheet open={point != null} onOpenChange={onOpenChange}>
    <SheetContent className="w-[min(92vw,440px)] overflow-y-auto">
      <SheetTitle className="pr-8 text-lg font-semibold">Choose a run</SheetTitle>
      <SheetDescription className="mt-1 text-sm leading-relaxed text-muted-foreground">
        {title} has {point?.runCount ?? 0} settled run{point?.runCount === 1 ? "" : "s"} in this chart point. Choose the exact run you want to inspect.
      </SheetDescription>
      <div className="mt-5 space-y-2">
        {point && isHumanPoint(point) ? point.profiles.map((profile) => <SheetClose asChild key={profile.run_id}>
          <a href={`#${runPath({ ...point, runId: profile.run_id })}`} target="_blank" rel="noopener noreferrer" className="flex items-start justify-between gap-3 rounded-xl border p-3 transition-colors hover:border-fuchsia-500/40 hover:bg-fuchsia-500/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="min-w-0"><span className="block font-medium">Seed {profile.session.selector?.seed ?? "—"}</span><span className="mt-1 block text-xs text-muted-foreground">{profile.solved}/{profile.attempts} solved · rating {Math.round(profile.rating).toLocaleString()} · RD {profile.rating_deviation.toFixed(2)}</span><span className="mt-1 block font-mono text-[10px] text-muted-foreground">{profile.run_id}</span></span>
            <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          </a>
        </SheetClose>) : point?.runs.map((run) => {
          const estimate = run.summary.puzzle_performance_rating
          const runTokensPerMove = (run.summary.model_moves ?? 0) > 0 ? (run.usage?.completion_tokens ?? 0) / run.summary.model_moves : null
          return <SheetClose asChild key={run.run_id}>
            <a href={`#${runPath({ ...point, representative: run })}`} target="_blank" rel="noopener noreferrer" className="flex items-start justify-between gap-3 rounded-xl border p-3 transition-colors hover:border-sky-500/40 hover:bg-sky-500/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="min-w-0"><span className="block font-medium">Seed {run.protocol.selection.seed} · {reasoningLabel(run.model_variant)}</span><span className="mt-1 block text-xs text-muted-foreground">{run.summary.solved}/{run.progress.completed} solved · rating {estimate ? Math.round(estimate.rating).toLocaleString() : "—"} · RD {estimate?.rating_deviation?.toFixed(2) ?? "—"} · {metric === "cost" ? formatCost(run.summary.cost_usd ?? 0) : runTokensPerMove == null ? "token use unavailable" : `${formatTokens(runTokensPerMove)} tokens/move`}</span><span className="mt-1 block font-mono text-[10px] text-muted-foreground">{run.run_id}</span></span>
              <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            </a>
          </SheetClose>
        })}
      </div>
      {point && !isHumanPoint(point) ? <p className="mt-4 rounded-lg border border-dashed p-3 text-xs leading-relaxed text-muted-foreground">The run page also includes a reasoning-configuration selector for moving between this model’s other reasoning levels.</p> : null}
    </SheetContent>
  </Sheet>
}

interface ModelVisibilityGroup {
  key: string
  label: string
  color: string
  efforts: Array<{ effort: string; pointCount: number }>
}

interface PlottedPoint {
  point: ChartPoint
  x: number
  y: number
  errorTop: number
  errorBottom: number
  color: string
  labelX: number
  labelY: number
  labelLayout: LabelLayout
}

type LabelLayout = "stacked" | "inline"
interface LabelBox { left: number; right: number; top: number; bottom: number }
interface Segment { x1: number; y1: number; x2: number; y2: number }
interface LabelCandidate { x: number; y: number; layout: LabelLayout }
interface LabelPlacement extends LabelCandidate { box: LabelBox; leader: Segment | null; score: number }

const LEADER_LINE_PENALTY = 240

function boxesOverlap(a: LabelBox, b: LabelBox) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

function pointInBox(x: number, y: number, box: LabelBox) {
  return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
}

function segmentsIntersect(a: Segment, b: Segment) {
  const denominator = (a.x1 - a.x2) * (b.y1 - b.y2) - (a.y1 - a.y2) * (b.x1 - b.x2)
  if (Math.abs(denominator) < 0.001) return false
  const first = ((a.x1 - b.x1) * (b.y1 - b.y2) - (a.y1 - b.y1) * (b.x1 - b.x2)) / denominator
  const second = -((a.x1 - a.x2) * (a.y1 - b.y1) - (a.y1 - a.y2) * (a.x1 - b.x1)) / denominator
  return first > 0.001 && first < 0.999 && second > 0.001 && second < 0.999
}

function segmentIntersectsBox(segment: Segment, box: LabelBox) {
  if (pointInBox(segment.x1, segment.y1, box) || pointInBox(segment.x2, segment.y2, box)) return true
  const edges: Segment[] = [
    { x1: box.left, y1: box.top, x2: box.right, y2: box.top },
    { x1: box.right, y1: box.top, x2: box.right, y2: box.bottom },
    { x1: box.right, y1: box.bottom, x2: box.left, y2: box.bottom },
    { x1: box.left, y1: box.bottom, x2: box.left, y2: box.top },
  ]
  return edges.some((edge) => segmentsIntersect(segment, edge))
}

function labelLeader(entry: PlottedPoint, x: number, y: number, layout: LabelLayout): Segment {
  const box = labelBox(labelWidth(entry, layout), x, y, layout)
  const edgeX = Math.max(box.left, Math.min(box.right, entry.x))
  const edgeY = Math.max(box.top, Math.min(box.bottom, entry.y))
  const towardCenterX = x - edgeX
  const towardCenterY = (y + 1.5) - edgeY
  const centerDistance = Math.hypot(towardCenterX, towardCenterY)
  const inset = centerDistance * 0.72
  return {
    x1: entry.x,
    y1: entry.y,
    x2: edgeX + (centerDistance ? towardCenterX / centerDistance * inset : 0),
    y2: edgeY + (centerDistance ? towardCenterY / centerDistance * inset : 0),
  }
}

function labelNeedsLeader(entry: PlottedPoint, x: number, y: number, layout: LabelLayout) {
  const box = labelBox(labelWidth(entry, layout), x, y, layout)
  const occupiedLeft = entry.x - 7
  const occupiedRight = entry.x + 7
  const occupiedTop = Math.min(entry.errorTop, entry.y - 7)
  const occupiedBottom = Math.max(entry.errorBottom, entry.y + 7)
  const verticalGap = box.bottom <= occupiedTop ? occupiedTop - box.bottom :
    box.top >= occupiedBottom ? box.top - occupiedBottom :
    Number.POSITIVE_INFINITY
  const horizontalGap = box.right <= occupiedLeft ? occupiedLeft - box.right :
    box.left >= occupiedRight ? box.left - occupiedRight :
    Number.POSITIVE_INFINITY
  const directlyAboveOrBelow = box.left <= entry.x && box.right >= entry.x && verticalGap <= 2
  const directlyBeside = box.top <= entry.y && box.bottom >= entry.y && horizontalGap <= 2
  return !directlyAboveOrBelow && !directlyBeside
}

function pointDensity(entry: PlottedPoint, entries: PlottedPoint[]) {
  return entries.reduce((density, other) => {
    if (other.point.key === entry.point.key) return density
    const distance = Math.hypot(other.x - entry.x, other.y - entry.y)
    return density + Math.max(0, 180 - distance) / 180
  }, 0)
}

function labelWidth(entry: PlottedPoint, layout: LabelLayout = "stacked") {
  const lines = layout === "inline" && !isHumanPoint(entry.point)
    ? [`${entry.point.representative.model_variant.display_name} · ${compactReasoningLabel(modelPointReasoningEffort(entry.point))}`]
    : pointLabelLines(entry.point)
  return Math.max(58, Math.max(...lines.map((line) => line.length)) * 4.2 + 6)
}

function labelBox(width: number, x: number, y: number, layout: LabelLayout = "stacked"): LabelBox {
  return layout === "inline"
    ? { left: x - width / 2, right: x + width / 2, top: y - 8, bottom: y + 8 }
    : { left: x - width / 2, right: x + width / 2, top: y - 10, bottom: y + 15 }
}

function directLabelCandidates(entry: PlottedPoint) {
  const occupiedTop = Math.min(entry.errorTop, entry.y - 7)
  const occupiedBottom = Math.max(entry.errorBottom, entry.y + 7)
  const candidates: LabelCandidate[] = []
  const stackedWidth = labelWidth(entry)
  const maximumShift = Math.max(0, stackedWidth / 2 - 4)
  for (const horizontalShift of [0, -12, 12, -24, 24]) {
    if (Math.abs(horizontalShift) > maximumShift) continue
    candidates.push({ x: entry.x + horizontalShift, y: occupiedTop - 16, layout: "stacked" })
    candidates.push({ x: entry.x + horizontalShift, y: occupiedBottom + 12, layout: "stacked" })
  }
  // Inline side labels trade horizontal room for a shorter label and sit flush
  // against the marker's seven-pixel collision box.
  const sideDistance = labelWidth(entry, "inline") / 2 + 7
  for (const verticalShift of [0, -6, 6]) {
    const y = entry.y + verticalShift
    candidates.push({ x: entry.x - sideDistance, y, layout: "inline" })
    candidates.push({ x: entry.x + sideDistance, y, layout: "inline" })
  }
  return candidates
}

function displacedLabelCandidates(entry: PlottedPoint, width: number) {
  const candidates: LabelCandidate[] = []
  const horizontalOffsets = [0]
  const maxHorizontalOffset = Math.max(180, width * 1.65)
  for (let offset = 12; offset <= maxHorizontalOffset; offset += 12) {
    horizontalOffsets.push(-offset, offset)
  }
  for (let level = 0; level < 8; level += 1) {
    const verticalOffset = level * 18
    for (const offset of horizontalOffsets) {
      candidates.push({ x: entry.x + offset, y: entry.errorTop - 22 - verticalOffset, layout: "stacked" })
      candidates.push({ x: entry.x + offset, y: entry.errorBottom + 18 + verticalOffset, layout: "stacked" })
    }
  }
  const centeredY = entry.y - 2
  const verticalOffsets = [0, -12, 12, -24, 24, -36, 36, -48, 48]
  for (let level = 0; level < 8; level += 1) {
    const sideDistance = width / 2 + 18 + level * 12
    for (const verticalOffset of verticalOffsets) {
      candidates.push({ x: entry.x - sideDistance, y: centeredY + verticalOffset, layout: "stacked" })
      candidates.push({ x: entry.x + sideDistance, y: centeredY + verticalOffset, layout: "stacked" })
    }
  }
  return candidates
}

function scanLabelCandidates(entry: PlottedPoint, width: number) {
  const candidates: LabelCandidate[] = []
  const stepX = Math.max(width + 4, 64)
  for (let y = 18; y <= HEIGHT - PLOT.bottom - 18; y += 22) {
    for (let x = PLOT.left + width / 2; x <= WIDTH - PLOT.right - width / 2; x += stepX) {
      candidates.push({ x, y, layout: "stacked" })
    }
  }
  return candidates.toSorted((a, b) =>
    Math.hypot(a.x - entry.x, a.y - entry.y) - Math.hypot(b.x - entry.x, b.y - entry.y),
  )
}

function placeLabels(entries: PlottedPoint[], minimumLineY: number) {
  const markers = entries.map((entry) => ({
    key: entry.point.key,
    box: { left: entry.x - 7, right: entry.x + 7, top: entry.y - 7, bottom: entry.y + 7 },
  }))
  const whiskers = entries.map((entry) => ({
    key: entry.point.key,
    box: { left: entry.x - 5, right: entry.x + 5, top: entry.errorTop - 1, bottom: entry.errorBottom + 1 },
  }))
  const ordered = entries.toSorted((a, b) => pointDensity(b, entries) - pointDensity(a, entries) || a.y - b.y || a.x - b.x)

  function bestPlacement(
    entry: PlottedPoint,
    candidates: LabelCandidate[],
    placements: Map<string, LabelPlacement>,
    allowLeader: boolean,
  ) {
    let best: LabelPlacement | null = null
    const otherMarkers = markers.filter((marker) => marker.key !== entry.point.key)
    const otherWhiskers = whiskers.filter((whisker) => whisker.key !== entry.point.key)
    const otherPlacements = [...placements.entries()].filter(([key]) => key !== entry.point.key).map(([, value]) => value)
    for (const candidate of candidates) {
      const width = labelWidth(entry, candidate.layout)
      const x = Math.max(PLOT.left + width / 2, Math.min(WIDTH - PLOT.right - width / 2, candidate.x))
      const box = labelBox(width, x, candidate.y, candidate.layout)
      if (box.top < 8 || box.bottom > HEIGHT - PLOT.bottom - 4) continue
      const blocked =
        otherPlacements.some((other) => boxesOverlap(box, other.box)) ||
        markers.some((marker) => boxesOverlap(box, marker.box)) ||
        whiskers.some((whisker) => boxesOverlap(box, whisker.box))
      if (blocked) continue
      const needsLeader = labelNeedsLeader(entry, x, candidate.y, candidate.layout)
      if (needsLeader && !allowLeader) continue
      const leader = needsLeader ? labelLeader(entry, x, candidate.y, candidate.layout) : null
      const obstructionCollisions = leader ?
        otherPlacements.filter((other) => segmentIntersectsBox(leader, other.box)).length +
        otherMarkers.filter((marker) => segmentIntersectsBox(leader, marker.box)).length +
        otherWhiskers.filter((whisker) => segmentIntersectsBox(leader, whisker.box)).length +
        otherPlacements.filter((other) => other.leader && segmentIntersectsBox(other.leader, box)).length :
        0
      const connectorCrossings = leader ? otherPlacements.filter((other) => other.leader && segmentsIntersect(leader, other.leader)).length : 0
      const straddlesMinimumLine = box.top <= minimumLineY + 2 && box.bottom >= minimumLineY - 2
      const score =
        obstructionCollisions * 240 +
        connectorCrossings * 90 +
        (straddlesMinimumLine ? 80 : 0) +
        (leader ? LEADER_LINE_PENALTY + Math.hypot(leader.x2 - leader.x1, leader.y2 - leader.y1) : Math.hypot(x - entry.x, candidate.y - entry.y))
      if (!best || score < best.score) best = { x, y: candidate.y, layout: candidate.layout, box, leader, score }
    }
    return best
  }

  // First maximize labels that can sit directly above, below, or beside their
  // marker. Small horizontal shifts let top/bottom labels share dense bands
  // without immediately falling back to leader lines.
  // Several deterministic greedy orders avoid letting one arbitrary traversal
  // decide which labels receive the limited connector-free slots.
  const directOrders = [
    ordered,
    ordered.toReversed(),
    entries.toSorted((a, b) => a.x - b.x || a.y - b.y),
    entries.toSorted((a, b) => a.y - b.y || a.x - b.x),
  ]
  const directLayouts = directOrders.map((order) => {
    const attempt = new Map<string, LabelPlacement>()
    for (const entry of order) {
      const placement = bestPlacement(entry, directLabelCandidates(entry), attempt, false)
      if (placement) attempt.set(entry.point.key, placement)
    }
    return attempt
  })
  const placements = directLayouts.toSorted((a, b) => {
    if (a.size !== b.size) return b.size - a.size
    const scoreA = [...a.values()].reduce((sum, placement) => sum + placement.score, 0)
    const scoreB = [...b.values()].reduce((sum, placement) => sum + placement.score, 0)
    return scoreA - scoreB
  })[0] ?? new Map<string, LabelPlacement>()

  // Only labels that did not fit around their marker enter the displaced/leader-line pass.
  for (const entry of ordered) {
    if (placements.has(entry.point.key)) continue
    const width = labelWidth(entry)
    const local = bestPlacement(entry, displacedLabelCandidates(entry, width), placements, true)
    const placement = local ?? bestPlacement(entry, scanLabelCandidates(entry, width), placements, true)
    if (placement) placements.set(entry.point.key, placement)
  }

  // Revisit only displaced labels. Connector-free labels remain locked, while a
  // displaced label may still graduate to a newly available direct position.
  for (let pass = 0; pass < 8; pass += 1) {
    let changed = false
    const displacedEntries = ordered.filter((entry) => placements.get(entry.point.key)?.leader)
    const passEntries = pass % 2 === 0 ? displacedEntries : displacedEntries.toReversed()
    for (const entry of passEntries) {
      const current = placements.get(entry.point.key)
      if (!current) continue
      placements.delete(entry.point.key)
      const candidates = [
        { x: current.x, y: current.y, layout: current.layout },
        ...directLabelCandidates(entry),
        ...displacedLabelCandidates(entry, labelWidth(entry)),
        ...scanLabelCandidates(entry, labelWidth(entry)),
      ]
      const next = bestPlacement(entry, candidates, placements, true)
      if (next) {
        placements.set(entry.point.key, next)
        changed ||= next.x !== current.x || next.y !== current.y
      } else {
        placements.set(entry.point.key, current)
      }
    }
    if (!changed) break
  }

  return entries.map((entry) => {
    const position = placements.get(entry.point.key) ?? { x: entry.x, y: entry.errorTop - 10, layout: "stacked" as const }
    return { ...entry, labelX: position.x, labelY: position.y, labelLayout: position.layout }
  })
}

const StaticPlot = memo(function StaticPlot({ plotted, xTicks, yTicks, x, y, showLabels, metric }: {
  plotted: PlottedPoint[]
  xTicks: number[]
  yTicks: number[]
  x: (value: number) => number
  y: (value: number) => number
  showLabels: boolean
  metric: EfficiencyMetric
}) {
  return <>
    {xTicks.map((value) => <g key={`x-${value}`}>
      <line x1={x(value)} y1={PLOT.top} x2={x(value)} y2={HEIGHT - PLOT.bottom} className="stroke-muted-foreground/65" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />
      <text x={x(value)} y={HEIGHT - 30} textAnchor="middle" className="fill-muted-foreground font-mono text-[11px]">{metric === "cost" ? formatCost(value) : formatTokens(value, true)}</text>
    </g>)}
    {yTicks.map((value) => <g key={`y-${value}`}>
      <line x1={PLOT.left} y1={y(value)} x2={WIDTH - PLOT.right} y2={y(value)} className="stroke-muted-foreground/65" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />
      <text x={PLOT.left - 12} y={y(value) + 4} textAnchor="end" className="fill-muted-foreground font-mono text-[11px]">{value.toLocaleString()}</text>
    </g>)}
    <g>
      <line x1={PLOT.left} y1={y(MINIMUM_RATING)} x2={WIDTH - PLOT.right} y2={y(MINIMUM_RATING)} className="stroke-rose-500" strokeWidth="1.25" opacity="0.9" strokeDasharray="2 5" vectorEffect="non-scaling-stroke" />
      <text x={WIDTH - PLOT.right - 6} y={y(MINIMUM_RATING) + 14} textAnchor="end" className="fill-rose-600 text-[9px] font-semibold dark:fill-rose-400" style={{ paintOrder: "stroke", stroke: "var(--card)", strokeWidth: 4 }}>minimum rating (400)</text>
    </g>
    {plotted.map((entry) => <g key={`mark-${entry.point.key}`}>
      <line x1={entry.x} y1={entry.errorTop} x2={entry.x} y2={entry.errorBottom} stroke={entry.color} strokeWidth="1.5" opacity="0.6" vectorEffect="non-scaling-stroke" />
      <line x1={entry.x - 4} y1={entry.errorTop} x2={entry.x + 4} y2={entry.errorTop} stroke={entry.color} strokeWidth="1.5" opacity="0.6" vectorEffect="non-scaling-stroke" />
      <line x1={entry.x - 4} y1={entry.errorBottom} x2={entry.x + 4} y2={entry.errorBottom} stroke={entry.color} strokeWidth="1.5" opacity="0.6" vectorEffect="non-scaling-stroke" />
      <circle cx={entry.x} cy={entry.y} r="4.75" fill={entry.color} className="stroke-background" strokeWidth="1.75" vectorEffect="non-scaling-stroke" />
    </g>)}
    {showLabels ? plotted.map((entry) => {
      const box = labelBox(labelWidth(entry, entry.labelLayout), entry.labelX, entry.labelY, entry.labelLayout)
      const minimumLineY = y(MINIMUM_RATING)
      if (box.top > minimumLineY + 2 || box.bottom < minimumLineY - 2) return null
      return <rect
        key={`threshold-backing-${entry.point.key}`}
        x={box.left}
        y={box.top}
        width={box.right - box.left}
        height={box.bottom - box.top}
        rx="3"
        fill="var(--card)"
        opacity="0.96"
        style={{ filter: "drop-shadow(0 1px 2px rgb(0 0 0 / 0.16))" }}
      />
    }) : null}
    {showLabels ? plotted.map((entry) => {
      if (!labelNeedsLeader(entry, entry.labelX, entry.labelY, entry.labelLayout)) return null
      const leader = labelLeader(entry, entry.labelX, entry.labelY, entry.labelLayout)
      return <line
        key={`leader-${entry.point.key}`}
        x1={leader.x1}
        y1={leader.y1}
        x2={leader.x2}
        y2={leader.y2}
        stroke={entry.color}
        strokeWidth="1.1"
        strokeLinecap="round"
        opacity="0.4"
        vectorEffect="non-scaling-stroke"
      />
    }) : null}
    {showLabels ? plotted.map((entry) => {
      const label = pointLabelParts(entry.point)
      if (isHumanPoint(entry.point)) return <text
        key={`label-${entry.point.key}`}
        x={entry.labelX}
        y={entry.labelY + 5}
        textAnchor="middle"
        className="fill-fuchsia-600 text-[8.5px] font-semibold dark:fill-fuchsia-300"
        style={{ paintOrder: "stroke", stroke: "var(--card)", strokeWidth: 4, strokeLinecap: "round", strokeLinejoin: "round" }}
      >{HUMAN_LABEL}</text>
      if (entry.labelLayout === "inline") return <text
        key={`label-${entry.point.key}`}
        x={entry.labelX}
        y={entry.labelY + 3}
        textAnchor="middle"
        className="fill-foreground text-[8.5px] font-semibold"
        style={{ paintOrder: "stroke", stroke: "var(--card)", strokeWidth: 4, strokeLinecap: "round", strokeLinejoin: "round" }}
      >
        {entry.point.representative.model_variant.display_name} · <tspan className={REASONING_TEXT_CLASSES[label.effort] ?? REASONING_TEXT_CLASSES.provider}>{label.effortLabel}</tspan>
      </text>
      return <text
        key={`label-${entry.point.key}`}
        x={entry.labelX}
        y={entry.labelY}
        textAnchor="middle"
        className="fill-foreground text-[8.5px] font-semibold"
        style={{ paintOrder: "stroke", stroke: "var(--card)", strokeWidth: 4, strokeLinecap: "round", strokeLinejoin: "round" }}
      >
        <tspan x={entry.labelX}>{label.firstLine}</tspan>
        <tspan x={entry.labelX} dy="10">
          {label.secondModel ? `${label.secondModel} · ` : ""}
          <tspan className={REASONING_TEXT_CLASSES[label.effort] ?? REASONING_TEXT_CLASSES.provider}>{label.effortLabel}</tspan>
        </tspan>
      </text>
    }) : null}
  </>
})

function Inspector({ entry, metric }: { entry: PlottedPoint; metric: EfficiencyMetric }) {
  if (isHumanPoint(entry.point)) return <div className="w-64 rounded-xl border bg-popover/96 p-3 text-popover-foreground shadow-2xl backdrop-blur">
    <div className="flex items-start gap-2">
      <span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} />
      <div><div className="text-sm font-semibold">{HUMAN_LABEL}</div><div className="mt-0.5 text-[10px] text-muted-foreground">{entry.point.runCount} saved runs · human solve time valued at ${HUMAN_HOURLY_RATE}/hour</div></div>
    </div>
    <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs">
      <dt className="text-muted-foreground">Glicko-2 rating</dt><dd className="font-mono font-semibold tabular-nums">{Math.round(entry.point.rating).toLocaleString()}</dd>
      <dt className="text-muted-foreground">Mean RD</dt><dd className="font-mono tabular-nums">±{Math.round(entry.point.ratingDeviation)}</dd>
      <dt className="text-muted-foreground">Labor cost / 50</dt><dd className="font-mono font-semibold tabular-nums">{formatCost(entry.point.costPerPuzzle * NORMALIZED_PUZZLES)}</dd>
      <dt className="text-muted-foreground">Record</dt><dd className="font-mono tabular-nums">{entry.point.solved}–{entry.point.attempts - entry.point.solved}</dd>
      <dt className="text-muted-foreground">Attempts</dt><dd className="font-mono tabular-nums">{entry.point.attempts}</dd>
    </dl>
    <div className="mt-2 border-t pt-2 text-[10px] text-muted-foreground">Click to choose a saved human run.</div>
  </div>
  const effort = reasoningEffortLabel(modelPointReasoningEffort(entry.point))
  return <div className="w-64 rounded-xl border bg-popover/96 p-3 text-popover-foreground shadow-2xl backdrop-blur">
    <div className="flex items-start gap-2">
      <span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} />
      <div className="min-w-0"><div className="truncate text-sm font-semibold">{entry.point.representative.model_variant.display_name}</div><div className="mt-0.5 text-[10px] text-muted-foreground">{effort} reasoning · {entry.point.runCount} settled run{entry.point.runCount === 1 ? "" : "s"}</div></div>
    </div>
    <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs">
      <dt className="text-muted-foreground">Glicko-2 rating</dt><dd className="font-mono font-semibold tabular-nums">{Math.round(entry.point.rating).toLocaleString()}</dd>
      <dt className="text-muted-foreground">Mean RD</dt><dd className="font-mono tabular-nums">±{Math.round(entry.point.ratingDeviation)}</dd>
      {metric === "tokens" ? <>
        <dt className="text-muted-foreground">Avg. tokens / move</dt><dd className="font-mono font-semibold tabular-nums">{entry.point.tokensPerMove == null ? "—" : formatTokens(entry.point.tokensPerMove)}</dd>
        <dt className="text-muted-foreground">Generated tokens</dt><dd className="font-mono tabular-nums">{entry.point.completionTokens.toLocaleString()}</dd>
        <dt className="text-muted-foreground">Model moves</dt><dd className="font-mono tabular-nums">{entry.point.modelMoves.toLocaleString()}</dd>
        <dt className="text-muted-foreground">Reasoning share</dt><dd className="font-mono tabular-nums">{entry.point.completionTokens > 0 ? `${(entry.point.reasoningTokens / entry.point.completionTokens * 100).toFixed(1)}%` : "—"}</dd>
      </> : <>
        <dt className="text-muted-foreground">Avg. cost / 50</dt><dd className="font-mono font-semibold tabular-nums">{formatCost(entry.point.costPerPuzzle * NORMALIZED_PUZZLES)}</dd>
        <dt className="text-muted-foreground">Cost / puzzle</dt><dd className="font-mono font-semibold tabular-nums">{formatCost(entry.point.costPerPuzzle)}</dd>
        <dt className="text-muted-foreground">Total cost</dt><dd className="font-mono tabular-nums">{formatCost(entry.point.totalCost)}</dd>
      </>}
      <dt className="text-muted-foreground">Record</dt><dd className="font-mono tabular-nums">{entry.point.solved}–{entry.point.attempts - entry.point.solved}</dd>
      <dt className="text-muted-foreground">Attempts</dt><dd className="font-mono tabular-nums">{entry.point.attempts.toLocaleString()}</dd>
    </dl>
    <div className="mt-2 border-t pt-2 text-[10px] text-muted-foreground">Click to choose a contributing settled run.</div>
  </div>
}

export function CostPerformanceChart({ aggregates }: { aggregates: RatedRunAggregate[] }) {
  const { apiBase } = useData()
  const plotContainerRef = useRef<HTMLDivElement>(null)
  const [initialState] = useState(savedChartState)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [selectedPoint, setSelectedPoint] = useState<ChartPoint | null>(null)
  const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number } | null>(null)
  const [humanProfiles, setHumanProfiles] = useState<HumanTrainingProfile[]>([])
  const [metric, setMetric] = useState<EfficiencyMetric>(initialState.metric)
  const [costScale, setCostScale] = useState<CostScale>(initialState.costScale)
  const [ratingRange, setRatingRange] = useState<[number | null, number | null]>(() => [initialState.ratingMin, initialState.ratingMax])
  const [modelSearch, setModelSearch] = useState(initialState.modelSearch)
  const [reasoningFilters, setReasoningFilters] = useState<Set<string>>(() => new Set(initialState.reasoningFilters))
  const [hiddenModelKeys, setHiddenModelKeys] = useState<Set<string>>(() => new Set(initialState.hiddenModelKeys))
  const [hiddenModelReasoningKeys, setHiddenModelReasoningKeys] = useState<Set<string>>(() => new Set(initialState.hiddenModelReasoningKeys))
  const [showHuman, setShowHuman] = useState(initialState.showHuman)
  const [showLabels, setShowLabels] = useState(initialState.showLabels)
  const [showLegend, setShowLegend] = useState(initialState.showLegend)

  useEffect(() => {
    try {
      localStorage.setItem(CHART_STATE_STORAGE_KEY, JSON.stringify({
        metric,
        costScale,
        ratingMin: ratingRange[0],
        ratingMax: ratingRange[1],
        modelSearch,
        reasoningFilters: Array.from(reasoningFilters),
        hiddenModelKeys: Array.from(hiddenModelKeys),
        hiddenModelReasoningKeys: Array.from(hiddenModelReasoningKeys),
        showHuman,
        showLabels,
        showLegend,
      } satisfies SavedChartState))
    } catch {
      // Private browsing or storage policy can make persistence unavailable.
    }
  }, [costScale, hiddenModelKeys, hiddenModelReasoningKeys, metric, modelSearch, ratingRange, reasoningFilters, showHuman, showLabels, showLegend])

  useEffect(() => {
    let active = true
    if (!apiBase) return () => { active = false }
    void Promise.all(HUMAN_RUN_IDS.map((runId) => fetchHumanTrainingProfileByRun(apiBase, runId)))
      .then((profiles) => { if (active) setHumanProfiles(profiles.filter((profile): profile is HumanTrainingProfile => profile != null)) })
      .catch(() => { if (active) setHumanProfiles([]) })
    return () => { active = false }
  }, [apiBase])

  const allModelPoints = useMemo(() => costPerformancePoints(aggregates), [aggregates])
  const allMetricModelPoints = useMemo(
    () => metric === "tokens" ? allModelPoints.filter((point) => point.tokensPerMove != null && point.tokensPerMove > 0) : allModelPoints,
    [allModelPoints, metric],
  )
  const allModelKeys = useMemo(
    () => Array.from(new Set(allModelPoints.map((point) => point.representative.model_variant.base_key))).toSorted(),
    [allModelPoints],
  )
  const colorByModel = useMemo(
    () => new Map(allModelKeys.map((key, index) => [key, MODEL_COLOR_BY_KEY[key] ?? MODEL_COLORS[index % MODEL_COLORS.length]])),
    [allModelKeys],
  )
  const modelVisibilityGroups = useMemo(() => {
    const groups = new Map<string, { label: string; efforts: Map<string, number> }>()
    for (const point of allMetricModelPoints) {
      const variant = point.representative.model_variant
      const effort = modelPointReasoningEffort(point)
      const group = groups.get(variant.base_key) ?? { label: variant.display_name, efforts: new Map<string, number>() }
      group.efforts.set(effort, (group.efforts.get(effort) ?? 0) + 1)
      groups.set(variant.base_key, group)
    }
    return Array.from(groups, ([key, group]): ModelVisibilityGroup => ({
      key,
      label: group.label,
      color: colorByModel.get(key) ?? MODEL_COLORS[0],
      efforts: Array.from(group.efforts, ([effort, pointCount]) => ({ effort, pointCount })).toSorted((a, b) => {
        const aIndex = REASONING_ORDER.indexOf(a.effort)
        const bIndex = REASONING_ORDER.indexOf(b.effort)
        return (aIndex < 0 ? REASONING_ORDER.length : aIndex) - (bIndex < 0 ? REASONING_ORDER.length : bIndex)
      }),
    })).toSorted((a, b) => a.label.localeCompare(b.label))
  }, [allMetricModelPoints, colorByModel])
  const modelVisibilityByKey = useMemo(() => new Map(modelVisibilityGroups.map((group) => [group.key, group])), [modelVisibilityGroups])
  const reasoningOptions = useMemo(() => {
    return Array.from(new Set(allMetricModelPoints.map(modelPointReasoningEffort))).toSorted((a, b) => {
      const aIndex = REASONING_ORDER.indexOf(a)
      const bIndex = REASONING_ORDER.indexOf(b)
      return (aIndex < 0 ? REASONING_ORDER.length : aIndex) - (bIndex < 0 ? REASONING_ORDER.length : bIndex)
    })
  }, [allMetricModelPoints])
  const filteredModelPoints = useMemo(() => {
    const query = modelSearch.trim().toLowerCase()
    return allMetricModelPoints.filter((point) => {
      const variant = point.representative.model_variant
      const matchesName = !query || [variant.display_name, variant.model_id, variant.base_key]
        .some((value) => value.toLowerCase().includes(query))
      const matchesReasoning = reasoningFilters.size === 0 || reasoningFilters.has(modelPointReasoningEffort(point))
      return matchesName && matchesReasoning
    })
  }, [allMetricModelPoints, modelSearch, reasoningFilters])
  const availableModelLegend = useMemo(() => {
    const entries = new Map<string, { key: string; label: string; color: string; efforts: Set<string> }>()
    for (const point of filteredModelPoints) {
      const variant = point.representative.model_variant
      const entry = entries.get(variant.base_key) ?? { key: variant.base_key, label: variant.display_name, color: colorByModel.get(variant.base_key) ?? MODEL_COLORS[0], efforts: new Set<string>() }
      entry.efforts.add(modelPointReasoningEffort(point))
      entries.set(variant.base_key, entry)
    }
    return Array.from(entries.values())
  }, [colorByModel, filteredModelPoints])
  const visibleModelPoints = useMemo(
    () => filteredModelPoints.filter((point) => {
      const modelKey = point.representative.model_variant.base_key
      return !hiddenModelKeys.has(modelKey) && !hiddenModelReasoningKeys.has(modelReasoningVisibilityKey(modelKey, modelPointReasoningEffort(point)))
    }),
    [filteredModelPoints, hiddenModelKeys, hiddenModelReasoningKeys],
  )
  const hiddenConfigurationCount = useMemo(() => allMetricModelPoints.filter((point) => {
    const modelKey = point.representative.model_variant.base_key
    return hiddenModelKeys.has(modelKey) || hiddenModelReasoningKeys.has(modelReasoningVisibilityKey(modelKey, modelPointReasoningEffort(point)))
  }).length, [allMetricModelPoints, hiddenModelKeys, hiddenModelReasoningKeys])

  const humanPoint = useMemo((): HumanCostPerformancePoint | null => {
    const profiles = humanProfiles.filter((profile) => profile.attempts > 0 && (profile.session.active_duration_ms ?? 0) > 0)
    const attempts = profiles.reduce((total, profile) => total + profile.attempts, 0)
    const activeDurationMs = profiles.reduce((total, profile) => total + (profile.session.active_duration_ms ?? 0), 0)
    return profiles.length > 0 && attempts > 0 && activeDurationMs > 0
      ? {
        kind: "human",
        key: `human:${profiles.map((profile) => profile.run_id).join("+")}`,
        runId: profiles[0].run_id,
        rating: profiles.reduce((total, profile) => total + profile.rating, 0) / profiles.length,
        ratingDeviation: profiles.reduce((total, profile) => total + profile.rating_deviation, 0) / profiles.length,
        totalCost: activeDurationMs / 3_600_000 * HUMAN_HOURLY_RATE,
        costPerPuzzle: activeDurationMs / 3_600_000 * HUMAN_HOURLY_RATE / attempts,
        attempts,
        solved: profiles.reduce((total, profile) => total + profile.solved, 0),
        runCount: profiles.length,
        profiles,
      }
      : null
  }, [humanProfiles])

  const ratingBounds = useMemo(() => {
    const ratings = metric === "cost" && humanPoint ? [...allMetricModelPoints.map((point) => point.rating), humanPoint.rating] : allMetricModelPoints.map((point) => point.rating)
    if (ratings.length === 0) return { min: MINIMUM_RATING, max: MINIMUM_RATING + 100 }
    const rawMin = Math.min(...ratings)
    const rawMax = Math.max(...ratings)
    return {
      min: Math.floor(rawMin / 100) * 100,
      max: Math.ceil(rawMax / 100) * 100,
    }
  }, [allMetricModelPoints, humanPoint, metric])
  const effectiveRatingRange = useMemo((): [number, number] => {
    const min = Math.max(ratingBounds.min, Math.min(ratingRange[0] ?? ratingBounds.min, ratingBounds.max))
    const max = Math.min(ratingBounds.max, Math.max(ratingRange[1] ?? ratingBounds.max, ratingBounds.min))
    return min <= max ? [min, max] : [max, min]
  }, [ratingBounds, ratingRange])
  const modelPoints = useMemo(
    () => visibleModelPoints.filter((point) => point.rating >= effectiveRatingRange[0] && point.rating <= effectiveRatingRange[1]),
    [effectiveRatingRange, visibleModelPoints],
  )
  const humanWithinRatingRange = humanPoint != null && humanPoint.rating >= effectiveRatingRange[0] && humanPoint.rating <= effectiveRatingRange[1]

  const chart = useMemo(() => {
    const points: ChartPoint[] = metric === "cost" && showHuman && humanPoint && humanWithinRatingRange ? [...modelPoints, humanPoint] : modelPoints
    if (points.length === 0) return null

    const xValue = (point: ChartPoint) => metricValue(point, metric) ?? 0
    const transformedValues = points.map((point) => transformCost(xValue(point), costScale))
    const rawValueMin = Math.min(...transformedValues)
    const rawValueMax = Math.max(...transformedValues)
    const minimumSpan = costScale === "log" ? 0.7 : Math.max(rawValueMax * 0.15, 0.001)
    const valueSpan = Math.max(rawValueMax - rawValueMin, minimumSpan)
    const valueMin = costScale === "log" ? rawValueMin - valueSpan * 0.09 : Math.max(0, rawValueMin - valueSpan * 0.05)
    const valueMax = rawValueMax + valueSpan * 0.09
    const rawRatingMax = Math.max(...points.map((point) => point.rating + point.ratingDeviation))
    const step = niceStep(rawRatingMax - RATING_AXIS_FLOOR)
    const ratingMin = RATING_AXIS_FLOOR
    const ratingMax = Math.max(ratingMin + step, Math.ceil(rawRatingMax / step) * step)
    const plotWidth = WIDTH - PLOT.left - PLOT.right
    const plotHeight = HEIGHT - PLOT.top - PLOT.bottom
    const x = (value: number) => PLOT.left + (transformCost(value, costScale) - valueMin) / (valueMax - valueMin) * plotWidth
    const y = (value: number) => PLOT.top + (ratingMax - value) / (ratingMax - ratingMin) * plotHeight
    const rawPlotted = points.map((point) => ({
      point,
      x: x(xValue(point)),
      y: y(point.rating),
      errorTop: y(Math.min(ratingMax, point.rating + point.ratingDeviation)),
      errorBottom: y(Math.max(ratingMin, point.rating - point.ratingDeviation)),
      color: isHumanPoint(point)
        ? HUMAN_COLOR
        : colorByModel.get(point.representative.model_variant.base_key) ?? MODEL_COLORS[0],
      labelX: 0,
      labelY: 0,
      labelLayout: "stacked" as const,
    }))
    const plotted = showLabels ? placeLabels(rawPlotted, y(MINIMUM_RATING)) : rawPlotted
    const yTicks: number[] = []
    for (let value = ratingMin; value <= ratingMax + step / 2; value += step) yTicks.push(value)
    return {
      points,
      modelPointCount: modelPoints.length,
      plotted,
      x,
      y,
      xTicks: costTicks(valueMin, valueMax, costScale),
      yTicks,
    }
  }, [colorByModel, costScale, humanPoint, humanWithinRatingRange, metric, modelPoints, showHuman, showLabels])

  if (allModelPoints.length === 0 && !humanPoint) return null
  const active = chart?.plotted.find((entry) => entry.point.key === activeKey) ?? null
  const ratingFilterActive = effectiveRatingRange[0] > ratingBounds.min || effectiveRatingRange[1] < ratingBounds.max
  const filtersActive = modelSearch.trim().length > 0 || reasoningFilters.size > 0 || hiddenModelKeys.size > 0 || hiddenModelReasoningKeys.size > 0 || ratingFilterActive || (metric === "cost" && !showHuman)
  const positionTooltip = (event: ReactPointerEvent<HTMLAnchorElement>) => {
    const container = plotContainerRef.current
    if (!container) return
    const bounds = container.getBoundingClientRect()
    setTooltipPosition({ x: event.clientX - bounds.left, y: event.clientY - bounds.top })
  }
  const positionTooltipAtPoint = (entry: PlottedPoint) => {
    const container = plotContainerRef.current
    if (!container) return
    const svg = container.querySelector("svg")
    if (!svg) return
    const containerBounds = container.getBoundingClientRect()
    const svgBounds = svg.getBoundingClientRect()
    setTooltipPosition({
      x: svgBounds.left - containerBounds.left + entry.x / WIDTH * svgBounds.width,
      y: svgBounds.top - containerBounds.top + entry.y / HEIGHT * svgBounds.height,
    })
  }
  const clearFilters = () => {
    setModelSearch("")
    setReasoningFilters(new Set())
    setHiddenModelKeys(new Set())
    setHiddenModelReasoningKeys(new Set())
    setRatingRange([null, null])
    setShowHuman(true)
  }
  const toggleModel = (group: ModelVisibilityGroup) => {
    const visible = !hiddenModelKeys.has(group.key) && group.efforts.some(({ effort }) => !hiddenModelReasoningKeys.has(modelReasoningVisibilityKey(group.key, effort)))
    setHiddenModelKeys((current) => {
      const next = new Set(current)
      if (visible) next.add(group.key)
      else next.delete(group.key)
      return next
    })
    if (!visible) setHiddenModelReasoningKeys((current) => {
      const next = new Set(current)
      for (const { effort } of group.efforts) next.delete(modelReasoningVisibilityKey(group.key, effort))
      return next
    })
  }
  const toggleModelReasoning = (group: ModelVisibilityGroup, effort: string) => {
    const key = modelReasoningVisibilityKey(group.key, effort)
    if (hiddenModelKeys.has(group.key)) {
      setHiddenModelKeys((current) => { const next = new Set(current); next.delete(group.key); return next })
      setHiddenModelReasoningKeys((current) => {
        const next = new Set(current)
        for (const option of group.efforts) {
          const optionKey = modelReasoningVisibilityKey(group.key, option.effort)
          if (option.effort === effort) next.delete(optionKey)
          else next.add(optionKey)
        }
        return next
      })
      return
    }
    setHiddenModelReasoningKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const showModelGroups = (groups: ModelVisibilityGroup[]) => {
    setHiddenModelKeys((current) => {
      const next = new Set(current)
      for (const group of groups) next.delete(group.key)
      return next
    })
    setHiddenModelReasoningKeys((current) => {
      const next = new Set(current)
      for (const group of groups) for (const { effort } of group.efforts) next.delete(modelReasoningVisibilityKey(group.key, effort))
      return next
    })
  }
  const showAllAvailableModels = () => showModelGroups(modelVisibilityGroups.filter((group) => availableModelLegend.some((entry) => entry.key === group.key)))
  const hideAllAvailableModels = () => setHiddenModelKeys((current) => {
    const next = new Set(current)
    for (const entry of availableModelLegend) next.add(entry.key)
    return next
  })
  return <Card className="overflow-hidden border-border/70">
    <CardHeader className="gap-3 border-b">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">{metric === "cost" ? <CircleDollarSign className="size-4 text-sky-600" /> : <Gauge className="size-4 text-violet-600" />} Rating efficiency</CardTitle>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">{metric === "cost"
            ? "Glicko-2 puzzle rating versus average provider-reported cost normalized to 50 puzzles from each configuration’s settled runs. The human point values visible solve time at $50/hour. Reaching the puzzle cap also settles a run. Vertical whiskers are mean rating deviation; the horizontal axis supports log, fourth-root, square-root, and linear scaling."
            : "Glicko-2 puzzle rating versus average provider-reported completion tokens per model move across each configuration’s settled runs. Completion usage already includes reasoning tokens when a provider reports them that way, so reasoning is not added twice. Lower token use and higher rating are better; vertical whiskers are mean rating deviation."}</p>
        </div>
        <Badge variant="outline" className="shrink-0 border-emerald-500/30 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300">{modelPoints.length}{modelPoints.length !== allMetricModelPoints.length ? ` of ${allMetricModelPoints.length}` : ""} settled configuration{modelPoints.length === 1 ? "" : "s"}</Badge>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Efficiency comparison" className="inline-flex h-8 items-center rounded-md border bg-background p-0.5">
          <button type="button" aria-pressed={metric === "cost"} onClick={() => setMetric("cost")} className={`h-7 cursor-pointer rounded px-2.5 text-[11px] font-medium transition-colors ${metric === "cost" ? "bg-secondary text-secondary-foreground shadow-sm" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}><CircleDollarSign className="mr-1 inline size-3" />Cost / 50</button>
          <button type="button" aria-pressed={metric === "tokens"} onClick={() => setMetric("tokens")} className={`h-7 cursor-pointer rounded px-2.5 text-[11px] font-medium transition-colors ${metric === "tokens" ? "bg-secondary text-secondary-foreground shadow-sm" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}><Gauge className="mr-1 inline size-3" />Tokens / move</button>
        </div>
        <div className="relative min-w-48 flex-1 sm:max-w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="Filter model name…" className="h-8 pl-8 text-xs" aria-label="Filter chart by model name" />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs"><ListFilter className="size-3.5" />{reasoningFilters.size === 0 ? "All reasoning" : `${reasoningFilters.size} reasoning`}<ChevronDown className="size-3" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-48">
            <DropdownMenuCheckboxItem checked={reasoningFilters.size === 0} onSelect={(event) => event.preventDefault()} onCheckedChange={() => setReasoningFilters(new Set())} className="relative flex cursor-pointer select-none items-center rounded-md py-2 pl-8 pr-2 text-sm outline-none focus:bg-accent"><DropdownMenuItemIndicator className="absolute left-2"><Check className="size-4" /></DropdownMenuItemIndicator>All reasoning</DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            {reasoningOptions.map((effort) => <DropdownMenuCheckboxItem key={effort} checked={reasoningFilters.has(effort)} onSelect={(event) => event.preventDefault()} onCheckedChange={() => setReasoningFilters((current) => {
              const next = new Set(current)
              if (next.has(effort)) next.delete(effort)
              else next.add(effort)
              return next
            })} className="relative flex cursor-pointer select-none items-center rounded-md py-2 pl-8 pr-2 text-sm outline-none focus:bg-accent"><DropdownMenuItemIndicator className="absolute left-2"><Check className="size-4" /></DropdownMenuItemIndicator>{reasoningEffortLabel(effort)}</DropdownMenuCheckboxItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
        <div role="group" aria-label="Horizontal axis scale" className="inline-flex h-8 items-center rounded-md border bg-background p-0.5">
          {COST_SCALE_OPTIONS.map((option) => <button key={option.value} type="button" aria-pressed={costScale === option.value} onClick={() => setCostScale(option.value)} className={`h-7 cursor-pointer rounded px-2 text-[11px] font-medium transition-colors ${costScale === option.value ? "bg-secondary text-secondary-foreground shadow-sm" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}>{option.label}</button>)}
        </div>
        <div className="inline-flex h-8 min-w-64 items-center gap-2 rounded-md border bg-background px-2" title="Filter chart points by Glicko-2 rating">
          <span className="shrink-0 text-[11px] font-medium text-muted-foreground">Rating</span>
          <span className="w-8 shrink-0 text-right font-mono text-[10px] tabular-nums text-foreground">{effectiveRatingRange[0].toLocaleString()}</span>
          <Slider value={effectiveRatingRange} min={ratingBounds.min} max={ratingBounds.max} step={25} thumbLabels={["Minimum rating", "Maximum rating"]} onValueChange={(value) => { if (value.length === 2) setRatingRange([value[0], value[1]]) }} className="min-w-24 flex-1" />
          <span className="w-9 shrink-0 font-mono text-[10px] tabular-nums text-foreground">{effectiveRatingRange[1].toLocaleString()}</span>
        </div>
        {metric === "cost" ? <Button variant={showHuman ? "secondary" : "outline"} size="sm" className="h-8 gap-1.5 text-xs" aria-pressed={showHuman} onClick={() => setShowHuman((value) => !value)}><UserRound className="size-3.5" />hunter (me){showHuman ? <Eye className="size-3" /> : <EyeOff className="size-3" />}</Button> : null}
        <Button variant={showLabels ? "secondary" : "outline"} size="sm" className="h-8 gap-1.5 text-xs" aria-pressed={showLabels} onClick={() => setShowLabels((value) => !value)}><Tags className="size-3.5" />Labels</Button>
        <Button variant={showLegend || hiddenConfigurationCount > 0 ? "secondary" : "outline"} size="sm" className="h-8 cursor-pointer gap-1.5 text-xs" aria-expanded={showLegend} aria-controls="rating-efficiency-legend" onClick={() => setShowLegend((value) => !value)}><ListFilter className="size-3.5" />Legend{hiddenConfigurationCount > 0 ? <span className="rounded-full bg-background/80 px-1.5 py-0.5 font-mono text-[10px] tabular-nums">{hiddenConfigurationCount} hidden</span> : null}<ChevronDown className={`size-3 transition-transform duration-300 motion-reduce:transition-none ${showLegend ? "rotate-180" : ""}`} /></Button>
        <Button variant="ghost" size="icon" className="size-8" disabled={!filtersActive} onClick={clearFilters} aria-label="Clear chart filters"><RotateCcw className="size-3.5" /></Button>
      </div>
    </CardHeader>
    <CardContent className="p-3 sm:p-5">
      <div id="rating-efficiency-legend" className={`grid transition-[grid-template-rows,opacity,margin] duration-300 ease-out motion-reduce:transition-none ${showLegend ? "mb-3 grid-rows-[1fr] opacity-100" : "mb-0 grid-rows-[0fr] opacity-0"}`} aria-hidden={!showLegend} inert={!showLegend}>
        <div className="min-h-0 overflow-hidden">
          <div className="rounded-lg border bg-muted/25 px-3 py-3 text-[10px] text-muted-foreground">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><span className="font-semibold uppercase tracking-wider text-foreground">Models &amp; reasoning</span><span className="ml-2">Click a model to toggle all levels, or choose a level.</span></div>
              <div className="flex items-center gap-1">
                <button type="button" className="cursor-pointer rounded px-2 py-1 font-medium transition-colors hover:bg-accent hover:text-foreground" onClick={showAllAvailableModels}>Show all</button>
                <button type="button" className="cursor-pointer rounded px-2 py-1 font-medium transition-colors hover:bg-accent hover:text-foreground" onClick={hideAllAvailableModels}>Hide all</button>
              </div>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {availableModelLegend.map((entry) => {
                const group = modelVisibilityByKey.get(entry.key)
                if (!group) return null
                const hiddenByModel = hiddenModelKeys.has(entry.key)
                const modelVisible = !hiddenByModel && Array.from(entry.efforts).some((effort) => !hiddenModelReasoningKeys.has(modelReasoningVisibilityKey(entry.key, effort)))
                return <div key={entry.key} className={`inline-flex items-stretch overflow-hidden rounded-full border transition-[opacity,background-color,color,border-color] ${modelVisible ? "border-border bg-background text-foreground" : "border-transparent bg-muted/50 opacity-45 hover:opacity-75"}`}>
                  <button type="button" aria-pressed={modelVisible} title={`${modelVisible ? "Hide" : "Show"} every ${entry.label} configuration`} onClick={() => toggleModel(group)} className="inline-flex cursor-pointer items-center gap-1.5 px-2.5 py-1 font-medium transition-colors hover:bg-accent">
                    <span className="size-2 rounded-full" style={{ backgroundColor: entry.color }} />{entry.label}
                  </button>
                  <span className="my-1 w-px bg-border" aria-hidden="true" />
                  <span className="flex items-center pr-1">
                    {group.efforts.filter(({ effort }) => entry.efforts.has(effort)).map(({ effort }) => {
                      const visible = !hiddenByModel && !hiddenModelReasoningKeys.has(modelReasoningVisibilityKey(entry.key, effort))
                      return <button key={effort} type="button" aria-pressed={visible} title={`${visible ? "Hide" : "Show"} ${entry.label} · ${reasoningEffortLabel(effort)}`} onClick={() => toggleModelReasoning(group, effort)} className={`cursor-pointer rounded-full px-1.5 py-1 font-semibold transition-[opacity,background-color,color] hover:bg-accent ${visible ? "text-foreground" : "text-muted-foreground opacity-45 line-through hover:opacity-80"}`}>
                        {compactReasoningLabel(effort)}
                      </button>
                    })}
                  </span>
                </div>
              })}
              {metric === "cost" && humanPoint ? <button type="button" aria-pressed={showHuman} title={`${showHuman ? "Hide" : "Show"} hunter (me)`} onClick={() => setShowHuman((value) => !value)} className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium transition-[opacity,background-color,color,border-color] hover:bg-accent ${showHuman ? "border-border bg-background text-foreground" : "border-transparent bg-muted/50 opacity-45 hover:opacity-75"}`}><span className="size-2 rounded-full" style={{ backgroundColor: HUMAN_COLOR }} />hunter (me)</button> : null}
            </div>
          </div>
        </div>
      </div>
      {chart ? <><div className="overflow-x-auto">
        <div ref={plotContainerRef} className="relative min-w-[720px]">
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="mx-auto block h-auto max-h-[74vh] w-full" role="img" aria-label={`${metric === "cost" ? "Cost" : "Token"}-performance scatter plot with ${chart.modelPointCount} settled model configurations${chart.points.length > chart.modelPointCount ? " and one human result" : ""}. Lower ${metric === "cost" ? "cost" : "token use"} and higher Glicko-2 puzzle rating are better.`}>
            <StaticPlot plotted={chart.plotted} xTicks={chart.xTicks} yTicks={chart.yTicks} x={chart.x} y={chart.y} showLabels={showLabels} metric={metric} />
            <text x={(PLOT.left + WIDTH - PLOT.right) / 2} y={HEIGHT - 7} textAnchor="middle" className="fill-muted-foreground text-[12px] font-medium">{metric === "cost" ? "Avg. cost per 50 puzzles" : "Avg. generated tokens per model move"} ({COST_SCALE_OPTIONS.find((option) => option.value === costScale)?.axisLabel} scale)</text>
            <text transform={`translate(18 ${(PLOT.top + HEIGHT - PLOT.bottom) / 2}) rotate(-90)`} textAnchor="middle" className="fill-muted-foreground text-[12px] font-medium">Glicko-2 puzzle rating</text>
            {chart.plotted.map((entry) => <a
              key={entry.point.key}
              href={`#${runPath(entry.point)}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${isHumanPoint(entry.point) ? HUMAN_LABEL : entry.point.representative.model_variant.display_name}, ${Math.round(entry.point.rating)} Glicko-2 puzzle rating, ${metric === "cost" ? `${formatCost(entry.point.costPerPuzzle * NORMALIZED_PUZZLES)} per 50 puzzles` : `${formatTokens(isHumanPoint(entry.point) ? 0 : entry.point.tokensPerMove ?? 0)} generated tokens per model move`}`}
              className="cursor-pointer outline-none"
              onClick={(event) => {
                event.preventDefault()
                setSelectedPoint(entry.point)
              }}
              onPointerEnter={(event) => { setActiveKey(entry.point.key); positionTooltip(event) }}
              onPointerMove={positionTooltip}
              onPointerLeave={() => { setActiveKey((current) => current === entry.point.key ? null : current); setTooltipPosition(null) }}
              onFocus={() => { setActiveKey(entry.point.key); positionTooltipAtPoint(entry) }}
              onBlur={() => { setActiveKey((current) => current === entry.point.key ? null : current); setTooltipPosition(null) }}
            >
              <g>
                <circle cx={entry.x} cy={entry.y} r="15" fill="transparent" />
                <circle cx={entry.x} cy={entry.y} r={activeKey === entry.point.key ? 8 : 5.5} fill={entry.color} className="stroke-background transition-[r] duration-150 motion-reduce:transition-none" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                {activeKey === entry.point.key ? <circle cx={entry.x} cy={entry.y} r="11" fill="none" stroke={entry.color} strokeWidth="1.25" opacity="0.45" vectorEffect="non-scaling-stroke" /> : null}
              </g>
            </a>)}
          </svg>
          {active && tooltipPosition ? <div
            className="pointer-events-none absolute z-20"
            style={{
              left: Math.max(8, Math.min(tooltipPosition.x + (tooltipPosition.x > (plotContainerRef.current?.clientWidth ?? 0) - 290 ? -272 : 14), (plotContainerRef.current?.clientWidth ?? 0) - 264)),
              top: Math.max(8, Math.min(tooltipPosition.y - 36, (plotContainerRef.current?.clientHeight ?? 0) - 264)),
            }}
          ><Inspector entry={active} metric={metric} /></div> : null}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground"><span>Better configurations move up and left.</span><span>Hover, focus, or click a dot to inspect it.</span></div>
      </> : <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center"><div className="text-sm font-semibold">No matching chart points</div><p className="text-xs text-muted-foreground">Try another model name or reasoning selection.</p><Button variant="outline" size="sm" onClick={clearFilters}>Clear filters</Button></div>}
    </CardContent>
    <RunPickerSheet point={selectedPoint} metric={metric} onOpenChange={(open) => { if (!open) setSelectedPoint(null) }} />
  </Card>
}
