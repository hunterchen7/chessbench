import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { BarChart3, CircleDollarSign, Database, Gauge, Layers3 } from "lucide-react"
import { useData } from "@/lib/useData"
import { loadSuiteCatalog, type SuiteCatalog } from "@/lib/data"
import { isModelVariant } from "@/lib/participants"
import { MODES, type ModeNumber } from "@/lib/format"
import { PuzzleNav } from "@/components/PuzzleNav"
import { PuzzleRunMatrix } from "@/components/PuzzleRunMatrix"
import { CompareTray } from "@/components/CompareTray"
import { SuiteDescriptor } from "@/components/SuiteDescriptor"
import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { normalizeComparisonIds } from "@/lib/runComparison"
import { cn } from "@/lib/utils"
import { AdaptivePuzzleLeaderboard } from "@/components/AdaptivePuzzleLeaderboard"
import { Button } from "@/components/ui/button"

type Mode = ModeNumber

function PuzzleViewButtons({ view, onShowRated, onShowFixed, puzzleCount }: { view: "rated" | "fixed"; onShowRated: () => void; onShowFixed: () => void; puzzleCount?: number }) {
  return <div className="flex flex-wrap gap-2 lg:justify-end">
    <Button size="sm" variant={view === "rated" ? "default" : "outline"} className="h-10 w-40" onClick={onShowRated}><Gauge /> Rated leaderboard</Button>
    <Button size="sm" variant={view === "fixed" ? "default" : "outline"} className="h-10 w-36" onClick={onShowFixed}><Layers3 /> Fixed suite lab</Button>
    <PuzzleNav count={puzzleCount} hideLeaderboard />
  </div>
}

