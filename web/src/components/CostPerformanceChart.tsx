import { memo, useEffect, useMemo, useState, type KeyboardEvent } from "react"
import { useNavigate } from "react-router-dom"
import { CircleDollarSign } from "lucide-react"
import type { RatedRunAggregate } from "@/lib/ratedAggregates"
import { costPerformancePoints, type CostPerformancePoint } from "@/lib/costPerformance"
import { effectiveReasoningEffort, reasoningConfigurationEffort, reasoningEffortLabel } from "@/lib/modelReasoning"
import { fetchHumanTrainingProfileByRun, type HumanTrainingProfile } from "@/lib/backend"
import { useData } from "@/lib/useData"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

const WIDTH = 1000
const HEIGHT = 420
const PLOT = { left: 76, right: 30, top: 40, bottom: 54 }
const NORMALIZED_PUZZLES = 50
const MINIMUM_RATING = 400
const HUMAN_HOURLY_RATE = 50
const HUMAN_RUN_ID = "legacy:af491903-33b9-46c3-9f1f-f551054600fa"
const HUMAN_COLOR = "#d946ef"
const MODEL_COLORS = [
  "#059669", "#7c3aed", "#0284c7", "#ea580c", "#e11d48",
  "#2563eb", "#c026d3", "#65a30d", "#d97706", "#0d9488",
  "#4f46e5", "#db2777", "#16a34a", "#9333ea", "#0891b2",
  "#dc2626", "#4d7c0f", "#a21caf", "#0369a1", "#a16207",
]

function formatCost(value: number) {
  if (value < 0.000001) return `$${value.toExponential(1)}`
  if (value < 0.0001) return `$${value.toFixed(6)}`
  if (value < 0.01) return `$${value.toFixed(4)}`
  if (value < 1) return `$${value.toFixed(3)}`
  return `$${value.toFixed(2)}`
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
  runCount: 1
}

type ChartPoint = CostPerformancePoint | HumanCostPerformancePoint

function isHumanPoint(point: ChartPoint): point is HumanCostPerformancePoint {
  return "kind" in point && point.kind === "human"
}

