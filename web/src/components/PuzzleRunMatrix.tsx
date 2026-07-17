import { useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowRight, BarChart3, Check, Filter, Info } from "lucide-react"
import type { ModelVariant, RunIndexEntry } from "@/lib/data"
import { MODES, modeInfo, pct, pointsText, RESPONSE_STYLES, responseStyleInfo, type ModeNumber, type ResponseStyleKey } from "@/lib/format"
import { ModelIdentity } from "@/components/ModelIdentity"
import { ResponseStyleBadge } from "@/components/ResponseStyle"
import { ExportButton } from "@/components/ExportButton"
import { Badge } from "@/components/ui/badge"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"

export type PuzzleMode = ModeNumber

type StyleRuns = Partial<Record<ResponseStyleKey, RunIndexEntry>>
type LatestByMode = Partial<Record<PuzzleMode, StyleRuns>>

interface ModelRow {
  variant: ModelVariant
  runs: RunIndexEntry[]
  latestByMode: LatestByMode
}

interface PuzzleRunMatrixProps {
  runs: RunIndexEntry[]
  suite: string
  visibleModes: PuzzleMode[]
  onVisibleModesChange: (modes: PuzzleMode[]) => void
  openModels: string[]
  onOpenModelsChange: (models: string[]) => void
  exportLabel?: string
}

const MATRIX_CLASS_NAME = "grid items-center transition-[grid-template-columns] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"

function methodColumnClassName(visible: boolean) {
  return cn(
    "min-w-0 overflow-hidden px-2 transition-[opacity,translate] duration-200 ease-out motion-reduce:transition-none",
    visible ? "translate-x-0 opacity-100 delay-75" : "pointer-events-none -translate-x-2 opacity-0 delay-0",
  )
}

const rating = (run?: RunIndexEntry) => run?.summary.puzzle_performance_rating

function ratingText(run?: RunIndexEntry) {
  const estimate = rating(run)
  if (!estimate) return "—"
  if (!estimate.bounded) return estimate.rating <= 0 ? "< 0" : "> 4000"
  return Math.round(estimate.rating).toLocaleString()
}

function ratingNote(run: RunIndexEntry) {
  const estimate = rating(run)
  if (!estimate) return "not estimated"
  if (!estimate.ci95) return `${estimate.n} puzzles · bound`
  return `95% ${Math.round(estimate.ci95[0]).toLocaleString()}–${Math.round(estimate.ci95[1]).toLocaleString()}`
}

function methodRuns(row: ModelRow, mode: PuzzleMode) {
  const styles = row.latestByMode[mode]
  if (!styles) return []
  return RESPONSE_STYLES.flatMap((style) => styles[style.key] ? [styles[style.key]!] : [])
}

function MethodRating({ runs }: { runs: RunIndexEntry[] }) {
  if (!runs.length) return <div className="text-xs text-muted-foreground/70">Not run</div>
  return <div className="grid gap-1.5">{runs.map((run) => <div key={run.run_id} className="min-w-0 rounded-lg border border-border/60 bg-background/60 px-2.5 py-2 shadow-xs">
    <div className="flex items-center justify-between gap-2">
      <ResponseStyleBadge condition={run.condition} compact />
      <span className="font-mono text-lg font-semibold leading-none tabular-nums">{ratingText(run)}</span>
    </div>
    <div className="mt-1.5 text-right text-[10px] leading-none text-muted-foreground">{ratingNote(run)}</div>
  </div>)}</div>
}

