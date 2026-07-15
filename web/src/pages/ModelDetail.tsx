import { Fragment, useEffect, useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { ArrowLeft, Check, ChevronDown, CircleDollarSign, Database, Scale, X } from "lucide-react"
import { useData } from "@/lib/useData"
import { loadRun, type Run } from "@/lib/data"
import { MODES, modeInfo, pct, pointsText, RESPONSE_STYLES, responseStyleInfo, TIER_ORDER } from "@/lib/format"
import { uciToSan } from "@/lib/chess"
import { ModelIdentity } from "@/components/ModelIdentity"
import { ResponseStyleBadge } from "@/components/ResponseStyle"
import { ExportButton } from "@/components/ExportButton"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

function Stat({ label, value, note, icon: Icon }: { label: string; value: string; note: string; icon: typeof Scale }) {
  return <Card><CardContent className="flex items-start gap-3 pt-6"><Icon className="mt-1 size-4 text-muted-foreground" /><div><div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-1 font-mono text-2xl font-semibold tabular-nums">{value}</div><div className="mt-0.5 text-xs text-muted-foreground">{note}</div></div></CardContent></Card>
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
  const [filter, setFilter] = useState<"all" | "solved" | "failed">("all")
  const [openPuzzle, setOpenPuzzle] = useState<string | null>(null)

  useEffect(() => {
    if (!meta) return
    setRun(null)
    void loadRun(meta.file).then(setRun)
  }, [meta])

  if (!meta) return <div><p>No published runs for {key}.</p><Link to="/" className="text-sm underline">Back to overview</Link></div>
  const displayRun = run ?? ({ ...meta, schema: "", themes: [], items: [] } as Run)
  const variant = meta.model_variant
  const activeResponseStyle = responseStyleInfo(meta.condition)

  const byTier = TIER_ORDER.map((tier) => {
    const items = displayRun.items.filter((item) => item.categories.tier?.includes(tier))
    return { tier, n: items.length, solved: items.filter((item) => item.solved).length, points: items.reduce((sum, item) => sum + item.score, 0) }
  }).filter((row) => row.n)

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
  const cumulative = displayRun.items.reduce<Array<{ item: string; points: number }>>((acc, item) => {
    acc.push({ item: item.puzzle_id, points: (acc.at(-1)?.points ?? 0) + item.score })
    return acc
  }, [])

  return <div className="space-y-8">
    <section className="flex flex-wrap items-end justify-between gap-5 border-b border-border/70 pb-7">
      <div>
        <Link to="/" className="mb-4 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" /> Overview</Link>
        <div className="flex flex-wrap items-start gap-3"><ModelIdentity variant={variant} /><ResponseStyleBadge condition={meta.condition} /></div>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">Provider model <span className="font-mono text-xs text-foreground">{variant.model_id}</span>. Reasoning and output budgets are part of this participant’s identity.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {mine.length > 1 && <select value={meta.run_id} onChange={(event) => setSelected(event.target.value)} className="h-8 max-w-sm rounded-md border bg-background px-2 text-xs">{mine.map((candidate) => <option key={candidate.run_id} value={candidate.run_id}>{candidate.track} · {modeInfo(candidate.condition)?.name ?? "special"} · {responseStyleInfo(candidate.condition).label} · {candidate.suite?.name ?? "no suite"}</option>)}</select>}
        <ExportButton model={variant.key} responseStyle={activeResponseStyle.key} />
      </div>
    </section>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Stat icon={Scale} label="Points" value={pointsText(meta.summary)} note="fractional prefix credit" />
      <Stat icon={Check} label="Complete solves" value={`${meta.summary.solved}/${meta.summary.n}`} note={pct(meta.summary.solve_rate)} />
      <Stat icon={Database} label="Legal first" value={pct(meta.summary.first_move_legal_rate)} note={meta.summary.response_format_valid_rate == null ? `${meta.progress.completed}/${meta.progress.total} durable items` : `${pct(meta.summary.response_format_valid_rate)} ${activeResponseStyle.key === "move_only" ? "parseable text" : "valid JSON"} · ${meta.progress.completed}/${meta.progress.total} durable`} />
      <Stat icon={CircleDollarSign} label="Recorded cost" value={meta.summary.cost_usd == null ? "—" : `$${meta.summary.cost_usd.toFixed(4)}`} note={`${meta.usage?.reasoning_tokens?.toLocaleString() ?? 0} reasoning tokens`} />
    </section>

    {modeRuns.filter((item) => item.run).length > 1 && <Card><CardHeader><CardTitle className="flex flex-wrap items-center gap-2 text-base">Board-information comparison <ResponseStyleBadge condition={meta.condition} compact /></CardTitle></CardHeader><CardContent className="grid gap-2 md:grid-cols-3">{modeRuns.map(({ mode, run: candidate }) => <div key={mode.n} className="rounded-lg border p-4"><div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{mode.n}. {mode.name}</div><div className="mt-2 font-mono text-xl font-semibold">{candidate ? pointsText(candidate.summary) : "—"}</div><div className="mt-1 text-xs text-muted-foreground">{candidate ? `${pct(candidate.summary.solve_rate)} complete` : "not run"}</div></div>)}</CardContent></Card>}

    {meta.track === "puzzle" && activeMode && <Card><CardHeader><CardTitle className="text-base">Response-style ablation · Mode {activeMode.n} {activeMode.name}</CardTitle></CardHeader><CardContent className="grid gap-2 sm:grid-cols-2">{responseRuns.map(({ style, run: candidate }) => <div key={style.key} className={`rounded-xl border p-4 ${style.key === activeResponseStyle.key ? "border-primary/35 bg-primary/[0.025]" : ""}`}><ResponseStyleBadge condition={style.key === "move_only" ? "plain-text-v1" : "json-rationale"} /><div className="mt-3 font-mono text-xl font-semibold">{candidate ? pointsText(candidate.summary) : "—"}</div><div className="mt-1 text-xs text-muted-foreground">{candidate ? `${pct(candidate.summary.solve_rate)} complete · ${candidate.status}` : "not run for this suite"}</div></div>)}</CardContent></Card>}

    {run && cumulative.length > 0 && <Card><CardHeader><CardTitle className="text-base">Points accumulation</CardTitle></CardHeader><CardContent><div className="flex h-32 items-end gap-px overflow-hidden rounded-lg border bg-secondary/30 p-3" aria-label="Cumulative points by puzzle">{cumulative.map((point, index) => <div key={point.item} title={`${point.item}: ${point.points.toFixed(2)} points`} className="min-w-0 flex-1 bg-emerald-500/70 transition-colors hover:bg-emerald-500" style={{ height: `${Math.max(2, point.points / Math.max(1, meta.summary.max_points) * 100)}%` }} aria-label={`After puzzle ${index + 1}: ${point.points.toFixed(2)} points`} />)}</div><div className="mt-2 flex justify-between text-[11px] text-muted-foreground"><span>first item</span><span>{meta.summary.points.toFixed(2)} total points</span></div></CardContent></Card>}

    {run && <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
      <Card><CardHeader><CardTitle className="text-base">Points by difficulty tier</CardTitle></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Tier</TableHead><TableHead className="text-right">Points</TableHead><TableHead className="text-right">Solved</TableHead></TableRow></TableHeader><TableBody>{byTier.map((row) => <TableRow key={row.tier}><TableCell className="capitalize">{row.tier}</TableCell><TableCell className="text-right font-mono">{row.points.toFixed(2)}/{row.n}</TableCell><TableCell className="text-right text-muted-foreground">{row.solved}/{row.n}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>

      <Card><CardHeader className="flex-row items-center justify-between gap-4 space-y-0"><CardTitle className="text-base">Answer sheet <span className="ml-2 font-normal text-muted-foreground">{displayRun.condition.puzzle_protocol === "full_line" ? "full variations" : "move by move"}</span></CardTitle><div className="flex gap-1">{(["all", "solved", "failed"] as const).map((value) => <button key={value} onClick={() => setFilter(value)} className={`rounded px-2 py-1 text-xs capitalize ${filter === value ? "bg-foreground text-background" : "text-muted-foreground"}`}>{value}</button>)}</div></CardHeader>
        <CardContent className="max-h-[640px] overflow-auto p-0"><Table><TableHeader><TableRow><TableHead className="w-8" /><TableHead>Puzzle</TableHead><TableHead className="text-right">Points</TableHead><TableHead>Answer</TableHead><TableHead>Outcome</TableHead></TableRow></TableHeader><TableBody>{displayRun.items.filter((item) => filter === "all" || (filter === "solved" ? item.solved : !item.solved)).map((item) => {
          const open = openPuzzle === item.puzzle_id
          const answer = displayRun.track === "woodpecker" ? item.moves_played?.join(" ") : uciToSan(item.fen, item.answer_move) ?? item.answer_move
          const rationale = item.answer_rationale ?? item.answer_explanation
          return <Fragment key={item.puzzle_id}><TableRow className={rationale ? "cursor-pointer" : undefined} onClick={() => rationale && setOpenPuzzle(open ? null : item.puzzle_id)}><TableCell>{item.solved ? <Check className="size-4 text-emerald-600" /> : <X className="size-4 text-rose-500" />}</TableCell><TableCell><Link to={`/puzzles/${item.puzzle_id}`} onClick={(event) => event.stopPropagation()} className="font-mono text-xs hover:underline">{item.puzzle_id}</Link></TableCell><TableCell className="text-right font-mono">{item.score.toFixed(2)}/1</TableCell><TableCell className="max-w-[260px] truncate font-mono text-xs">{answer || "—"}{rationale && <ChevronDown className={`ml-1 inline size-3 transition-transform ${open ? "rotate-180" : ""}`} />}</TableCell><TableCell className="space-x-1">{item.failure_reason ? <Badge variant="outline">{item.failure_reason}</Badge> : <Badge variant="secondary">complete</Badge>}{item.answer_response_format_valid != null && <Badge variant={item.answer_response_format_valid ? "outline" : "destructive"}>{item.answer_response_format_valid ? (activeResponseStyle.key === "move_only" ? "plain text" : "JSON") : "recovered"}</Badge>}</TableCell></TableRow>{open && rationale && <TableRow><TableCell /><TableCell colSpan={4} className="text-sm leading-relaxed text-muted-foreground"><span className="font-medium text-foreground">Model rationale: </span>{rationale}</TableCell></TableRow>}</Fragment>
        })}</TableBody></Table></CardContent></Card>
    </div>}
  </div>
}
