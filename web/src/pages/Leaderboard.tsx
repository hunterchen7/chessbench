import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Trophy, User } from "lucide-react"
import { useData } from "@/lib/useData"
import type { Run } from "@/lib/data"
import { eloText, modeLabel, pct } from "@/lib/format"
import { humanSummary } from "@/lib/human"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const displayName = (m: string) => (m.includes("/") ? m.split("/")[1] : m)

function bestRun(runs: Run[]): Run {
  return runs.slice().sort((a, b) => b.summary.n - a.summary.n || b.summary.puzzle_elo - a.summary.puzzle_elo)[0]
}

export function Leaderboard() {
  const { runs, puzzleIndex, tournaments } = useData()
  const [mode, setMode] = useState("best")

  const conditions = useMemo(
    () => Array.from(new Set(runs.map((r) => r.condition.slug))).sort(),
    [runs],
  )

  const rows = useMemo(() => {
    const byModel = new Map<string, Run[]>()
    for (const r of runs) {
      if (mode !== "best" && r.condition.slug !== mode) continue
      const arr = byModel.get(r.model) ?? []
      arr.push(r)
      byModel.set(r.model, arr)
    }
    return Array.from(byModel.entries())
      .map(([model, rs]) => ({ model, run: bestRun(rs), count: rs.length }))
      .sort((a, b) => b.run.summary.puzzle_elo - a.run.summary.puzzle_elo)
  }, [runs, mode])

  const human = humanSummary(puzzleIndex)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Leaderboard</h1>
        <p className="mt-1 text-muted-foreground">
          LLMs ranked by <span className="font-medium text-foreground">puzzle Elo</span> — a maximum-likelihood
          rating fit to which Lichess-rated puzzles each model solves.
        </p>
      </div>

      <Tabs defaultValue="puzzle">
        <TabsList>
          <TabsTrigger value="puzzle">Puzzle Elo</TabsTrigger>
          <TabsTrigger value="game">Game Elo</TabsTrigger>
        </TabsList>

        <TabsContent value="puzzle" className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              {rows.length} models · {puzzleIndex.size} unique puzzles
            </p>
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger className="w-[280px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="best">Best run per model</SelectItem>
                {conditions.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12 text-center">#</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead className="text-right">Puzzle Elo</TableHead>
                    <TableHead className="text-right">Solve rate</TableHead>
                    <TableHead className="text-right">Legal 1st</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, i) => {
                    const e = eloText(row.run.summary)
                    return (
                      <TableRow key={row.model} className="cursor-pointer">
                        <TableCell className="text-center font-mono text-muted-foreground">
                          {i === 0 ? <Trophy className="mx-auto size-4 text-chart-4" /> : i + 1}
                        </TableCell>
                        <TableCell>
                          <Link to={`/model/${encodeURIComponent(row.model)}`} className="font-medium hover:underline">
                            {displayName(row.model)}
                          </Link>
                          {row.count > 1 && (
                            <span className="ml-2 text-xs text-muted-foreground">{row.count} runs</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{modeLabel(row.run.condition)}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold tabular-nums">
                          {e.value}
                          {e.ci && <span className="ml-1 text-xs font-normal text-muted-foreground">{e.ci}</span>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{pct(row.run.summary.solve_rate)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {pct(row.run.summary.first_move_legal_rate)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {row.run.summary.cost_usd != null ? `$${row.run.summary.cost_usd.toFixed(3)}` : "—"}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                  {human.n > 0 && human.elo && (
                    <TableRow className="bg-secondary/40">
                      <TableCell className="text-center">
                        <User className="mx-auto size-4 text-chart-2" />
                      </TableCell>
                      <TableCell className="font-medium">You (human)</TableCell>
                      <TableCell>
                        <Badge variant="outline">solved in browser</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        {human.elo.bounded ? human.elo.rating.toFixed(0) : `≥${human.elo.rating.toFixed(0)}`}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {pct(human.solved / human.n)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">—</TableCell>
                      <TableCell className="text-right text-muted-foreground">—</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground">
            Elo shown with ± half-CI where bounded; <span className="font-mono">≤/≥</span> marks a railed estimate
            (solved none / solved all). Solve out more puzzles in the{" "}
            <Link to="/puzzles" className="underline">
              puzzle browser
            </Link>{" "}
            to place yourself on the board.
          </p>
        </TabsContent>

        <TabsContent value="game" className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Playing strength from head-to-head games, rated with a Bradley–Terry model over tournament results.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {tournaments.map((t) => (
              <Link key={t.file} to={`/games/${encodeURIComponent(t.file)}`}>
                <Card className="h-full transition-colors hover:border-ring">
                  <CardHeader>
                    <CardTitle className="text-base">{t.file.replace(/\.json$/, "")}</CardTitle>
                    <CardDescription>
                      {t.n_players} players · {t.n_games} games
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2 text-sm">
                      <Trophy className="size-4 text-chart-4" />
                      Winner: <span className="font-medium">{t.winner ?? "—"}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
            {tournaments.length === 0 && (
              <p className="text-sm text-muted-foreground">No tournaments recorded yet.</p>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