function pointLabelParts(point: ChartPoint) {
  if (isHumanPoint(point)) return { firstLine: "me", secondModel: "", effort: "", effortLabel: "" }
  const variant = point.representative.model_variant
  const configuredEffort = reasoningConfigurationEffort(variant)
  const resolvedEffort = configuredEffort === "provider" ? effectiveReasoningEffort(variant) : configuredEffort
  const effort = resolvedEffort === "provider" ? "none" : resolvedEffort
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

interface PlottedPoint {
  point: ChartPoint
  x: number
  y: number
  errorTop: number
  errorBottom: number
  color: string
  labelX: number
  labelY: number
}

interface LabelBox { left: number; right: number; top: number; bottom: number }
interface Segment { x1: number; y1: number; x2: number; y2: number }
interface LabelPlacement { x: number; y: number; box: LabelBox; leader: Segment | null; score: number }

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

function labelLeader(entry: PlottedPoint, x: number, y: number): Segment {
  const box = labelBox(labelWidth(entry), x, y)
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

function labelNeedsLeader(entry: PlottedPoint, x: number, y: number) {
  const box = labelBox(labelWidth(entry), x, y)
  const horizontallyCentered = Math.abs(x - entry.x) < 1
  const occupiedTop = Math.min(entry.errorTop, entry.y - 7)
  const occupiedBottom = Math.max(entry.errorBottom, entry.y + 7)
  const edgeGap = box.bottom <= occupiedTop ? occupiedTop - box.bottom :
    box.top >= occupiedBottom ? box.top - occupiedBottom :
    Number.POSITIVE_INFINITY
  return !horizontallyCentered || edgeGap > 2
}

function pointDensity(entry: PlottedPoint, entries: PlottedPoint[]) {
  return entries.reduce((density, other) => {
    if (other.point.key === entry.point.key) return density
    const distance = Math.hypot(other.x - entry.x, other.y - entry.y)
    return density + Math.max(0, 180 - distance) / 180
  }, 0)
}

function labelWidth(entry: PlottedPoint) {
  const lines = pointLabelLines(entry.point)
  return Math.max(58, Math.max(...lines.map((line) => line.length)) * 4.2 + 6)
}

function labelBox(width: number, x: number, y: number): LabelBox {
  return { left: x - width / 2, right: x + width / 2, top: y - 10, bottom: y + 15 }
}

function directLabelCandidates(entry: PlottedPoint) {
  const occupiedTop = Math.min(entry.errorTop, entry.y - 7)
  const occupiedBottom = Math.max(entry.errorBottom, entry.y + 7)
  return [
    { x: entry.x, y: occupiedTop - 16 },
    { x: entry.x, y: occupiedBottom + 12 },
  ]
}

function displacedLabelCandidates(entry: PlottedPoint, width: number) {
  const candidates: Array<{ x: number; y: number }> = []
  const horizontalOffsets = [0]
  const maxHorizontalOffset = Math.max(180, width * 1.65)
  for (let offset = 12; offset <= maxHorizontalOffset; offset += 12) {
    horizontalOffsets.push(-offset, offset)
  }
  for (let level = 0; level < 8; level += 1) {
    const verticalOffset = level * 18
    for (const offset of horizontalOffsets) {
      candidates.push({ x: entry.x + offset, y: entry.errorTop - 22 - verticalOffset })
      candidates.push({ x: entry.x + offset, y: entry.errorBottom + 18 + verticalOffset })
    }
  }
  const centeredY = entry.y - 2
  const verticalOffsets = [0, -12, 12, -24, 24, -36, 36, -48, 48]
  for (let level = 0; level < 8; level += 1) {
    const sideDistance = width / 2 + 18 + level * 12
    for (const verticalOffset of verticalOffsets) {
      candidates.push({ x: entry.x - sideDistance, y: centeredY + verticalOffset })
      candidates.push({ x: entry.x + sideDistance, y: centeredY + verticalOffset })
    }
  }
  return candidates
}

function scanLabelCandidates(entry: PlottedPoint, width: number) {
  const candidates: Array<{ x: number; y: number }> = []
  const stepX = Math.max(width + 4, 64)
  for (let y = 18; y <= HEIGHT - PLOT.bottom - 18; y += 22) {
    for (let x = PLOT.left + width / 2; x <= WIDTH - PLOT.right - width / 2; x += stepX) {
      candidates.push({ x, y })
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
    candidates: Array<{ x: number; y: number }>,
    placements: Map<string, LabelPlacement>,
    allowLeader: boolean,
  ) {
    const width = labelWidth(entry)
    let best: LabelPlacement | null = null
    const otherMarkers = markers.filter((marker) => marker.key !== entry.point.key)
    const otherWhiskers = whiskers.filter((whisker) => whisker.key !== entry.point.key)
    const otherPlacements = [...placements.entries()].filter(([key]) => key !== entry.point.key).map(([, value]) => value)
    for (const candidate of candidates) {
      const x = Math.max(PLOT.left + width / 2, Math.min(WIDTH - PLOT.right - width / 2, candidate.x))
      const box = labelBox(width, x, candidate.y)
      if (box.top < 8 || box.bottom > HEIGHT - PLOT.bottom - 4) continue
      const blocked =
        otherPlacements.some((other) => boxesOverlap(box, other.box)) ||
        markers.some((marker) => boxesOverlap(box, marker.box)) ||
        whiskers.some((whisker) => boxesOverlap(box, whisker.box))
      if (blocked) continue
      const needsLeader = labelNeedsLeader(entry, x, candidate.y)
      if (needsLeader && !allowLeader) continue
      const leader = needsLeader ? labelLeader(entry, x, candidate.y) : null
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
        (leader ? LEADER_LINE_PENALTY + Math.hypot(leader.x2 - leader.x1, leader.y2 - leader.y1) : Math.abs(candidate.y - entry.y))
      if (!best || score < best.score) best = { x, y: candidate.y, box, leader, score }
    }
    return best
  }

  // First maximize labels that can sit directly above or below their marker.
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

  // Only labels that did not fit above or below enter the displaced/leader-line pass.
  for (const entry of ordered) {
    if (placements.has(entry.point.key)) continue
    const width = labelWidth(entry)
    const local = bestPlacement(entry, displacedLabelCandidates(entry, width), placements, true)
    const placement = local ?? bestPlacement(entry, scanLabelCandidates(entry, width), placements, true)
    if (placement) placements.set(entry.point.key, placement)
  }

  // Revisit only displaced labels. Connector-free labels remain locked, while a
  // displaced label may still graduate to a newly available above/below position.
  for (let pass = 0; pass < 8; pass += 1) {
    let changed = false
    const displacedEntries = ordered.filter((entry) => placements.get(entry.point.key)?.leader)
    const passEntries = pass % 2 === 0 ? displacedEntries : displacedEntries.toReversed()
    for (const entry of passEntries) {
      const current = placements.get(entry.point.key)
      if (!current) continue
      placements.delete(entry.point.key)
      const candidates = [
        { x: current.x, y: current.y },
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
    const position = placements.get(entry.point.key) ?? { x: entry.x, y: entry.errorTop - 10 }
    return { ...entry, labelX: position.x, labelY: position.y }
  })
}

const StaticPlot = memo(function StaticPlot({ plotted, xTicks, yTicks, x, y }: {
  plotted: PlottedPoint[]
  xTicks: number[]
  yTicks: number[]
  x: (value: number) => number
  y: (value: number) => number
}) {
  return <>
    {xTicks.map((value) => <g key={`x-${value}`}>
      <line x1={x(value)} y1={PLOT.top} x2={x(value)} y2={HEIGHT - PLOT.bottom} className="stroke-muted-foreground/65" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />
      <text x={x(value)} y={HEIGHT - 30} textAnchor="middle" className="fill-muted-foreground font-mono text-[11px]">{formatCost(value)}</text>
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
    {plotted.map((entry) => {
      const box = labelBox(labelWidth(entry), entry.labelX, entry.labelY)
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
    })}
    {plotted.map((entry) => {
      if (!labelNeedsLeader(entry, entry.labelX, entry.labelY)) return null
      const leader = labelLeader(entry, entry.labelX, entry.labelY)
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
    })}
    {plotted.map((entry) => {
      const label = pointLabelParts(entry.point)
      if (isHumanPoint(entry.point)) return <text
        key={`label-${entry.point.key}`}
        x={entry.labelX}
        y={entry.labelY + 5}
        textAnchor="middle"
        className="fill-fuchsia-600 text-[8.5px] font-semibold dark:fill-fuchsia-300"
        style={{ paintOrder: "stroke", stroke: "var(--card)", strokeWidth: 4, strokeLinecap: "round", strokeLinejoin: "round" }}
      >me</text>
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
    })}
  </>
})

function Inspector({ entry }: { entry: PlottedPoint }) {
  if (isHumanPoint(entry.point)) return <div className="w-64 rounded-xl border bg-popover/96 p-3 text-popover-foreground shadow-2xl backdrop-blur">
    <div className="flex items-start gap-2">
      <span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} />
      <div><div className="text-sm font-semibold">Me</div><div className="mt-0.5 text-[10px] text-muted-foreground">Human solve time valued at ${HUMAN_HOURLY_RATE}/hour</div></div>
    </div>
    <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs">
      <dt className="text-muted-foreground">Glicko-2 rating</dt><dd className="font-mono font-semibold tabular-nums">{Math.round(entry.point.rating).toLocaleString()}</dd>
      <dt className="text-muted-foreground">RD</dt><dd className="font-mono tabular-nums">±{Math.round(entry.point.ratingDeviation)}</dd>
      <dt className="text-muted-foreground">Labor cost / 50</dt><dd className="font-mono font-semibold tabular-nums">{formatCost(entry.point.costPerPuzzle * NORMALIZED_PUZZLES)}</dd>
      <dt className="text-muted-foreground">Record</dt><dd className="font-mono tabular-nums">{entry.point.solved}–{entry.point.attempts - entry.point.solved}</dd>
      <dt className="text-muted-foreground">Attempts</dt><dd className="font-mono tabular-nums">{entry.point.attempts}</dd>
    </dl>
    <div className="mt-2 border-t pt-2 text-[10px] text-muted-foreground">Click to inspect the saved human run.</div>
  </div>
  const effort = reasoningEffortLabel(reasoningConfigurationEffort(entry.point.representative.model_variant))
  return <div className="w-64 rounded-xl border bg-popover/96 p-3 text-popover-foreground shadow-2xl backdrop-blur">
    <div className="flex items-start gap-2">
      <span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} />
      <div className="min-w-0"><div className="truncate text-sm font-semibold">{entry.point.representative.model_variant.display_name}</div><div className="mt-0.5 text-[10px] text-muted-foreground">{effort} reasoning · {entry.point.runCount} settled run{entry.point.runCount === 1 ? "" : "s"}</div></div>
    </div>
    <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs">
      <dt className="text-muted-foreground">Glicko-2 rating</dt><dd className="font-mono font-semibold tabular-nums">{Math.round(entry.point.rating).toLocaleString()}</dd>
      <dt className="text-muted-foreground">Mean RD</dt><dd className="font-mono tabular-nums">±{Math.round(entry.point.ratingDeviation)}</dd>
      <dt className="text-muted-foreground">Avg. cost / 50</dt><dd className="font-mono font-semibold tabular-nums">{formatCost(entry.point.costPerPuzzle * NORMALIZED_PUZZLES)}</dd>
      <dt className="text-muted-foreground">Cost / puzzle</dt><dd className="font-mono font-semibold tabular-nums">{formatCost(entry.point.costPerPuzzle)}</dd>
      <dt className="text-muted-foreground">Total cost</dt><dd className="font-mono tabular-nums">{formatCost(entry.point.totalCost)}</dd>
      <dt className="text-muted-foreground">Record</dt><dd className="font-mono tabular-nums">{entry.point.solved}–{entry.point.attempts - entry.point.solved}</dd>
      <dt className="text-muted-foreground">Attempts</dt><dd className="font-mono tabular-nums">{entry.point.attempts.toLocaleString()}</dd>
    </dl>
    <div className="mt-2 border-t pt-2 text-[10px] text-muted-foreground">Click to inspect the representative settled run.</div>
  </div>
}

export function CostPerformanceChart({ aggregates }: { aggregates: RatedRunAggregate[] }) {
  const navigate = useNavigate()
  const { apiBase } = useData()
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [humanProfile, setHumanProfile] = useState<HumanTrainingProfile | null>(null)

  useEffect(() => {
    let active = true
    if (!apiBase) return () => { active = false }
    void fetchHumanTrainingProfileByRun(apiBase, HUMAN_RUN_ID)
      .then((profile) => { if (active) setHumanProfile(profile) })
      .catch(() => { if (active) setHumanProfile(null) })
    return () => { active = false }
  }, [apiBase])

  const chart = useMemo(() => {
    const modelPoints = costPerformancePoints(aggregates)
    const activeDurationMs = humanProfile?.session.active_duration_ms ?? 0
    const humanPoint: HumanCostPerformancePoint | null = humanProfile && humanProfile.attempts > 0 && activeDurationMs > 0
      ? {
        kind: "human",
        key: `human:${humanProfile.run_id}`,
        runId: humanProfile.run_id,
        rating: humanProfile.rating,
        ratingDeviation: humanProfile.rating_deviation,
        totalCost: activeDurationMs / 3_600_000 * HUMAN_HOURLY_RATE,
        costPerPuzzle: activeDurationMs / 3_600_000 * HUMAN_HOURLY_RATE / humanProfile.attempts,
        attempts: humanProfile.attempts,
        solved: humanProfile.solved,
        runCount: 1,
      }
      : null
    const points: ChartPoint[] = humanPoint ? [...modelPoints, humanPoint] : modelPoints
    if (points.length === 0) return null

    const logCosts = points.map((point) => Math.log10(point.costPerPuzzle * NORMALIZED_PUZZLES))
    const rawLogMin = Math.min(...logCosts)
    const rawLogMax = Math.max(...logCosts)
    const logSpan = Math.max(rawLogMax - rawLogMin, 0.7)
    const logMin = rawLogMin - logSpan * 0.09
    const logMax = rawLogMax + logSpan * 0.09
    const rawRatingMin = Math.min(...points.map((point) => point.rating - point.ratingDeviation))
    const rawRatingMax = Math.max(...points.map((point) => point.rating + point.ratingDeviation))
    const step = niceStep(rawRatingMax - rawRatingMin)
    const ratingMin = Math.min(MINIMUM_RATING, Math.floor(rawRatingMin / step) * step)
    const ratingMax = Math.max(ratingMin + step, Math.ceil(rawRatingMax / step) * step)
    const plotWidth = WIDTH - PLOT.left - PLOT.right
    const plotHeight = HEIGHT - PLOT.top - PLOT.bottom
    const modelKeys = Array.from(new Set(modelPoints.map((point) => point.representative.model_variant.base_key))).toSorted()
    const colorByModel = new Map(modelKeys.map((key, index) => [key, MODEL_COLORS[index % MODEL_COLORS.length]]))
    const x = (value: number) => PLOT.left + (Math.log10(value) - logMin) / (logMax - logMin) * plotWidth
    const y = (value: number) => PLOT.top + (ratingMax - value) / (ratingMax - ratingMin) * plotHeight
    const plotted = placeLabels(points.map((point) => ({
      point,
      x: x(point.costPerPuzzle * NORMALIZED_PUZZLES),
      y: y(point.rating),
      errorTop: y(Math.min(ratingMax, point.rating + point.ratingDeviation)),
      errorBottom: y(Math.max(ratingMin, point.rating - point.ratingDeviation)),
      color: isHumanPoint(point)
        ? HUMAN_COLOR
        : colorByModel.get(point.representative.model_variant.base_key) ?? MODEL_COLORS[0],
      labelX: 0,
      labelY: 0,
    })), y(MINIMUM_RATING))
    const yTicks: number[] = []
    for (let value = ratingMin; value <= ratingMax + step / 2; value += step) yTicks.push(value)
    return {
      points,
      modelPointCount: modelPoints.length,
      plotted,
      x,
      y,
      xTicks: logTicks(10 ** logMin, 10 ** logMax),
      yTicks,
    }
  }, [aggregates, humanProfile])

  if (!chart) return null
  const active = chart.plotted.find((entry) => entry.point.key === activeKey) ?? null
  const inspect = (event: KeyboardEvent<SVGGElement>, entry: PlottedPoint) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      navigate(runPath(entry.point))
    }
  }

  return <Card className="overflow-hidden border-border/70">
    <CardHeader className="gap-3 border-b sm:flex sm:flex-row sm:items-start sm:justify-between">
      <div>
        <CardTitle className="flex items-center gap-2 text-base"><CircleDollarSign className="size-4 text-sky-600" /> Rating efficiency</CardTitle>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">Glicko-2 puzzle rating versus average provider-reported cost normalized to 50 puzzles from each configuration’s settled runs. The human point values visible solve time at $50/hour. Reaching the puzzle cap also settles a run. Vertical whiskers are mean rating deviation; the cost axis is logarithmic.</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
        <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300">{chart.modelPointCount} settled configuration{chart.modelPointCount === 1 ? "" : "s"}</Badge>
      </div>
    </CardHeader>
    <CardContent className="p-3 sm:p-5">
      <div className="overflow-x-auto">
        <div className="relative min-w-[720px]">
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="mx-auto block h-auto w-full xl:w-3/4" role="img" aria-label={`Cost-performance scatter plot with ${chart.modelPointCount} settled model configurations${chart.points.length > chart.modelPointCount ? " and one human result" : ""}. Lower cost and higher Glicko-2 puzzle rating are better.`}>
            <StaticPlot plotted={chart.plotted} xTicks={chart.xTicks} yTicks={chart.yTicks} x={chart.x} y={chart.y} />
            <text x={(PLOT.left + WIDTH - PLOT.right) / 2} y={HEIGHT - 7} textAnchor="middle" className="fill-muted-foreground text-[12px] font-medium">Avg. cost per 50 puzzles (log scale)</text>
            <text transform={`translate(18 ${(PLOT.top + HEIGHT - PLOT.bottom) / 2}) rotate(-90)`} textAnchor="middle" className="fill-muted-foreground text-[12px] font-medium">Glicko-2 puzzle rating</text>
            {chart.plotted.map((entry) => <g
              key={entry.point.key}
              role="link"
              tabIndex={0}
              aria-label={`${isHumanPoint(entry.point) ? "Me" : entry.point.representative.model_variant.display_name}, ${Math.round(entry.point.rating)} Glicko-2 puzzle rating, ${formatCost(entry.point.costPerPuzzle * NORMALIZED_PUZZLES)} per 50 puzzles`}
              className="cursor-pointer outline-none"
              onPointerEnter={() => setActiveKey(entry.point.key)}
              onPointerLeave={() => setActiveKey((current) => current === entry.point.key ? null : current)}
              onFocus={() => setActiveKey(entry.point.key)}
              onBlur={() => setActiveKey((current) => current === entry.point.key ? null : current)}
              onClick={() => navigate(runPath(entry.point))}
              onKeyDown={(event) => inspect(event, entry)}
            >
              <circle cx={entry.x} cy={entry.y} r="15" fill="transparent" />
              <circle cx={entry.x} cy={entry.y} r={activeKey === entry.point.key ? 8 : 5.5} fill={entry.color} className="stroke-background transition-[r] duration-150 motion-reduce:transition-none" strokeWidth="2" vectorEffect="non-scaling-stroke" />
              {activeKey === entry.point.key ? <circle cx={entry.x} cy={entry.y} r="11" fill="none" stroke={entry.color} strokeWidth="1.25" opacity="0.45" vectorEffect="non-scaling-stroke" /> : null}
            </g>)}
          </svg>
          {active ? <div
            className="pointer-events-none absolute z-20"
            style={{
              left: active.x <= WIDTH / 2 ? `${active.x / WIDTH * 100}%` : undefined,
              right: active.x > WIDTH / 2 ? `${(WIDTH - active.x) / WIDTH * 100}%` : undefined,
              top: `${Math.max(20, Math.min(80, active.y / HEIGHT * 100))}%`,
              transform: active.x <= WIDTH / 2 ? "translate(18px, -50%)" : "translate(-18px, -50%)",
            }}
          ><div style={{ transform: active.x > WIDTH / 2 ? "translateX(-100%)" : undefined }}><Inspector entry={active} /></div></div> : null}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground"><span>Better configurations move up and left.</span><span>Hover, focus, or click a dot to inspect it.</span></div>
    </CardContent>
  </Card>
}
