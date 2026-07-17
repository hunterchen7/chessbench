import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { ArrowLeft, Download, GitCompareArrows, Plus, ShieldAlert, Star, X } from "lucide-react"
import { loadRun, type Run, type RunIndexEntry } from "@/lib/data"
import { useData } from "@/lib/useData"
import { isModelVariant } from "@/lib/participants"
import { modeInfo, pct, pointsText, responseStyleInfo } from "@/lib/format"
import { comparisonRunLabel, comparisonSuiteKey, MAX_COMPARISON_RUNS, normalizeComparisonIds } from "@/lib/runComparison"
import { ModelIdentity } from "@/components/ModelIdentity"
import { PerformanceHistorySkeleton } from "@/components/LoadingSkeletons"
import { ResponseStyleBadge } from "@/components/ResponseStyle"
import { RunComparisonResults } from "@/components/RunComparisonChart"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

function signed(value: number, digits = 0, suffix = "") {
  const rounded = digits ? value.toFixed(digits) : Math.round(value).toLocaleString()
  return `${value > 0 ? "+" : ""}${rounded}${suffix}`
}

function rating(run: RunIndexEntry) {
  return run.summary.puzzle_performance_rating?.rating ?? null
}

function downloadComparison(runs: Run[]) {
  const payload = {
    schema: "chessbench.run_comparison.v1",
    exported_at: new Date().toISOString(),
    run_ids: runs.map((run) => run.run_id),
    suite: runs[0]?.suite ?? null,
    runs,
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }))
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `chessbench-comparison-${runs.length}-runs.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function RunComparison() {
  const { runs } = useData()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectionKey = searchParams.getAll("run").join("\u0000")
  const selectedIds = useMemo(() => normalizeComparisonIds(selectionKey ? selectionKey.split("\u0000") : []), [selectionKey])
  const selectedEntries = useMemo(() => {
    const byId = new Map(runs.map((run) => [run.run_id, run]))
    return selectedIds.flatMap((id) => byId.get(id) ? [byId.get(id)!] : [])
  }, [runs, selectedIds])
  const missingIds = selectedIds.filter((id) => !selectedEntries.some((entry) => entry.run_id === id))
  const baseline = selectedEntries[0]
  const suiteKey = baseline ? comparisonSuiteKey(baseline) : null
  const compatible = selectedEntries.every((entry) => comparisonSuiteKey(entry) === suiteKey)
  const loadKey = selectedEntries.map((entry) => `${entry.run_id}:${entry.file}`).join("\u0000")
  const [loaded, setLoaded] = useState<Run[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoaded([])
    setLoadError(null)
    if (!selectedEntries.length || !compatible) return () => { active = false }
    void Promise.all(selectedEntries.map((entry) => loadRun(entry.file))).then((next) => {
      if (active) setLoaded(next)
    }).catch((error) => {
      if (active) setLoadError(String(error))
    })
    return () => { active = false }
  }, [loadKey, compatible]) // eslint-disable-line react-hooks/exhaustive-deps

  const setSelection = useCallback((ids: string[]) => {
    const next = new URLSearchParams()
    normalizeComparisonIds(ids).forEach((id) => next.append("run", id))
    setSearchParams(next, { replace: true })
  }, [setSearchParams])
  const removeRun = (id: string) => setSelection(selectedIds.filter((candidate) => candidate !== id))
  const makeBaseline = (id: string) => setSelection([id, ...selectedIds.filter((candidate) => candidate !== id)])
  const addRun = (id: string) => setSelection([...selectedIds, id])

  const available = useMemo(() => runs.filter((run) =>
    run.track === "puzzle" &&
    run.status === "completed" &&
    isModelVariant(run.model_variant) &&
    !selectedIds.includes(run.run_id) &&
    (!suiteKey || comparisonSuiteKey(run) === suiteKey)
  ).toSorted((a, b) => comparisonRunLabel(a).localeCompare(comparisonRunLabel(b))), [runs, selectedIds, suiteKey])

  const baselineRating = baseline ? rating(baseline) : null
  const baselinePointsRate = baseline ? baseline.summary.points / Math.max(1, baseline.summary.max_points) : 0
  const baselineSolveRate = baseline?.summary.solve_rate ?? 0
  const baselineCost = baseline?.summary.cost_usd ?? 0

  return <div className="space-y-8">
    <section className="flex flex-wrap items-end justify-between gap-5 border-b border-border/70 pb-7">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-4 text-muted-foreground"><Link to="/puzzles"><ArrowLeft /> Puzzle leaderboard</Link></Button>
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-violet-700 dark:text-violet-300"><GitCompareArrows className="size-4" /> Synchronized analysis</div>
        <h1 className="text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">Compare benchmark runs</h1>
        <p className="mt-4 max-w-3xl text-base leading-relaxed text-muted-foreground">Overlay two to four model or prompting configurations on the exact same frozen puzzle order. The first run is the baseline for every displayed delta.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Select key={selectedIds.join("-")} onValueChange={addRun} disabled={selectedIds.length >= MAX_COMPARISON_RUNS || available.length === 0}>
          <SelectTrigger className="w-[min(22rem,80vw)]"><Plus className="size-4" /><SelectValue placeholder={selectedIds.length >= MAX_COMPARISON_RUNS ? "Four-run limit reached" : selectedIds.length ? "Add compatible run" : "Choose a run"} /></SelectTrigger>
          <SelectContent position="popper" align="end" className="max-w-[min(34rem,92vw)]">
            {available.map((entry) => <SelectItem key={entry.run_id} value={entry.run_id}>{comparisonRunLabel(entry)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" disabled={!loaded.length} onClick={() => downloadComparison(loaded)}><Download /> Export comparison</Button>
      </div>
    </section>

    {missingIds.length > 0 ? <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-4 text-sm"><span className="font-medium text-amber-800 dark:text-amber-200">Some shared run IDs are unavailable.</span> <span className="text-muted-foreground">Remove them or choose currently published runs.</span></div> : null}
    {!compatible ? <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/[0.05] p-4 text-sm"><ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" /><div><div className="font-medium text-destructive">These runs do not share an identical suite hash.</div><div className="mt-1 text-muted-foreground">Puzzle-by-puzzle overlays are intentionally disabled because their positions cannot be aligned honestly.</div></div></div> : null}
    {loadError ? <div className="rounded-xl border border-destructive/30 bg-destructive/[0.05] p-4 text-sm text-destructive">Detailed run data could not be loaded: {loadError}</div> : null}

    {selectedEntries.length === 0 ? <Card className="border-dashed"><CardContent className="py-20 text-center"><div className="mx-auto grid size-12 place-items-center rounded-full bg-violet-500/10 text-violet-700 dark:text-violet-300"><GitCompareArrows className="size-5" /></div><div className="mt-4 text-lg font-semibold">Choose a completed puzzle run</div><p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">Start with any published run, then add up to three configurations from the same frozen suite.</p></CardContent></Card> : <>
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {selectedEntries.map((entry, index) => <Card key={entry.run_id} className="relative gap-4 overflow-hidden py-5">
          <span className="absolute inset-x-0 top-0 h-1 bg-violet-500/70" />
          <CardContent className="space-y-3 px-5">
            <div className="flex items-start justify-between gap-3"><ModelIdentity variant={entry.model_variant} compact /><Button variant="ghost" size="icon-xs" aria-label={`Remove ${comparisonRunLabel(entry)}`} onClick={() => removeRun(entry.run_id)}><X /></Button></div>
            <div className="flex flex-wrap items-center gap-2"><Badge variant={index === 0 ? "default" : "outline"}>{index === 0 ? "Baseline" : `Run ${index + 1}`}</Badge><ResponseStyleBadge condition={entry.condition} compact /><span className="text-xs text-muted-foreground">{modeInfo(entry.condition)?.displayN}. {modeInfo(entry.condition)?.name}</span></div>
            {index > 0 ? <Button variant="ghost" size="xs" className="-ml-2 text-muted-foreground" onClick={() => makeBaseline(entry.run_id)}><Star /> Set as baseline</Button> : <div className="font-mono text-[10px] text-muted-foreground">{entry.suite?.content_hash?.replace("sha256:", "") ?? entry.suite?.name}</div>}
          </CardContent>
        </Card>)}
      </section>

      <Card className="overflow-hidden">
        <CardHeader><CardTitle className="text-base">Summary deltas</CardTitle><p className="text-xs text-muted-foreground">All percentages use the selected suite denominator. Positive cost deltas mean the run was more expensive than the baseline.</p></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table className="min-w-[900px]"><TableHeader><TableRow><TableHead>Run</TableHead><TableHead className="text-right">Puzzle Elo</TableHead><TableHead className="text-right">Points</TableHead><TableHead className="text-right">Full solves</TableHead><TableHead className="text-right">Legal first</TableHead><TableHead className="text-right">Cost</TableHead></TableRow></TableHeader><TableBody>
            {selectedEntries.map((entry, index) => {
              const currentRating = rating(entry)
              const pointsRate = entry.summary.points / Math.max(1, entry.summary.max_points)
              const cost = entry.summary.cost_usd ?? 0
              return <TableRow key={entry.run_id}>
                <TableCell><div className="font-medium">{entry.model_variant.display_name}</div><div className="text-[10px] text-muted-foreground">{modeInfo(entry.condition)?.displayN}. {modeInfo(entry.condition)?.name} · {responseStyleInfo(entry.condition).label}{index === 0 ? " · baseline" : ""}</div></TableCell>
                <TableCell className="text-right"><div className="font-mono font-semibold tabular-nums">{currentRating == null ? "—" : Math.round(currentRating).toLocaleString()}</div>{index > 0 && currentRating != null && baselineRating != null ? <div className="text-[10px] text-muted-foreground">{signed(currentRating - baselineRating)}</div> : null}</TableCell>
                <TableCell className="text-right"><div className="font-mono font-semibold tabular-nums">{pointsText(entry.summary)}</div>{index > 0 ? <div className="text-[10px] text-muted-foreground">{signed((pointsRate - baselinePointsRate) * 100, 1, " pp")}</div> : <div className="text-[10px] text-muted-foreground">{pct(pointsRate)}</div>}</TableCell>
                <TableCell className="text-right"><div className="font-mono font-semibold tabular-nums">{entry.summary.solved}/{entry.summary.n}</div>{index > 0 ? <div className="text-[10px] text-muted-foreground">{signed((entry.summary.solve_rate - baselineSolveRate) * 100, 1, " pp")}</div> : <div className="text-[10px] text-muted-foreground">{pct(entry.summary.solve_rate)}</div>}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{pct(entry.summary.first_move_legal_rate)}</TableCell>
                <TableCell className="text-right"><div className="font-mono tabular-nums">{entry.summary.cost_usd == null ? "—" : `$${cost.toFixed(3)}`}</div>{index > 0 && entry.summary.cost_usd != null ? <div className="text-[10px] text-muted-foreground">{signed(cost - baselineCost, 3, " USD")}</div> : null}</TableCell>
              </TableRow>
            })}
          </TableBody></Table>
        </CardContent>
      </Card>

      {selectedEntries.length === 1 ? <Card className="border-dashed"><CardContent className="py-12 text-center"><div className="font-medium">Add one more compatible run to begin the overlay.</div><p className="mt-1 text-sm text-muted-foreground">Model, reasoning-budget, response-style, and prompt-method variants are all treated as distinct runs.</p></CardContent></Card> : null}
      {selectedEntries.length >= 2 && compatible && loaded.length === selectedEntries.length ? <RunComparisonResults runs={loaded} /> : null}
      {selectedEntries.length >= 2 && compatible && !loadError && loaded.length !== selectedEntries.length ? <PerformanceHistorySkeleton /> : null}
    </>}
  </div>
}
