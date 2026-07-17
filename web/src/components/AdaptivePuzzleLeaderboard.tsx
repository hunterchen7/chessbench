import { useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { Activity, ArrowRight, CheckCircle2, CircleDollarSign, Gauge, ShieldCheck, Target } from "lucide-react"
import type { RatedSessionProtocol, RunIndexEntry } from "@/lib/data"
import { isModelVariant } from "@/lib/participants"
import { ModelIdentity } from "@/components/ModelIdentity"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"

function isRated(run: RunIndexEntry): run is RunIndexEntry & { protocol: RatedSessionProtocol } {
  return run.track === "puzzle" && run.protocol?.kind === "adaptive_glicko2" && isModelVariant(run.model_variant)
}

function rating(run: RunIndexEntry) {
  return run.summary.puzzle_performance_rating
}

function runPath(run: RunIndexEntry) {
  return `/model/${encodeURIComponent(run.model_variant.key)}?run=${encodeURIComponent(run.run_id)}`
}

function intervalText(run: RunIndexEntry) {
  const interval = rating(run)?.ci95
  if (!interval) return "—"
  return `${Math.round(interval[0]).toLocaleString()}–${Math.round(interval[1]).toLocaleString()}`
}

function ConfidenceRange({ run }: { run: RunIndexEntry }) {
  const estimate = rating(run)
  if (!estimate?.ci95) return <span className="text-muted-foreground">—</span>
  const minimum = 400
  const maximum = 3200
  const position = (value: number) => Math.max(0, Math.min(100, (value - minimum) / (maximum - minimum) * 100))
  const left = position(estimate.ci95[0])
  const right = position(estimate.ci95[1])
  const point = position(estimate.rating)
  return <div className="min-w-36" title={`95% interval ${intervalText(run)}`}>
    <div className="relative h-2 rounded-full bg-muted">
      <div className="absolute top-0 h-2 rounded-full bg-violet-500/25" style={{ left: `${left}%`, width: `${Math.max(1.5, right - left)}%` }} />
      <div className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-600 ring-2 ring-background" style={{ left: `${point}%` }} />
    </div>
    <div className="mt-1 text-right font-mono text-[10px] tabular-nums text-muted-foreground">{intervalText(run)}</div>
  </div>
}

function StatusBadge({ run }: { run: RunIndexEntry }) {
  const estimate = rating(run)
  if (run.status === "running" || run.status === "partial") {
    return <Badge variant="outline" className="border-sky-500/35 bg-sky-500/8 text-sky-700 dark:text-sky-300"><Activity className="size-3" /> In progress</Badge>
  }
  if (estimate?.settled) {
    return <Badge variant="outline" className="border-emerald-500/35 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="size-3" /> Settled</Badge>
  }
  return <Badge variant="outline">Cap reached</Badge>
}

export function AdaptivePuzzleLeaderboard({ runs }: { runs: RunIndexEntry[] }) {
  const navigate = useNavigate()
  const ratedRuns = useMemo(() => runs.filter(isRated).toSorted((a, b) => {
    const status = Number(b.status === "completed") - Number(a.status === "completed")
    return status || (rating(b)?.rating ?? -Infinity) - (rating(a)?.rating ?? -Infinity) || b.created.localeCompare(a.created)
  }), [runs])
  const protocol = ratedRuns[0]?.protocol
  const completed = ratedRuns.filter((run) => run.status === "completed")
  const totals = {
    models: new Set(ratedRuns.map((run) => run.model_variant.key)).size,
    settled: completed.filter((run) => rating(run)?.settled).length,
    attempts: ratedRuns.reduce((sum, run) => sum + run.progress.completed, 0),
    cost: ratedRuns.reduce((sum, run) => sum + (run.summary.cost_usd ?? 0), 0),
  }

  return <div className="space-y-7">
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Card><CardContent className="flex items-center gap-4 pt-6"><Gauge className="size-5 text-emerald-600" /><div><div className="font-mono text-2xl font-semibold">{totals.models}</div><div className="text-xs text-muted-foreground">rated configurations</div></div></CardContent></Card>
      <Card><CardContent className="flex items-center gap-4 pt-6"><ShieldCheck className="size-5 text-violet-600" /><div><div className="font-mono text-2xl font-semibold">{totals.settled}</div><div className="text-xs text-muted-foreground">settled ratings</div></div></CardContent></Card>
      <Card><CardContent className="flex items-center gap-4 pt-6"><Target className="size-5 text-amber-500" /><div><div className="font-mono text-2xl font-semibold">{totals.attempts.toLocaleString()}</div><div className="text-xs text-muted-foreground">adaptive puzzles played</div></div></CardContent></Card>
      <Card><CardContent className="flex items-center gap-4 pt-6"><CircleDollarSign className="size-5 text-sky-600" /><div><div className="font-mono text-2xl font-semibold">${totals.cost.toFixed(2)}</div><div className="text-xs text-muted-foreground">recorded provider cost</div></div></CardContent></Card>
    </section>

    <Card className="overflow-hidden border-emerald-500/20 bg-emerald-500/[0.025]">
      <CardHeader className="gap-2 border-b border-emerald-500/15">
        <CardTitle className="flex items-center gap-2 text-base"><Target className="size-4 text-emerald-600" /> One canonical chess test</CardTitle>
        <p className="max-w-4xl text-sm leading-relaxed text-muted-foreground">Each model starts at 1,500 with high uncertainty and receives deterministic, unused puzzles near its current rating. Puzzle ratings stay frozen. A complete solve is a Glicko win; any wrong or illegal move is a loss. The session stops after at least {protocol?.stopping.minimum_puzzles ?? 50} puzzles when RD reaches {protocol?.stopping.target_rating_deviation ?? 75}, or at {protocol?.stopping.maximum_puzzles ?? 100} puzzles.</p>
      </CardHeader>
      <CardContent className="grid gap-3 py-4 text-xs sm:grid-cols-2 xl:grid-cols-4">
        {["Raw FEN + piece locations", "UCI move only", "No legal list or coaching", "Conversation continues within one puzzle"].map((label) => <div key={label} className="flex items-center gap-2 rounded-lg border bg-background/70 px-3 py-2"><CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" /><span>{label}</span></div>)}
      </CardContent>
    </Card>

    <Card className="overflow-hidden border-border/70">
      <CardHeader className="border-b">
        <CardTitle className="text-base">Model ratings</CardTitle>
        <p className="text-xs text-muted-foreground">Configurations include provider, reasoning budget, and output policy. Click a row for its complete rating path, puzzle answers, exact prompts, responses, and token accounting.</p>
      </CardHeader>
      {ratedRuns.length === 0 ? <CardContent className="py-16 text-center">
        <div className="mx-auto grid size-11 place-items-center rounded-full bg-secondary"><Gauge className="size-5 text-muted-foreground" /></div>
        <div className="mt-3 font-medium">No adaptive ratings have been published yet</div>
        <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">The calibrated 100,000-puzzle pool and runner are ready. Fixed-suite results remain available in the suite lab while the first canonical session is published.</p>
      </CardContent> : <div className="overflow-x-auto"><Table className="min-w-[980px]">
        <TableHeader><TableRow><TableHead className="w-14 text-center">#</TableHead><TableHead>Model configuration</TableHead><TableHead className="text-right">Rating</TableHead><TableHead>95% uncertainty</TableHead><TableHead className="text-right">RD</TableHead><TableHead className="text-right">Record</TableHead><TableHead className="text-right">Puzzles</TableHead><TableHead className="text-right">Cost</TableHead><TableHead>Status</TableHead><TableHead className="w-10" /></TableRow></TableHeader>
        <TableBody>{ratedRuns.map((run, index) => {
          const estimate = rating(run)
          return <TableRow key={run.run_id} tabIndex={0} role="link" className={cn("cursor-pointer transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none", run.status !== "completed" && "bg-sky-500/[0.025]")} onClick={() => navigate(runPath(run))} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") navigate(runPath(run)) }}>
            <TableCell className="text-center font-mono text-muted-foreground">{index + 1}</TableCell>
            <TableCell><ModelIdentity variant={run.model_variant} compact /><div className="mt-1 font-mono text-[10px] text-muted-foreground">seed {run.protocol.selection.seed} · {run.condition.reasoning_effort ?? "default"} reasoning</div></TableCell>
            <TableCell className="text-right"><div className="font-mono text-xl font-semibold tabular-nums">{estimate ? Math.round(estimate.rating).toLocaleString() : "—"}</div>{estimate?.provisional ? <div className="text-[10px] uppercase tracking-wide text-muted-foreground">provisional</div> : null}</TableCell>
            <TableCell><ConfidenceRange run={run} /></TableCell>
            <TableCell className="text-right font-mono tabular-nums">{estimate?.rating_deviation == null ? "—" : Math.round(estimate.rating_deviation)}</TableCell>
            <TableCell className="text-right"><div className="font-mono font-medium">{run.summary.solved}–{run.progress.completed - run.summary.solved}</div><div className="text-[10px] text-muted-foreground">{(run.summary.solve_rate * 100).toFixed(1)}% solved</div></TableCell>
            <TableCell className="text-right font-mono tabular-nums">{run.progress.completed}<span className="text-muted-foreground">/{run.progress.total}</span></TableCell>
            <TableCell className="text-right font-mono text-xs">{run.summary.cost_usd == null ? "—" : `$${run.summary.cost_usd.toFixed(3)}`}</TableCell>
            <TableCell><StatusBadge run={run} /></TableCell>
            <TableCell><ArrowRight className="size-4 text-muted-foreground" /></TableCell>
          </TableRow>
        })}</TableBody>
      </Table></div>}
    </Card>
  </div>
}
