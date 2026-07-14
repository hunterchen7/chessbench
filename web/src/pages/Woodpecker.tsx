import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Activity, ArrowUpRight, CheckCircle2, Sigma } from "lucide-react"
import { useData } from "@/lib/useData"
import { pct, pointsText } from "@/lib/format"
import { ModelIdentity } from "@/components/ModelIdentity"
import { ExportButton } from "@/components/ExportButton"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export function Woodpecker() {
  const { runs } = useData()
  const all = useMemo(() => runs.filter((run) => run.track === "woodpecker"), [runs])
  const suites = useMemo(() => Array.from(new Set(all.map((run) => run.suite?.name).filter(Boolean))) as string[], [all])
  const [suite, setSuite] = useState("")
  const activeSuite = suite || suites[0] || ""
  const rows = useMemo(() => all.filter((run) => !activeSuite || run.suite?.name === activeSuite)
    .sort((a, b) => b.summary.points - a.summary.points || b.summary.solve_rate - a.summary.solve_rate), [all, activeSuite])
  const totalPoints = rows.reduce((sum, run) => sum + run.summary.points, 0)
  const totalSolved = rows.reduce((sum, run) => sum + run.summary.solved, 0)

  return (
    <div className="space-y-8">
      <section className="grid gap-6 border-b border-border/70 pb-8 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-violet-700 dark:text-violet-300"><Activity className="size-4" /> Full-line calculation</div>
          <h1 className="text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">Woodpecker track</h1>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-muted-foreground">
            The model sees a fresh position once and must return the complete solution—including forced replies—in a
            single response. A perfect line earns one point; correct solver plies in a matching prefix earn partial credit.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {suites.length > 1 && <select value={activeSuite} onChange={(event) => setSuite(event.target.value)} className="h-8 rounded-md border bg-background px-2 text-xs">{suites.map((name) => <option key={name}>{name}</option>)}</select>}
          <ExportButton track="woodpecker" />
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="flex items-center gap-4 pt-6"><Sigma className="size-5 text-violet-600" /><div><div className="font-mono text-2xl font-semibold">{totalPoints.toFixed(2)}</div><div className="text-xs text-muted-foreground">points across published runs</div></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-4 pt-6"><CheckCircle2 className="size-5 text-emerald-600" /><div><div className="font-mono text-2xl font-semibold">{totalSolved}</div><div className="text-xs text-muted-foreground">complete lines solved</div></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-4 pt-6"><Activity className="size-5 text-amber-600" /><div><div className="font-mono text-2xl font-semibold">{rows.length}</div><div className="text-xs text-muted-foreground">model-budget variants</div></div></CardContent></Card>
      </section>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead className="w-12 text-center">#</TableHead><TableHead>Model variant</TableHead><TableHead>Prompt contract</TableHead><TableHead className="text-right">Points</TableHead><TableHead className="text-right">Complete lines</TableHead><TableHead className="text-right">Legal first</TableHead><TableHead className="text-right">Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((run, index) => <TableRow key={run.run_id}>
                <TableCell className="text-center font-mono text-xs text-muted-foreground">{index + 1}</TableCell>
                <TableCell><Link to={`/model/${encodeURIComponent(run.model_variant.key)}`} className="group flex items-center gap-2"><ModelIdentity variant={run.model_variant} /><ArrowUpRight className="size-3.5 opacity-0 group-hover:opacity-100" /></Link></TableCell>
                <TableCell><div className="flex flex-wrap gap-1"><Badge variant="secondary">one shot</Badge><Badge variant="outline">full variation</Badge>{run.condition.prompt_style === "coached" && <Badge variant="outline">coached</Badge>}</div></TableCell>
                <TableCell className="text-right font-mono font-semibold">{pointsText(run.summary)}</TableCell>
                <TableCell className="text-right tabular-nums">{run.summary.solved}/{run.summary.n}<div className="text-[11px] text-muted-foreground">{pct(run.summary.solve_rate)}</div></TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{pct(run.summary.first_move_legal_rate)}</TableCell>
                <TableCell className="text-right"><Badge variant={run.status === "completed" ? "secondary" : "outline"}>{run.status}</Badge></TableCell>
              </TableRow>)}
              {rows.length === 0 && <TableRow><TableCell colSpan={7} className="py-16 text-center"><div className="font-medium">No Woodpecker runs published yet</div><div className="mt-1 text-sm text-muted-foreground">Run the dedicated Woodpecker track; progress will appear here item by item.</div></TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