function FixedPuzzleLeaderboard({ onShowRated }: { onShowRated: () => void }) {
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
  const activeSuiteEntry = suites.find((entry) => entry.name === activeSuite)
  const requestedModes = searchParams.get("modes")?.split(",").map(Number).filter((value): value is Mode => MODES.some((mode) => mode.n === value)) ?? []
  const visibleModes = requestedModes.length ? MODES.map((mode) => mode.n).filter((mode) => requestedModes.includes(mode)) : MODES.map((mode) => mode.n)
  const openModels = searchParams.getAll("open")
  const suiteRuns = useMemo(() => standard.filter((run) => run.suite?.name === activeSuite), [standard, activeSuite])
  const comparisonIds = normalizeComparisonIds(searchParams.getAll("compare")).filter((id) => suiteRuns.some((run) => run.run_id === id))
  const comparisonRuns = comparisonIds.flatMap((id) => suiteRuns.find((run) => run.run_id === id) ? [suiteRuns.find((run) => run.run_id === id)!] : [])

  const totals = useMemo(() => ({
    models: new Set(suiteRuns.map((run) => run.model_variant.key)).size,
    runs: suiteRuns.length,
    solves: suiteRuns.reduce((sum, run) => sum + run.summary.solved, 0),
    attempts: suiteRuns.reduce((sum, run) => sum + run.progress.completed, 0),
    cost: suiteRuns.reduce((sum, run) => sum + (run.summary.cost_usd ?? 0), 0),
  }), [suiteRuns])

  const setSuite = (value: string) => updateSearchParams((next) => { next.set("suite", value); next.delete("compare") })
  const setOpenModels = (values: string[]) => updateSearchParams((next) => {
    next.delete("open")
    values.forEach((value) => next.append("open", value))
  })
  const setVisibleModes = (modes: Mode[]) => updateSearchParams((next) => {
    if (modes.length === MODES.length) next.delete("modes")
    else next.set("modes", modes.join(","))
  })
  const setComparisonIds = (ids: string[]) => updateSearchParams((next) => {
    next.delete("compare")
    normalizeComparisonIds(ids).forEach((id) => next.append("compare", id))
  })

  return (
    <div className={cn("space-y-8", comparisonRuns.length && "pb-28")}>
      <section className="grid gap-6 border-b border-border/70 pb-8 lg:min-h-[14.25rem] lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div>
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300"><BarChart3 className="size-4" /> Standard tactics</div>
          <h1 className="text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">Puzzle leaderboard</h1>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-muted-foreground">
            Compare every model across four board-information and coaching methods. Points decide performance within a run; Bayesian Puzzle Elo estimates the source-puzzle rating at which the model would score about 50%, with rating deviation preserving uncertainty.
          </p>
        </div>
        <div className="grid w-full gap-3 lg:justify-items-end lg:pt-[4.75rem]">
          <div className="w-full lg:w-[22rem]">
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Benchmark dataset</div>
            <Select value={activeSuite} onValueChange={(value) => { if (value === "rated") onShowRated(); else setSuite(value) }}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="rated">Adaptive rating · current</SelectItem>
                {suites.map((entry) => <SelectItem key={entry.name} value={entry.name}>
                  {entry.name} · {entry.items} puzzles{entry.current ? " · current" : ""}
                </SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <PuzzleViewButtons view="fixed" onShowRated={onShowRated} onShowFixed={() => {}} puzzleCount={activeSuiteEntry?.items ?? currentSuite?.items ?? 250} />
        </div>
      </section>

      <SuiteDescriptor name={activeSuite} />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card><CardContent className="flex items-center gap-4 pt-6"><BarChart3 className="size-5 text-emerald-600" /><div><div className="font-mono text-2xl font-semibold">{totals.models.toLocaleString()}</div><div className="text-xs text-muted-foreground">model configurations</div></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-4 pt-6"><Layers3 className="size-5 text-amber-500" /><div><div className="font-mono text-2xl font-semibold">{totals.runs.toLocaleString()}</div><div className="text-xs text-muted-foreground">completed benchmark runs</div></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-4 pt-6"><Database className="size-5 text-violet-600" /><div><div className="font-mono text-2xl font-semibold tabular-nums">{totals.solves.toLocaleString()} / {totals.attempts.toLocaleString()}</div><div className="text-xs text-muted-foreground">full solves / completed attempts</div></div></CardContent></Card>
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
          comparisonRunIds={comparisonIds}
          onComparisonRunIdsChange={setComparisonIds}
        />
      </section>
      <CompareTray runs={comparisonRuns} onRemove={(id) => setComparisonIds(comparisonIds.filter((candidate) => candidate !== id))} onClear={() => setComparisonIds([])} />
    </div>
  )
}

export function PuzzleLeaderboard() {
  const { runs } = useData()
  const [searchParams, setSearchParams] = useSearchParams()
  const fixed = searchParams.get("view") === "fixed"
  const [fallbackPhase, setFallbackPhase] = useState<"idle" | "out" | "in">("idle")
  const fallbackTimer = useRef<number | null>(null)
  const transitioning = useRef(false)
  const fixedSuiteOptions = useMemo(() => {
    const byName = new Map<string, number>()
    runs.forEach((run) => {
      const name = run.suite?.name
      if (run.track !== "puzzle" || run.status !== "completed" || !name || !/^standard-lichess-v\d+$/.test(name)) return
      byName.set(name, Math.max(byName.get(name) ?? 0, run.progress.total))
    })
    return Array.from(byName, ([name, items]) => ({ name, items })).toSorted((a, b) =>
      Number(b.name.match(/v(\d+)$/)?.[1] ?? 0) - Number(a.name.match(/v(\d+)$/)?.[1] ?? 0),
    )
  }, [runs])
  useEffect(() => () => {
    if (fallbackTimer.current != null) window.clearTimeout(fallbackTimer.current)
  }, [])

  const transitionTo = useCallback((update: (next: URLSearchParams) => void) => {
    if (transitioning.current) return
    const navigate = (viewTransition: boolean) => setSearchParams((current) => {
      const next = new URLSearchParams(current)
      update(next)
      return next
    }, { replace: true, viewTransition })

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      navigate(false)
      return
    }
    if (typeof document.startViewTransition === "function") {
      navigate(true)
      return
    }

    transitioning.current = true
    setFallbackPhase("out")
    fallbackTimer.current = window.setTimeout(() => {
      navigate(false)
      setFallbackPhase("in")
      fallbackTimer.current = window.setTimeout(() => {
        setFallbackPhase("idle")
        transitioning.current = false
        fallbackTimer.current = null
      }, 220)
    }, 160)
  }, [setSearchParams])

  const setView = (view: "rated" | "fixed") => transitionTo((next) => {
    if (view === "fixed") next.set("view", "fixed")
    else {
      next.delete("view")
      next.delete("suite")
    }
  })
  const openFixedSuite = (suite: string) => transitionTo((next) => {
    next.set("view", "fixed")
    next.set("suite", suite)
    next.delete("compare")
  })

  const transitionClass = cn(
    "puzzle-view-transition",
    fallbackPhase === "out" && "puzzle-view-fallback-out",
    fallbackPhase === "in" && "puzzle-view-fallback-in",
  )
  if (fixed) return <div key="fixed" className={transitionClass}><FixedPuzzleLeaderboard onShowRated={() => setView("rated")} /></div>
  return <div key="rated" className={cn(transitionClass, "space-y-8")}>
    <section className="grid gap-6 border-b border-border/70 pb-8 lg:min-h-[14.25rem] lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
      <div>
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300"><Gauge className="size-4" /> Standard tactics</div>
        <h1 className="text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">Puzzle rating leaderboard</h1>
        <p className="mt-4 max-w-3xl text-base leading-relaxed text-muted-foreground">A Lichess-inspired adaptive rating: each model plays calibrated puzzles near its current strength until uncertainty settles. The headline test uses one unassisted, UCI-only prompt protocol.</p>
      </div>
      <div className="grid w-full gap-3 lg:w-auto lg:justify-items-end lg:pt-[4.75rem]">
        {fixedSuiteOptions.length > 0 ? <div className="w-full lg:w-[22rem]">
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">Benchmark dataset</div>
          <Select value="rated" onValueChange={(value) => { if (value !== "rated") openFixedSuite(value) }}>
            <SelectTrigger className="w-full bg-background"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="rated">Adaptive rating · current</SelectItem>
              {fixedSuiteOptions.map((suite) => <SelectItem key={suite.name} value={suite.name}>{suite.name} · {suite.items} puzzles</SelectItem>)}
            </SelectContent>
          </Select>
        </div> : null}
        <PuzzleViewButtons view="rated" onShowRated={() => setView("rated")} onShowFixed={() => setView("fixed")} puzzleCount={fixedSuiteOptions[0]?.items} />
      </div>
    </section>
    <AdaptivePuzzleLeaderboard runs={runs} />
  </div>
}
