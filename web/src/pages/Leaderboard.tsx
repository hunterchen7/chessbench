import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Activity, ArrowRight, ListChecks, Sparkles, Swords, Trophy, Users } from "lucide-react"
import { useData } from "@/lib/useData"
import type { RunIndexEntry } from "@/lib/data"
import { MODES, modeInfo, pct, pointsText, responseStyleInfo, type ResponseStyleKey } from "@/lib/format"
import { fetchHumanLeaderboard, type HumanRow } from "@/lib/backend"
import { isModelVariant } from "@/lib/participants"
import { ModelIdentity } from "@/components/ModelIdentity"
import { ResponseStyleBadge, ResponseStyleToggle } from "@/components/ResponseStyle"
import { ExportButton } from "@/components/ExportButton"
import { SortableTableHead, type SortDirection } from "@/components/SortableTableHead"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type Mode = 1 | 2 | 3
type ModeMap = Partial<Record<Mode, RunIndexEntry>>
type SortKey = "model" | "rating" | "points" | "solved" | "legal" | "cost" | `mode-${Mode}`

const puzzleRating = (run: RunIndexEntry) => run.summary.puzzle_performance_rating

const puzzleRatingText = (run: RunIndexEntry) => {
  const estimate = puzzleRating(run)
  if (!estimate) return "—"
  if (!estimate.bounded) return estimate.rating <= 0 ? "< 0" : "> 4000"
  return String(Math.round(estimate.rating))
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="border-l border-border/70 pl-4 first:border-l-0 first:pl-0">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{note}</div>
    </div>
  )
}

const TRACKS = [
  { to: "/puzzles", icon: ListChecks, label: "Standard", copy: "Independent move-finding under three prompt scaffolds.", tone: "text-emerald-600" },
  { to: "/woodpecker", icon: Activity, label: "Woodpecker", copy: "One response must calculate the complete forced line.", tone: "text-violet-600" },
  { to: "/esoteric", icon: Sparkles, label: "Esoteric", copy: "Selfmates, helpmates, proof games, and studies.", tone: "text-amber-600" },
  { to: "/games", icon: Swords, label: "Games", copy: "Stateful head-to-head play with match-point standings.", tone: "text-rose-600" },
]

