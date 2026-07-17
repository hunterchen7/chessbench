import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Activity, ArrowRight, ListChecks, Sparkles, Swords, Trophy, Users } from "lucide-react"
import { useData } from "@/lib/useData"
import { MODES, pct, type ModeNumber } from "@/lib/format"
import { fetchHumanLeaderboard, type HumanRow } from "@/lib/backend"
import { isModelVariant } from "@/lib/participants"
import { isVisibleUiTrack } from "@/lib/uiTracks"
import { ResponseStyleBadge } from "@/components/ResponseStyle"
import { PuzzleRunMatrix } from "@/components/PuzzleRunMatrix"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="border-l border-border/70 pl-4 first:border-l-0 first:pl-0">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-3xl font-semibold tabular-nums tracking-[-0.04em] sm:text-4xl">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{note}</div>
    </div>
  )
}

const TRACKS = [
  { to: "/puzzles", icon: ListChecks, label: "Standard", copy: "Independent move-finding under four prompt scaffolds.", tone: "text-emerald-600" },
  { to: "/esoteric", icon: Sparkles, label: "Esoteric", copy: "Selfmates, helpmates, proof games, and studies.", tone: "text-amber-600" },
  { to: "/games", icon: Swords, label: "Games", copy: "Stateful head-to-head play with match-point standings.", tone: "text-rose-600" },
]

export function Leaderboard() {
  const { runs, apiBase } = useData()
  const [humans, setHumans] = useState<HumanRow[]>([])
  const standard = useMemo(() => runs.filter((run) => run.track === "puzzle" && run.status === "completed" && isModelVariant(run.model_variant)), [runs])
  const suites = useMemo(() => (Array.from(new Set(standard.map((run) => run.suite?.name).filter(Boolean))) as string[]).toSorted((a, b) => {
    const aVersion = Number(a.match(/v(\d+)$/)?.[1] ?? 0)
    const bVersion = Number(b.match(/v(\d+)$/)?.[1] ?? 0)
    return bVersion - aVersion || b.localeCompare(a)
  }), [standard])
  const [suite, setSuite] = useState("")
  const [visibleModes, setVisibleModes] = useState<ModeNumber[]>(() => MODES.map((mode) => mode.n))
  const [openModels, setOpenModels] = useState<string[]>([])
  const activeSuite = suite || suites[0] || ""
  const suiteRuns = useMemo(() => standard.filter((run) => run.suite?.name === activeSuite), [standard, activeSuite])

  useEffect(() => {
    if (apiBase) void fetchHumanLeaderboard(apiBase).then(setHumans)
  }, [apiBase])

  const modelRuns = runs.filter((run) => isVisibleUiTrack(run.track) && isModelVariant(run.model_variant))
  const completed = modelRuns.filter((run) => run.status === "completed").length
  const active = modelRuns.filter((run) => run.status === "running" || run.status === "partial")
  const cost = modelRuns.reduce((sum, run) => sum + (run.summary.cost_usd ?? 0), 0)
  const puzzleRuns = modelRuns.filter((run) => run.track === "puzzle")
  const puzzleAttempts = puzzleRuns.reduce((sum, run) => sum + run.progress.completed, 0)
  const fullSolves = puzzleRuns.reduce((sum, run) => sum + run.summary.solved, 0)

  return (
    <div className="space-y-10">
      <section className="grid gap-8 border-b border-border/70 pb-8 xl:grid-cols-[1fr_520px] xl:items-end">
        <div>
          <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">
            <span className="size-1.5 rounded-full bg-emerald-500" /> {apiBase ? "Cloudflare live dataset" : "Static benchmark snapshot"}
          </div>
          <h1 className="max-w-4xl text-4xl font-semibold leading-[1.05] tracking-[-0.045em] sm:text-6xl">
            How well do language models actually <span className="text-muted-foreground">understand chess?</span>
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            A points-first, tool-free evaluation across tactical puzzles, composed problems, and stateful games.
            Every prompt condition and reasoning budget stays visible.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4 xl:grid-cols-2">
          <Stat label="Puzzle attempts" value={puzzleAttempts.toLocaleString()} note="completed across all runs" />
          <Stat label="Full solves" value={fullSolves.toLocaleString()} note="entire puzzle lines correct" />
          <Stat label="Completed runs" value={completed.toLocaleString()} note={`${modelRuns.length} visible manifests`} />
          <Stat label="Recorded cost" value={`$${cost.toFixed(2)}`} note="provider-reported" />
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        {TRACKS.map(({ to, icon: Icon, label, copy, tone }) => (
          <Link key={to} to={to} className="group">
            <Card className="h-full border-border/70 bg-card/70 transition-all group-hover:-translate-y-0.5 group-hover:border-foreground/30 group-hover:shadow-lg">
              <CardContent className="flex h-full items-start gap-4 pt-6">
                <Icon className={`mt-0.5 size-5 shrink-0 ${tone}`} />
                <div>
                  <div className="flex items-center gap-2 font-semibold">{label} <ArrowRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" /></div>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{copy}</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </section>

      {active.length > 0 && (
        <section className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><Activity className="size-4 text-amber-600" /> Runs with durable progress</div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {active.slice(0, 6).map((run) => {
              const ratio = run.progress.total ? run.progress.completed / run.progress.total : 0
              return <div key={run.run_id} className="rounded-lg border bg-background/70 p-3">
                <div className="flex items-center justify-between gap-3"><span className="truncate text-sm font-medium">{run.model_variant.display_name}</span><Badge variant="outline">{run.status}</Badge></div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full bg-amber-500" style={{ width: `${ratio * 100}%` }} /></div>
                <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground"><ResponseStyleBadge condition={run.condition} compact /><span>{run.progress.completed}/{run.progress.total}</span></div>
              </div>
            })}
          </div>
        </section>
      )}

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-4xl">
            <div className="flex items-center gap-2"><Trophy className="size-4 text-amber-500" /><h2 className="text-xl font-semibold tracking-tight">Standard puzzle leaderboard</h2></div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">Compare Puzzle Elo and points across board-information methods. Each puzzle keeps its own isolated conversation across moves; changing methods changes the board assistance, not the model's memory.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {suites.length > 1 && <Select value={activeSuite} onValueChange={(value) => { setSuite(value); setOpenModels([]) }}>
              <SelectTrigger size="sm" className="w-52 bg-background" aria-label="Benchmark suite"><SelectValue /></SelectTrigger>
              <SelectContent>{suites.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent>
            </Select>}
            <Link to="/puzzles" className="group inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              Explore the full leaderboard <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
        <PuzzleRunMatrix
          runs={suiteRuns}
          suite={activeSuite}
          visibleModes={visibleModes}
          onVisibleModesChange={setVisibleModes}
          openModels={openModels}
          onOpenModelsChange={setOpenModels}
          exportLabel="Export this suite"
        />
      </section>

      {humans.length > 0 && <section>
        <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Users className="size-4" /> Human puzzle points</CardTitle><CardDescription>Optional browser solves, ranked by verified points.</CardDescription></CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{humans.slice(0, 6).map((human, index) => <div key={`${human.handle}-${index}`} className="flex items-center justify-between rounded-lg border p-3"><div><div className="text-sm font-medium">{human.handle || `anon #${index + 1}`}</div><div className="text-xs text-muted-foreground">{human.solved} solved · {pct(human.accuracy)}</div></div><div className="font-mono font-semibold">{human.points}/{human.max_points}</div></div>)}</CardContent>
        </Card>
      </section>}
    </div>
  )
}
