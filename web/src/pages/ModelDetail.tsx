import { useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { ArrowLeft } from "lucide-react"
import { useData } from "@/lib/useData"
import { eloText, pct, TIER_ORDER } from "@/lib/format"
import { EloChart, type EloPoint } from "@/components/EloChart"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  )
}

export function ModelDetail() {
  const { model = "" } = useParams()
  const decoded = decodeURIComponent(model)
  const { runs } = useData()
  const mine = useMemo(
    () => runs.filter((r) => r.model === decoded).sort((a, b) => b.summary.n - a.summary.n),
    [runs, decoded],
  )
  const [slug, setSlug] = useState(mine[0]?.condition.slug ?? "")
  const run = mine.find((r) => r.condition.slug === slug) ?? mine[0]

  if (!run)
    return (
      <div>
        <p>No runs for {decoded}.</p>
        <Link to="/" className="text-sm underline">
          Back to leaderboard
        </Link>
      </div>
    )

  const points: EloPoint[] = run.items.map((it, i) => ({
    index: i + 1,
    seq_elo: it.seq_elo,
    rating: it.rating,
    solved: it.solved,
    puzzle_id: it.puzzle_id,
  }))
  const e = eloText(run.summary)

  // Tier-bucketed accuracy from this run's items.
  const byTier = TIER_ORDER.map((tier) => {
    const items = run.items.filter((it) => it.categories.tier?.includes(tier))
    const solved = items.filter((it) => it.solved).length
    return { tier, n: items.length, solved }
  }).filter((t) => t.n > 0)

  return (
    <div className="space-y-8">
      <div>
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Leaderboard
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">{decoded}</h1>
          <Badge variant="outline">{run.provider}</Badge>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">Condition</span>
        <Select value={run.condition.slug} onValueChange={setSlug}>
          <SelectTrigger className="w-[360px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {mine.map((r) => (
              <SelectItem key={r.condition.slug} value={r.condition.slug}>
                {r.condition.slug} · {r.summary.n} puzzles
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Puzzle Elo" value={e.value} sub={e.ci ? `95% CI ${e.ci}` : "railed"} />
        <Stat
          label="Solve rate"
          value={pct(run.summary.solve_rate)}
          sub={`${run.summary.solved}/${run.summary.n} solved`}
        />
        <Stat label="Mean score" value={pct(run.summary.mean_score)} sub="partial credit" />
        <Stat label="Legal 1st move" value={pct(run.summary.first_move_legal_rate)} sub="first-attempt legal" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sequential puzzle-Elo trajectory</CardTitle>
        </CardHeader>
        <CardContent>
          <EloChart points={points} final={run.summary.puzzle_elo_bounded ? run.summary.puzzle_elo : undefined} />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Accuracy by tier</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tier</TableHead>
                  <TableHead className="text-right">Solved</TableHead>
                  <TableHead className="text-right">Accuracy</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byTier.map((t) => (
                  <TableRow key={t.tier}>
                    <TableCell className="capitalize">{t.tier}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {t.solved}/{t.n}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{pct(t.solved / t.n)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top themes</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Theme</TableHead>
                  <TableHead className="text-right">n</TableHead>
                  <TableHead className="text-right">Accuracy</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {run.themes.slice(0, 10).map((t) => (
                  <TableRow key={t.theme}>
                    <TableCell>{t.theme}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{t.n}</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(t.accuracy)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
