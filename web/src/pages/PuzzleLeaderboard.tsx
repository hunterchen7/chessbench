import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { BarChart3, CircleDollarSign, Database, Layers3 } from "lucide-react"
import { useData } from "@/lib/useData"
import { loadSuiteCatalog, type SuiteCatalog } from "@/lib/data"
import { isModelVariant } from "@/lib/participants"
import { MODES, type ModeNumber } from "@/lib/format"
import { PuzzleNav } from "@/components/PuzzleNav"
import { PuzzleRunMatrix } from "@/components/PuzzleRunMatrix"
import { SuiteDescriptor } from "@/components/SuiteDescriptor"
import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type Mode = ModeNumber

export function PuzzleLeaderboard() {
  const { runs } = useData()
  const [searchParams, setSearchParams] = useSearchParams()
  const [suiteCatalog, setSuiteCatalog] = useState<SuiteCatalog | null>(null)
  const updateSearchParams = useCallback((update: (next: URLSearchParams) => void) => setSearchParams((current) => {
    const next = new URLSearchParams(current)
    update(next)
    return next
  }, { replace: true }), [setSearchParams])

  useEffect(() => {
    let active = true
    void loadSuiteCatalog().then((next) => {
      if (active) setSuiteCatalog(next)
    }).catch(() => {
      if (active) setSuiteCatalog({ schema: "chessbench.suite_catalog.v2", suites: [] })
    })
    return () => { active = false }
  }, [])

  const standard = useMemo(() => runs.filter((run) => run.track === "puzzle" && run.status === "completed" && isModelVariant(run.model_variant)), [runs])
  const suites = useMemo(() => (suiteCatalog?.suites ?? [])
    .filter((entry) => /^standard-lichess-v\d+$/.test(entry.name))
    .toSorted((a, b) => Number(Boolean(b.current)) - Number(Boolean(a.current)) || Number(b.name.match(/v(\d+)$/)?.[1] ?? 0) - Number(a.name.match(/v(\d+)$/)?.[1] ?? 0)), [suiteCatalog])
  const requestedSuite = searchParams.get("suite")
  const currentSuite = suites.find((entry) => entry.current) ?? suites[0]
  const activeSuite = requestedSuite && suites.some((entry) => entry.name === requestedSuite) ? requestedSuite : currentSuite?.name || "standard-lichess-v3"
  const requestedModes = searchParams.get("modes")?.split(",").map(Number).filter((value): value is Mode => MODES.some((mode) => mode.n === value)) ?? []
  const visibleModes = requestedModes.length ? MODES.map((mode) => mode.n).filter((mode) => requestedModes.includes(mode)) : MODES.map((mode) => mode.n)
  const openModels = searchParams.getAll("open")
  const suiteRuns = useMemo(() => standard.filter((run) => run.suite?.name === activeSuite), [standard, activeSuite])

  const totals = useMemo(() => ({
    models: new Set(suiteRuns.map((run) => run.model_variant.key)).size,
    runs: suiteRuns.length,
    attempts: suiteRuns.reduce((sum, run) => sum + run.progress.completed, 0),
    cost: suiteRuns.reduce((sum, run) => sum + (run.summary.cost_usd ?? 0), 0),
  }), [suiteRuns])

  const setSuite = (value: string) => updateSearchParams((next) => next.set("suite", value))
  const setOpenModels = (values: string[]) => updateSearchParams((next) => {
    next.delete("open")
    values.forEach((value) => next.append("open", value))
  })
  const setVisibleModes = (modes: Mode[]) => updateSearchParams((next) => {
    if (modes.length === MODES.length) next.delete("modes")
    else next.set("modes", modes.join(","))
  })

  return (
    <div className="space-y-8">
      <section className="grid gap-6 border-b border-border/70 pb-8 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300"><BarChart3 className="size-4" /> Standard tactics</div>
          <h1 className="text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">Puzzle leaderboard</h1>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-muted-foreground">
            Compare every model across four board-information and coaching methods. Points decide performance within a run; Bayesian Puzzle Elo estimates the source-puzzle rating at which the model would score about 50%, with rating deviation preserving uncertainty.
          </p>
        </div>
        <div className="grid gap-3 lg:justify-items-end">
          <div className="w-full lg:w-[22rem]">
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Benchmark suite</div>
            <Select value={activeSuite} onValueChange={setSuite}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {suites.map((entry) => <SelectItem key={entry.name} value={entry.name}>
                  {entry.name} · {entry.items} puzzles{entry.current ? " · current" : ""}
                </SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <PuzzleNav count={currentSuite?.items ?? 250} />
        </div>
      </section>

      <SuiteDescriptor name={activeSuite} />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card><CardContent className="flex items-center gap-4 pt-6"><BarChart3 className="size-5 text-emerald-600" /><div><div className="font-mono text-2xl font-semibold">{totals.models.toLocaleString()}</div><div className="text-xs text-muted-foreground">model configurations</div></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-4 pt-6"><Layers3 className="size-5 text-amber-500" /><div><div className="font-mono text-2xl font-semibold">{totals.runs.toLocaleString()}</div><div className="text-xs text-muted-foreground">completed benchmark runs</div></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-4 pt-6"><Database className="size-5 text-violet-600" /><div><div className="font-mono text-2xl font-semibold">{totals.attempts.toLocaleString()}</div><div className="text-xs text-muted-foreground">completed puzzle attempts</div></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-4 pt-6"><CircleDollarSign className="size-5 text-sky-600" /><div><div className="font-mono text-2xl font-semibold">${totals.cost.toFixed(2)}</div><div className="text-xs text-muted-foreground">cost across all runs</div></div></CardContent></Card>
      </section>

      <section>
        <PuzzleRunMatrix
          runs={suiteRuns}
          suite={activeSuite}
          visibleModes={visibleModes}
          onVisibleModesChange={setVisibleModes}
          openModels={openModels}
          onOpenModelsChange={setOpenModels}
        />
      </section>
    </div>
  )
}