export function Leaderboard() {
  const { runs, tournaments, apiBase } = useData()
  const [view, setView] = useState<"compare" | "1" | "2" | "3">("2")
  const [responseStyle, setResponseStyle] = useState<ResponseStyleKey>("json_rationale")
  const [humans, setHumans] = useState<HumanRow[]>([])
  const standard = useMemo(() => runs.filter((run) => run.track === "puzzle" && run.status === "completed" && isModelVariant(run.model_variant)), [runs])
  const suites = useMemo(() => Array.from(new Set(standard.map((run) => run.suite?.name).filter(Boolean))) as string[], [standard])
  const [suite, setSuite] = useState("")
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({ key: "mode-2", direction: "desc" })
  const activeSuite = suite || suites[0] || ""

  useEffect(() => {
    if (apiBase) void fetchHumanLeaderboard(apiBase).then(setHumans)
  }, [apiBase])

  const byVariant = useMemo(() => {
    const grouped = new Map<string, ModeMap>()
    for (const run of standard) {
      if (activeSuite && run.suite?.name !== activeSuite) continue
      if (responseStyleInfo(run.condition).key !== responseStyle) continue
      const mode = modeInfo(run.condition)
      if (!mode) continue
      const record = grouped.get(run.model_variant.key) ?? {}
      const current = record[mode.n]
      if (!current || run.progress.completed > current.progress.completed || run.created > current.created) record[mode.n] = run
      grouped.set(run.model_variant.key, record)
    }
    return grouped
  }, [standard, activeSuite, responseStyle])

  const rows = useMemo(() => Array.from(byVariant.entries()).map(([key, modes]) => {
    const anchor = modes[2] ?? modes[3] ?? modes[1]!
    return { key, modes, anchor }
  }).filter((row) => row.anchor), [byVariant])

  const compareRows = useMemo(() => rows.toSorted((a, b) => {
    const multiplier = sort.direction === "asc" ? 1 : -1
    if (sort.key === "model") return a.anchor.model_variant.display_name.localeCompare(b.anchor.model_variant.display_name) * multiplier
    const mode = sort.key.startsWith("mode-") ? Number(sort.key.slice(5)) as Mode : 2
    return ((a.modes[mode]?.summary.points ?? -1) - (b.modes[mode]?.summary.points ?? -1)) * multiplier
  }), [rows, sort.key, sort.direction])

  const single = useMemo(() => {
    if (view === "compare") return []
    const mode = Number(view) as Mode
    const values = rows.flatMap((row) => row.modes[mode] ? [row.modes[mode]!] : [])
    const multiplier = sort.direction === "asc" ? 1 : -1
    return values.toSorted((a, b) => {
      let comparison = 0
      if (sort.key === "model") comparison = a.model_variant.display_name.localeCompare(b.model_variant.display_name)
      else if (sort.key === "rating") comparison = (puzzleRating(a)?.rating ?? -1) - (puzzleRating(b)?.rating ?? -1)
      else if (sort.key === "solved") comparison = a.summary.solve_rate - b.summary.solve_rate
      else if (sort.key === "legal") comparison = a.summary.first_move_legal_rate - b.summary.first_move_legal_rate
      else if (sort.key === "cost") comparison = (a.summary.cost_usd ?? Number.POSITIVE_INFINITY) - (b.summary.cost_usd ?? Number.POSITIVE_INFINITY)
      else comparison = a.summary.points - b.summary.points
      return comparison * multiplier || b.summary.points - a.summary.points
    })
  }, [rows, view, sort.key, sort.direction])

  const toggleSort = (key: SortKey, defaultDirection: SortDirection = "desc") => setSort((current) => ({
    key,
    direction: current.key === key ? (current.direction === "asc" ? "desc" : "asc") : defaultDirection,
  }))

  const modelRuns = runs.filter((run) => isModelVariant(run.model_variant))
  const baseModels = new Set(modelRuns.map((run) => run.model_variant.base_key)).size
  const completed = modelRuns.filter((run) => run.status === "completed").length
  const active = modelRuns.filter((run) => run.status === "running" || run.status === "partial")
  const cost = modelRuns.reduce((sum, run) => sum + (run.summary.cost_usd ?? 0), 0)

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
            A points-first, tool-free evaluation across tactical puzzles, full-line calculation, composed problems,
            and stateful games. Every prompt condition and reasoning budget stays visible.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4 xl:grid-cols-2">
          <Stat label="Base models" value={String(baseModels)} note="budget variants separate" />
          <Stat label="Completed runs" value={String(completed)} note={`${runs.length} total manifests`} />
          <Stat label="Game sets" value={String(tournaments.length)} note="match-point scoring" />
          <Stat label="Recorded cost" value={`$${cost.toFixed(2)}`} note="provider-reported" />
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
          <Link to="/puzzles" className="group inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
            Explore the full leaderboard <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>

        <Card className="gap-0 overflow-hidden border-border/70 py-0">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b bg-muted/25 px-4 py-3.5">
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Response</div>
                <ResponseStyleToggle value={responseStyle} onChange={setResponseStyle} />
              </div>
              <div className="space-y-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Prompt method</div>
                <Tabs value={view} onValueChange={(value) => { setView(value as typeof view); if (value === "compare") setSort({ key: "mode-2", direction: "desc" }); else setSort({ key: "points", direction: "desc" }) }}>
                  <TabsList className="h-8 border bg-background p-0.5 shadow-xs">
                    <TabsTrigger value="compare" className="h-6 px-2.5 text-xs">All modes</TabsTrigger>
                    {MODES.map((mode) => <TabsTrigger key={mode.n} value={String(mode.n)} title={mode.blurb} className="h-6 px-2.5 text-xs">{mode.n}. {mode.name}</TabsTrigger>)}
                  </TabsList>
                </Tabs>
              </div>
              {suites.length > 1 && <div className="space-y-1.5"><div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Suite</div><Select value={activeSuite} onValueChange={setSuite}><SelectTrigger size="sm" className="w-48 bg-background"><SelectValue /></SelectTrigger><SelectContent>{suites.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent></Select></div>}
            </div>
            <ExportButton track="puzzle" responseStyle={responseStyle} suite={activeSuite} mode={view === "compare" ? undefined : Number(view)} status="completed" label={view === "compare" ? "Export comparison" : `Export ${MODES.find((mode) => String(mode.n) === view)?.name ?? "view"}`} />
          </div>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="w-12 text-center">#</TableHead><SortableTableHead label="Model configuration" active={sort.key === "model"} direction={sort.direction} onSort={() => toggleSort("model", "asc")} />
                {view === "compare" ? MODES.map((mode) => <SortableTableHead key={mode.n} label={mode.name} active={sort.key === `mode-${mode.n}`} direction={sort.direction} align="right" onSort={() => toggleSort(`mode-${mode.n}`)} />) : <><SortableTableHead label="Puzzle Elo" active={sort.key === "rating"} direction={sort.direction} align="right" onSort={() => toggleSort("rating")} /><SortableTableHead label="Points" active={sort.key === "points"} direction={sort.direction} align="right" onSort={() => toggleSort("points")} /><SortableTableHead label="Full solves" active={sort.key === "solved"} direction={sort.direction} align="right" onSort={() => toggleSort("solved")} /><SortableTableHead label="Legal first" active={sort.key === "legal"} direction={sort.direction} align="right" onSort={() => toggleSort("legal")} /><SortableTableHead label="Cost" active={sort.key === "cost"} direction={sort.direction} align="right" onSort={() => toggleSort("cost", "asc")} /></>}
              </TableRow></TableHeader>
              <TableBody>
                {(view === "compare" ? compareRows : single.map((run) => ({ key: run.model, modes: {} as ModeMap, anchor: run }))).map((row, index) => {
                  const run = row.anchor
                  const estimate = puzzleRating(run)
                  return <TableRow key={row.key} className="group transition-colors hover:bg-muted/30">
                    <TableCell className="text-center font-mono text-xs text-muted-foreground">{index === 0 ? <Trophy className="mx-auto size-4 text-amber-500" /> : index + 1}</TableCell>
                    <TableCell><Link to={`/model/${encodeURIComponent(run.model_variant.key)}`} className="block cursor-pointer rounded-md focus-visible:ring-2 focus-visible:ring-ring/60"><ModelIdentity variant={run.model_variant} /></Link></TableCell>
                    {view === "compare" ? MODES.map((mode) => {
                      const cell = row.modes[mode.n]
                      return <TableCell key={mode.n} className="text-right">{cell ? <><div className="font-mono font-semibold tabular-nums">{pointsText(cell.summary)}</div><div className="text-[11px] text-muted-foreground">{pct(cell.summary.solve_rate)} solved</div></> : <span className="text-muted-foreground">—</span>}</TableCell>
                    }) : <><TableCell className="text-right"><div className="font-mono font-semibold tabular-nums">{puzzleRatingText(run)}</div><div className="text-[11px] text-muted-foreground">{estimate?.ci95 ? `95% ${Math.round(estimate.ci95[0])}–${Math.round(estimate.ci95[1])}` : "not estimated"}</div></TableCell><TableCell className="text-right font-mono font-semibold">{pointsText(run.summary)}</TableCell><TableCell className="text-right tabular-nums">{run.summary.solved}/{run.summary.n}</TableCell><TableCell className="text-right tabular-nums text-muted-foreground">{pct(run.summary.first_move_legal_rate)}</TableCell><TableCell className="text-right font-mono text-xs text-muted-foreground">{run.summary.cost_usd == null ? "—" : `$${run.summary.cost_usd.toFixed(3)}`}</TableCell></>}
                  </TableRow>
                })}
                {(view === "compare" ? compareRows.length : single.length) === 0 && <TableRow><TableCell colSpan={view === "compare" ? 5 : 8} className="py-14 text-center"><div className="font-medium">No {responseStyle === "move_only" ? "move-only" : "rationale"} runs yet</div><div className="mt-1 text-sm text-muted-foreground">This response-style cell is ready for a published run.</div></TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/15 px-4 py-2.5 text-[11px] text-muted-foreground">
            <span>{view === "compare" ? compareRows.length : single.length} model configuration{(view === "compare" ? compareRows.length : single.length) === 1 ? "" : "s"}</span>
            <span>{responseStyle === "move_only" ? "Move only" : "Rationale"} · {view === "compare" ? "all prompt methods" : MODES.find((mode) => String(mode.n) === view)?.name}</span>
          </div>
        </Card>
      </section>

      {humans.length > 0 && <section>
        <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Users className="size-4" /> Human puzzle points</CardTitle><CardDescription>Optional browser solves, ranked by verified points.</CardDescription></CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{humans.slice(0, 6).map((human, index) => <div key={`${human.handle}-${index}`} className="flex items-center justify-between rounded-lg border p-3"><div><div className="text-sm font-medium">{human.handle || `anon #${index + 1}`}</div><div className="text-xs text-muted-foreground">{human.solved} solved · {pct(human.accuracy)}</div></div><div className="font-mono font-semibold">{human.points}/{human.max_points}</div></div>)}</CardContent>
        </Card>
      </section>}
    </div>
  )
}
