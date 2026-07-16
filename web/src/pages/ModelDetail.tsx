import { Fragment, useEffect, useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { ArrowLeft, Check, ChevronDown, CircleDollarSign, Database, Gauge, Scale, X } from "lucide-react"
import { useData } from "@/lib/useData"
import { loadRun, type PuzzleItem, type Run } from "@/lib/data"
import { MODES, modeInfo, pct, pointsText, RESPONSE_STYLES, responseStyleInfo, TIER_ORDER } from "@/lib/format"
import { puzzleContinuation, puzzleModelAttempts, uciLineToSan, type PuzzleContinuationPly } from "@/lib/chess"
import { puzzlePerformanceRating } from "@/lib/puzzleRating"
import { ModelIdentity } from "@/components/ModelIdentity"
import { ResponseStyleBadge } from "@/components/ResponseStyle"
import { ExportButton } from "@/components/ExportButton"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

function Stat({ label, value, note, icon: Icon }: { label: string; value: string; note: string; icon: typeof Scale }) {
  return <Card><CardContent className="flex items-start gap-3 pt-6"><Icon className="mt-1 size-4 text-muted-foreground" /><div><div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-1 font-mono text-2xl font-semibold tabular-nums">{value}</div><div className="mt-0.5 text-xs text-muted-foreground">{note}</div></div></CardContent></Card>
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

function PerformanceHistory({ items, maxPoints }: { items: PuzzleItem[]; maxPoints: number }) {
  const history = useMemo(() => {
    let points = 0
    const prefix: PuzzleItem[] = []
    return items.map((item) => {
      points += item.score
      prefix.push(item)
      const estimate = puzzlePerformanceRating(prefix)
      return { item: item.puzzle_id, points, elo: estimate.bounded ? estimate.rating : null }
    })
  }, [items])
  if (!history.length) return null

  const eloValues = history.flatMap((point) => point.elo == null ? [] : [point.elo])
  const eloMin = eloValues.length ? Math.floor((Math.min(...eloValues) - 50) / 100) * 100 : 0
  const rawMax = eloValues.length ? Math.ceil((Math.max(...eloValues) + 50) / 100) * 100 : 4000
  const eloMax = Math.max(eloMin + 200, rawMax)
  const linePoints = history.flatMap((point, index) => point.elo == null ? [] : [
    `${history.length === 1 ? 500 : index / (history.length - 1) * 1000},${116 - (point.elo - eloMin) / (eloMax - eloMin) * 100}`,
  ]).join(" ")
  const final = history.at(-1)!
  const finalElo = history.findLast((point) => point.elo != null)?.elo ?? null
  const firstEloIndex = history.findIndex((point) => point.elo != null)
  const pointsScale = Math.max(1, final.points)

  return <Card>
    <CardHeader className="space-y-1">
      <CardTitle className="text-base">Performance over suite</CardTitle>
      <p className="text-xs text-muted-foreground">Cumulative points and complete-solve puzzle Elo after each puzzle in fixed suite order.</p>
    </CardHeader>
    <CardContent className="grid gap-5 lg:grid-cols-2">
      <div>
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Points accumulation</div>
        <div className="flex h-32 items-end gap-px overflow-hidden rounded-lg border bg-secondary/30 p-3" aria-label="Cumulative points by puzzle">{history.map((point, index) => <div key={point.item} title={`${point.item}: ${point.points.toFixed(2)} points`} className="min-w-0 flex-1 bg-emerald-500/70 transition-colors hover:bg-emerald-500" style={{ height: `${Math.max(2, point.points / pointsScale * 100)}%` }} aria-label={`After puzzle ${index + 1}: ${point.points.toFixed(2)} points`} />)}</div>
        <div className="mt-2 flex justify-between text-[11px] text-muted-foreground"><span>puzzle 1</span><span>{final.points.toFixed(2)}/{maxPoints.toFixed(0)} points</span></div>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between gap-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"><span>Puzzle Elo trajectory</span>{finalElo != null && <span className="font-mono text-violet-700 dark:text-violet-300">{Math.round(finalElo).toLocaleString()}</span>}</div>
        <div className="relative h-32 overflow-hidden rounded-lg border bg-secondary/30 p-2" aria-label="Puzzle Elo estimate after each puzzle">
          {eloValues.length ? <svg viewBox="0 0 1000 128" preserveAspectRatio="none" className="size-full overflow-visible text-violet-500" role="img" aria-label={`Puzzle Elo changed from the first bounded estimate after puzzle ${firstEloIndex + 1} to ${Math.round(finalElo ?? 0)}`}>
            <line x1="0" y1="16" x2="1000" y2="16" className="stroke-border" vectorEffect="non-scaling-stroke" strokeDasharray="3 4" />
            <line x1="0" y1="116" x2="1000" y2="116" className="stroke-border" vectorEffect="non-scaling-stroke" />
            <polyline points={linePoints} fill="none" stroke="currentColor" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
          </svg> : <div className="grid size-full place-items-center text-center text-xs text-muted-foreground">A bounded Elo estimate needs at least one solve and one miss.</div>}
          {eloValues.length > 0 && <><span className="absolute left-2 top-1 font-mono text-[9px] text-muted-foreground">{eloMax}</span><span className="absolute bottom-1 left-2 font-mono text-[9px] text-muted-foreground">{eloMin}</span></>}
        </div>
        <div className="mt-2 flex justify-between text-[11px] text-muted-foreground"><span>{firstEloIndex >= 0 ? `first estimate · puzzle ${firstEloIndex + 1}` : "not yet bounded"}</span><span>complete-solve MLE</span></div>
      </div>
    </CardContent>
  </Card>
}

export function ModelDetail() {
  const { model = "" } = useParams()
  const key = decodeURIComponent(model)
  const { runs } = useData()
  const mine = useMemo(() => runs.filter((run) => run.model_variant.key === key).sort((a, b) => b.created.localeCompare(a.created)), [runs, key])
  const [selected, setSelected] = useState("")
  const activeId = selected || mine[0]?.run_id || ""
  const meta = mine.find((run) => run.run_id === activeId) ?? mine[0]
  const [run, setRun] = useState<Run | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [filter, setFilter] = useState<"all" | "solved" | "failed">("all")
  const [openPuzzle, setOpenPuzzle] = useState<string | null>(null)
  const metaFile = meta?.file

  useEffect(() => {
    if (!metaFile) return
    let active = true
    setRun(null)
    setRunError(null)
    void loadRun(metaFile).then((value) => { if (active) setRun(value) }).catch((reason) => { if (active) setRunError(String(reason)) })
    return () => { active = false }
  }, [metaFile])

  if (!meta) return <div><p>No published runs for {key}.</p><Link to="/" className="text-sm underline">Back to overview</Link></div>
  const displayRun = run ?? ({ ...meta, schema: "", themes: [], items: [] } as Run)
  const variant = meta.model_variant
  const activeResponseStyle = responseStyleInfo(meta.condition)

  const byTier = TIER_ORDER.map((tier) => {
    const items = displayRun.items.filter((item) => item.categories.tier?.includes(tier))
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
  const performance = puzzlePerformanceRating(displayRun.items)
  const performanceValue = !run
    ? "—"
    : performance.bounded
      ? Math.round(performance.rating).toLocaleString()
      : performance.n === 0
        ? "—"
        : displayRun.items.every((item) => item.solved) ? "≥4,000" : "≤0"
  const performanceNote = performance.ci95
    ? `95% CI ${Math.round(performance.ci95[0]).toLocaleString()}–${Math.round(performance.ci95[1]).toLocaleString()}`
    : performance.n ? "outside the calibrated 0–4,000 range" : "requires puzzle outcomes"

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
        <Link to="/" className="mb-4 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" /> Overview</Link>
        <h1 className="sr-only">{variant.display_name} benchmark configuration</h1>
        <div className="flex flex-wrap items-start gap-3"><ModelIdentity variant={variant} /><ResponseStyleBadge condition={meta.condition} /></div>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">Provider model <span className="font-mono text-xs text-foreground">{variant.model_id}</span>. Reasoning and output-limit policy are part of this participant’s identity.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {mine.length > 1 && <select value={meta.run_id} onChange={(event) => setSelected(event.target.value)} className="h-8 max-w-sm rounded-md border bg-background px-2 text-xs">{mine.map((candidate) => <option key={candidate.run_id} value={candidate.run_id}>{candidate.track} · {modeInfo(candidate.condition)?.name ?? "special"} · {responseStyleInfo(candidate.condition).label} · {candidate.suite?.name ?? "no suite"}</option>)}</select>}
        <ExportButton model={variant.key} responseStyle={activeResponseStyle.key} />
      </div>
    </section>

    {runError && <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"><span className="font-medium text-destructive">Detailed run data could not be loaded.</span> <span className="text-muted-foreground">{runError}</span></div>}

    <section className={`grid gap-3 sm:grid-cols-2 ${meta.track === "puzzle" ? "xl:grid-cols-5" : "xl:grid-cols-4"}`}>
      <Stat icon={Scale} label="Points" value={pointsText(meta.summary)} note="fractional prefix credit" />
      <Stat icon={Check} label="Complete solves" value={`${meta.summary.solved}/${meta.summary.n}`} note={pct(meta.summary.solve_rate)} />
      {meta.track === "puzzle" && <Stat icon={Gauge} label="Puzzle performance" value={performanceValue} note={`${performanceNote} · secondary`} />}
      <Stat icon={Database} label="Legal first" value={pct(meta.summary.first_move_legal_rate)} note={meta.summary.response_format_valid_rate == null ? `${meta.progress.completed}/${meta.progress.total} durable items` : `${pct(meta.summary.response_format_valid_rate)} ${activeResponseStyle.key === "move_only" ? "parseable text" : "valid JSON"} · ${meta.progress.completed}/${meta.progress.total} durable`} />
      <Stat icon={CircleDollarSign} label="Recorded cost" value={meta.summary.cost_usd == null ? "—" : `$${meta.summary.cost_usd.toFixed(4)}`} note={costNote} />
    </section>

    {modeRuns.filter((item) => item.run).length > 1 && <Card><CardHeader><CardTitle className="flex flex-wrap items-center gap-2 text-base">Board-information comparison <ResponseStyleBadge condition={meta.condition} compact /></CardTitle></CardHeader><CardContent className="grid gap-2 md:grid-cols-3">{modeRuns.map(({ mode, run: candidate }) => <div key={mode.n} className="rounded-lg border p-4"><div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{mode.n}. {mode.name}</div><div className="mt-2 font-mono text-xl font-semibold">{candidate ? pointsText(candidate.summary) : "—"}</div><div className="mt-1 text-xs text-muted-foreground">{candidate ? `${pct(candidate.summary.solve_rate)} complete` : "not run"}</div></div>)}</CardContent></Card>}

    {meta.track === "puzzle" && activeMode && <Card><CardHeader><CardTitle className="text-base">Response-style ablation · Mode {activeMode.n} {activeMode.name}</CardTitle></CardHeader><CardContent className="grid gap-2 sm:grid-cols-2">{responseRuns.map(({ style, run: candidate }) => <div key={style.key} className={`rounded-xl border p-4 ${style.key === activeResponseStyle.key ? "border-primary/35 bg-primary/[0.025]" : ""}`}><ResponseStyleBadge condition={style.key === "move_only" ? "plain-text-v1" : "json-rationale"} /><div className="mt-3 font-mono text-xl font-semibold">{candidate ? pointsText(candidate.summary) : "—"}</div><div className="mt-1 text-xs text-muted-foreground">{candidate ? `${pct(candidate.summary.solve_rate)} complete · ${candidate.status}` : "not run for this suite"}</div></div>)}</CardContent></Card>}

    {run && <PerformanceHistory items={displayRun.items} maxPoints={meta.summary.max_points} />}

    {run && <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
      <Card><CardHeader><CardTitle className="text-base">Difficulty breakdown</CardTitle></CardHeader><CardContent className="space-y-5 p-0"><div><div className="border-b px-4 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Numeric puzzle rating</div><Table><TableHeader><TableRow><TableHead>Rating band</TableHead><TableHead className="text-right">Points</TableHead><TableHead className="text-right">Solved</TableHead></TableRow></TableHeader><TableBody>{byRating.map((row) => <TableRow key={row.low}><TableCell className="font-mono">{row.low}–{row.low + 399}</TableCell><TableCell className="text-right font-mono">{row.points.toFixed(2)}/{row.n}</TableCell><TableCell className="text-right text-muted-foreground">{row.solved}/{row.n}</TableCell></TableRow>)}</TableBody></Table></div><div className="border-t"><div className="border-b px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Named tier</div><Table><TableBody>{byTier.map((row) => <TableRow key={row.tier}><TableCell className="capitalize">{row.tier}</TableCell><TableCell className="text-right font-mono">{row.points.toFixed(2)}/{row.n}</TableCell><TableCell className="text-right text-muted-foreground">{row.solved}/{row.n}</TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card>

      <Card><CardHeader className="flex-row items-center justify-between gap-4 space-y-0"><div><CardTitle className="text-base">Answer sheet <span className="ml-2 font-normal text-muted-foreground">{displayRun.condition.puzzle_protocol === "full_line" ? "full variations" : "move by move"}</span></CardTitle><div className="mt-2 flex flex-wrap gap-3 text-[10px] text-muted-foreground"><span className="inline-flex items-center gap-1"><i className="size-2 rounded-sm bg-emerald-500/70" /> model move</span><span className="inline-flex items-center gap-1"><i className="size-2 rounded-sm border bg-muted" /> built-in puzzle reply</span><span className="inline-flex items-center gap-1"><i className="size-2 rounded-sm bg-rose-500/70" /> wrong / missing move</span></div></div><Tabs value={filter} onValueChange={(value) => setFilter(value as typeof filter)}><TabsList className="h-8">{(["all", "solved", "failed"] as const).map((value) => <TabsTrigger key={value} value={value} className="h-6 text-xs capitalize">{value}</TabsTrigger>)}</TabsList></Tabs></CardHeader>
        <CardContent className="max-h-[640px] overflow-auto p-0"><Table><TableHeader className="sticky top-0 z-10 bg-card"><TableRow><TableHead className="w-8" /><TableHead>Puzzle</TableHead><TableHead className="text-right">Rating</TableHead><TableHead className="text-right">Points</TableHead><TableHead>Model answer</TableHead><TableHead>Correct line</TableHead><TableHead>Outcome</TableHead></TableRow></TableHeader><TableBody>{displayRun.items.filter((item) => filter === "all" || (filter === "solved" ? item.solved : !item.solved)).map((item) => {
          const open = openPuzzle === item.puzzle_id
          const attempts = puzzleModelAttempts(item)
          const correctSolverMoves = item.plies_correct ?? (item.solved ? item.solver_plies ?? attempts.length : Math.round(item.score * (item.solver_plies ?? Math.ceil((item.solution?.length ?? 0) / 2))))
          const modelLine: PuzzleContinuationPly[] = displayRun.track === "woodpecker"
            ? uciLineToSan(item.fen, attempts).map((san, index) => ({ uci: attempts[index], san, source: "model", status: index < correctSolverMoves ? "correct" : "wrong" }))
            : puzzleContinuation(item.fen, attempts, item.solution ?? [], correctSolverMoves)
          const correctLine = uciLineToSan(item.fen, item.solution ?? []).join(" ") || item.solution?.join(" ")
          const rationale = item.answer_rationale ?? item.answer_explanation
          const outcome = item.solved ? "solved" : item.score > 0 ? "partial" : item.failure_reason?.replaceAll("_", " ") ?? "incorrect"
          return <Fragment key={item.puzzle_id}><TableRow className={rationale ? "cursor-pointer" : undefined} onClick={() => rationale && setOpenPuzzle(open ? null : item.puzzle_id)}><TableCell>{item.solved ? <Check className="size-4 text-emerald-600" /> : <X className={`size-4 ${item.score > 0 ? "text-amber-500" : "text-rose-500"}`} />}</TableCell><TableCell><Link to={`/puzzles/${item.puzzle_id}`} onClick={(event) => event.stopPropagation()} className="font-mono text-xs hover:underline">{item.puzzle_id}</Link></TableCell><TableCell className="text-right font-mono text-xs tabular-nums">{item.rating}</TableCell><TableCell className="text-right font-mono">{item.score.toFixed(2)}/1</TableCell><TableCell className="min-w-[260px] max-w-[380px] whitespace-normal"><span className="inline-flex flex-wrap items-center gap-1"><Continuation plies={modelLine} />{item.score > 0 && !item.solved && <span className="ml-1 text-xs text-amber-700 dark:text-amber-300">missed later</span>}{rationale && <ChevronDown className={`ml-1 inline size-3 transition-transform ${open ? "rotate-180" : ""}`} />}</span></TableCell><TableCell className="min-w-[220px] max-w-[320px] whitespace-normal font-mono text-xs leading-6 text-emerald-700 dark:text-emerald-300" title={correctLine}>{correctLine || "—"}</TableCell><TableCell className="space-x-1"><Badge variant={item.solved ? "secondary" : "outline"} className={item.score > 0 && !item.solved ? "border-amber-500/30 text-amber-700 dark:text-amber-300" : undefined}>{outcome}</Badge>{item.answer_response_format_valid != null && <Badge variant={item.answer_response_format_valid ? "outline" : "destructive"}>{item.answer_response_format_valid ? (activeResponseStyle.key === "move_only" ? "plain text" : "JSON") : "recovered"}</Badge>}</TableCell></TableRow>{open && rationale && <TableRow className="animate-in fade-in-0 slide-in-from-top-1 duration-200"><TableCell /><TableCell colSpan={6} className="text-sm leading-relaxed text-muted-foreground"><span className="font-medium text-foreground">Model rationale: </span>{rationale}</TableCell></TableRow>}</Fragment>
        })}</TableBody></Table></CardContent></Card>
    </div>}
  </div>
}