function completedDate(run: RunIndexEntry) {
  const value = run.completed_at ?? run.updated_at ?? run.created
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value.slice(0, 10) : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

function runDetailPath(run: RunIndexEntry) {
  return `/model/${encodeURIComponent(run.model_variant.key)}?run=${encodeURIComponent(run.run_id)}`
}

export function PuzzleRunMatrix({
  runs,
  suite,
  visibleModes,
  onVisibleModesChange,
  openModels,
  onOpenModelsChange,
  exportLabel = "Export this suite",
}: PuzzleRunMatrixProps) {
  const navigate = useNavigate()
  const rows = useMemo(() => {
    const grouped = new Map<string, ModelRow>()
    for (const run of runs) {
      const info = modeInfo(run.condition)
      if (!info) continue
      const row = grouped.get(run.model_variant.key) ?? { variant: run.model_variant, runs: [], latestByMode: {} }
      row.runs.push(run)
      const styles = row.latestByMode[info.n] ?? {}
      const style = responseStyleInfo(run.condition).key
      const current = styles[style]
      if (!current || run.created > current.created) styles[style] = run
      row.latestByMode[info.n] = styles
      grouped.set(run.model_variant.key, row)
    }
    return [...grouped.values()].toSorted((a, b) => a.variant.display_name.localeCompare(b.variant.display_name))
  }, [runs])

  const toggleMode = (mode: PuzzleMode) => {
    if (visibleModes.includes(mode)) {
      if (visibleModes.length === 1) return
      onVisibleModesChange(visibleModes.filter((item) => item !== mode))
      return
    }
    onVisibleModesChange(MODES.map((item) => item.n).filter((item) => visibleModes.includes(item) || item === mode))
  }
  const matrixColumns = [
    "minmax(250px, 1.4fr)",
    ...MODES.map((item) => visibleModes.includes(item.n) ? "minmax(185px, .85fr)" : "minmax(0px, 0fr)"),
    "minmax(120px, .65fr)",
  ].join(" ")
  const matrixMinWidth = 390 + visibleModes.length * 195

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex max-w-2xl items-start gap-2 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" />
          <span><strong className="text-foreground">{suite}</strong> · cells show every available response style. Expand a model for points, solves, legality, cost, and run dates.</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-h-9 max-w-full flex-wrap items-center gap-1 rounded-lg border bg-card p-1 shadow-xs" aria-label="Visible method columns">
            <span className="flex items-center gap-1 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"><Filter className="size-3" /> Columns</span>
            {MODES.map((item) => {
              const visible = visibleModes.includes(item.n)
              return <button
                key={item.n}
                type="button"
                aria-pressed={visible}
                disabled={visible && visibleModes.length === 1}
                title={visible && visibleModes.length === 1 ? "Keep at least one method visible" : item.blurb}
                onClick={() => toggleMode(item.n)}
                className={cn("inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-70", visible ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
              >
                <Check className={cn("size-3 transition-all duration-200", visible ? "scale-100 opacity-100" : "-mr-1.5 scale-75 opacity-0")} /> {item.displayN}. {item.name}
              </button>
            })}
          </div>
          <ExportButton track="puzzle" suite={suite} status="completed" label={exportLabel} />
        </div>
      </div>

      {rows.length === 0 ? <Card className="border-border/70">
        <CardContent className="py-16 text-center sm:py-20">
          <div className="mx-auto grid size-10 place-items-center rounded-full bg-secondary"><BarChart3 className="size-4 text-muted-foreground" /></div>
          <div className="mt-3 font-medium">Clean slate—no published model scores yet</div>
          <div className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">The puzzle bank and exact suite hashes are registered. Completed runs will appear here grouped by model.</div>
          <Badge variant="outline" className="mt-3">{visibleModes.map((mode) => MODES.find((item) => item.n === mode)?.name).join(" · ")}</Badge>
        </CardContent>
      </Card> : <Card className="overflow-hidden border-border/70">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <div
              className="transition-[min-width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
              style={{ minWidth: matrixMinWidth }}
            >
              <div className="border-b bg-muted/35 px-4 py-3 pr-12">
                <div className={MATRIX_CLASS_NAME} style={{ gridTemplateColumns: matrixColumns }}>
                  <div className="pr-2 text-xs font-medium text-muted-foreground">Model configuration</div>
                  {MODES.map((info) => {
                    const visible = visibleModes.includes(info.n)
                    return <div key={info.n} aria-hidden={!visible} className={methodColumnClassName(visible)} title={info.blurb}><div className="text-xs font-medium text-foreground">{info.displayN}. {info.name}</div><div className="mt-0.5 text-[10px] text-muted-foreground">Puzzle Elo</div></div>
                  })}
                  <div className="pl-2 text-right text-xs font-medium text-muted-foreground">Visible runs</div>
                </div>
              </div>
              <Accordion type="multiple" value={openModels} onValueChange={onOpenModelsChange}>
                {rows.map((row) => {
                  const visibleRuns = row.runs.filter((run) => {
                    const info = modeInfo(run.condition)
                    return info != null && visibleModes.includes(info.n)
                  }).toSorted((a, b) => {
                    const aMode = modeInfo(a.condition)?.n ?? 99
                    const bMode = modeInfo(b.condition)?.n ?? 99
                    return aMode - bMode || responseStyleInfo(a.condition).label.localeCompare(responseStyleInfo(b.condition).label) || b.created.localeCompare(a.created)
                  })
                  const visibleAttempts = visibleRuns.reduce((sum, run) => sum + run.progress.completed, 0)
                  const visibleCost = visibleRuns.reduce((sum, run) => sum + (run.summary.cost_usd ?? 0), 0)
                  return <AccordionItem key={row.variant.key} value={row.variant.key} className="border-border/70">
                    <AccordionTrigger className="px-4 py-4 transition-colors duration-200 hover:bg-muted/35 data-[state=open]:bg-muted/30 [&>svg]:mt-3 [&>svg]:transition-transform [&>svg]:duration-300">
                      <div className={cn(MATRIX_CLASS_NAME, "min-w-0 flex-1")} style={{ gridTemplateColumns: matrixColumns }}>
                        <div className="min-w-0 pr-2"><ModelIdentity variant={row.variant} /></div>
                        {MODES.map((item) => {
                          const visible = visibleModes.includes(item.n)
                          return <div key={item.n} aria-hidden={!visible} className={methodColumnClassName(visible)}><MethodRating runs={methodRuns(row, item.n)} /></div>
                        })}
                        <div className="pl-2 text-right">
                          <div className="font-mono text-sm font-semibold tabular-nums">{visibleRuns.length} {visibleRuns.length === 1 ? "run" : "runs"}</div>
                          <div className="mt-0.5 text-[10px] text-muted-foreground">{visibleAttempts.toLocaleString()} attempts · ${visibleCost.toFixed(2)}</div>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pb-0">
                      <div className="border-t bg-muted/15 px-4 py-5">
                        <div className="mb-4"><div className="text-sm font-semibold">Published runs</div><div className="mt-0.5 text-xs text-muted-foreground">Each row is a distinct prompt method and response protocol. Select one to inspect its complete result.</div></div>
                        <div className="overflow-hidden rounded-lg border bg-background">
                          <Table>
                            <TableHeader><TableRow>
                              <TableHead>Method</TableHead><TableHead>Response</TableHead><TableHead className="text-right">Puzzle Elo</TableHead><TableHead className="text-right">Points</TableHead><TableHead className="text-right">Full solves</TableHead><TableHead className="text-right">Legal first</TableHead><TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Completed</TableHead>
                            </TableRow></TableHeader>
                            <TableBody>{visibleRuns.map((run) => {
                              const info = modeInfo(run.condition)!
                              const path = runDetailPath(run)
                              return <TableRow
                                key={run.run_id}
                                role="link"
                                tabIndex={0}
                                aria-label={`Open ${info.displayN}. ${info.name}, ${responseStyleInfo(run.condition).label}`}
                                className="group cursor-pointer outline-none hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                                onClick={() => navigate(path)}
                                onKeyDown={(event) => {
                                  if (event.key !== "Enter" && event.key !== " ") return
                                  event.preventDefault()
                                  navigate(path)
                                }}
                              >
                                <TableCell><div className="font-medium">{info.displayN}. {info.name}</div><div className="text-[10px] text-muted-foreground">{info.blurb}</div></TableCell>
                                <TableCell><ResponseStyleBadge condition={run.condition} /></TableCell>
                                <TableCell className="text-right"><div className="font-mono font-semibold tabular-nums">{ratingText(run)}</div><div className="text-[10px] text-muted-foreground">{ratingNote(run)}</div></TableCell>
                                <TableCell className="text-right font-mono font-semibold tabular-nums">{pointsText(run.summary)}</TableCell>
                                <TableCell className="text-right tabular-nums">{run.summary.solved}/{run.summary.n}<div className="text-[10px] text-muted-foreground">{pct(run.summary.solve_rate)}</div></TableCell>
                                <TableCell className="text-right tabular-nums text-muted-foreground">{pct(run.summary.first_move_legal_rate)}</TableCell>
                                <TableCell className="text-right font-mono text-xs text-muted-foreground">{run.summary.cost_usd == null ? "—" : `$${run.summary.cost_usd.toFixed(3)}`}</TableCell>
                                <TableCell className="text-right text-xs text-muted-foreground"><span className="inline-flex items-center gap-2">{completedDate(run)} <ArrowRight className="size-3.5 opacity-35 transition-all group-hover:translate-x-0.5 group-hover:opacity-100 group-focus-visible:translate-x-0.5 group-focus-visible:opacity-100" /></span></TableCell>
                              </TableRow>
                            })}</TableBody>
                          </Table>
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                })}
              </Accordion>
            </div>
          </div>
        </CardContent>
      </Card>}
    </div>
  )
}
