import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Trophy, User, Users } from "lucide-react"
import { useData } from "@/lib/useData"
import type { Run } from "@/lib/data"
import { eloText, MODES, modeInfo, pct } from "@/lib/format"
import { humanSummary } from "@/lib/human"
import { fetchHumanLeaderboard, type HumanRow } from "@/lib/backend"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const displayName = (m: string) => (m.includes("/") ? m.split("/")[1] : m)

function ModeBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
        active ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  )
}

type ModeMap = Partial<Record<1 | 2 | 3, Run>>

export function Leaderboard() {
  const { runs, puzzleIndex, tournaments, apiBase } = useData()
  // "compare" = the 3-mode matrix; "1"/"2"/"3" = a single mode ranked.
  const [view, setView] = useState<"compare" | "1" | "2" | "3">("2")
  const [humans, setHumans] = useState<HumanRow[]>([])

  useEffect(() => {
    if (apiBase) fetchHumanLeaderboard(apiBase).then(setHumans)
  }, [apiBase])

  // Group public-suite runs by model and by help mode (Raw / Assisted / Coached).
  const byModelMode = useMemo(() => {
    const m = new Map<string, ModeMap>()
    for (const r of runs) {
      if (r.suite && r.suite.name !== "tactical-public-v1") continue // matrix compares one suite
      const mi = modeInfo(r.condition)
      if (!mi) continue
      const rec = m.get(r.model) ?? {}
      const cur = rec[mi.n]
      if (!cur || r.summary.n > cur.summary.n) rec[mi.n] = r
      m.set(r.model, rec)
    }
    return m
  }, [runs])

  // Models ordered by their Assisted (mode 2) Elo, falling back to any mode.
  const modelRows = useMemo(() => {
    const arr = Array.from(byModelMode.entries()).map(([model, modes]) => {
      const anchor = modes[2] ?? modes[3] ?? modes[1]
      return { model, modes, anchorElo: anchor?.summary.puzzle_elo ?? -1 }
    })
    arr.sort((a, b) => b.anchorElo - a.anchorElo)
    return arr
  }, [byModelMode])

  const singleRows = useMemo(() => {
    if (view === "compare") return []
    const n = Number(view) as 1 | 2 | 3
    return modelRows
      .filter((r) => r.modes[n])
      .map((r) => ({ model: r.model, run: r.modes[n]! }))
      .sort((a, b) => b.run.summary.puzzle_elo - a.run.summary.puzzle_elo)
  }, [modelRows, view])

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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {modelRows.length} models · {puzzleIndex.size} unique puzzles · public suite
            </p>
            <div className="flex flex-wrap gap-1">
              <ModeBtn active={view === "compare"} onClick={() => setView("compare")}>
                Compare modes
              </ModeBtn>
              {MODES.map((m) => (
                <ModeBtn key={m.n} active={view === String(m.n)} onClick={() => setView(String(m.n) as "1" | "2" | "3")}>
                  {m.n}. {m.name}
                </ModeBtn>
              ))}
            </div>
          </div>
          {view !== "compare" && (
            <p className="-mt-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                Mode {view}: {MODES[Number(view) - 1].name}
              </span>{" "}
              — {MODES[Number(view) - 1].blurb}
            </p>
          )}

          <Card>
            <CardContent className="p-0">
              {view === "compare" ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12 text-center">#</TableHead>
                      <TableHead>Model</TableHead>
                      {MODES.map((m) => (
                        <TableHead key={m.n} className="text-right">
                          {m.n}. {m.name}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {modelRows.map((row, i) => (
                      <TableRow key={row.model}>
                        <TableCell className="text-center font-mono text-muted-foreground">
                          {i === 0 ? <Trophy className="mx-auto size-4 text-chart-4" /> : i + 1}
                        </TableCell>
                        <TableCell>
                          <Link to={`/model/${encodeURIComponent(row.model)}`} className="font-medium hover:underline">
                            {displayName(row.model)}
                          </Link>
                        </TableCell>
                        {MODES.map((m) => {
                          const run = row.modes[m.n]
                          return (
                            <TableCell key={m.n} className="text-right">
                              {run ? (
                                <>
                                  <span className="font-mono font-semibold tabular-nums">{eloText(run.summary).value}</span>
                                  <div className="text-xs text-muted-foreground">{pct(run.summary.solve_rate)}</div>
                                </>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          )
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12 text-center">#</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead className="text-right">Puzzle Elo</TableHead>
                      <TableHead className="text-right">Solve rate</TableHead>
                      <TableHead className="text-right">Legal 1st</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {singleRows.map((row, i) => {
                      const e = eloText(row.run.summary)
                      return (
                        <TableRow key={row.model}>
                          <TableCell className="text-center font-mono text-muted-foreground">
                            {i === 0 ? <Trophy className="mx-auto size-4 text-chart-4" /> : i + 1}
                          </TableCell>
                          <TableCell>
                            <Link to={`/model/${encodeURIComponent(row.model)}`} className="font-medium hover:underline">
                              {displayName(row.model)}
                            </Link>
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
                    {singleRows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                          No models have been run in this mode yet.
                        </TableCell>
                      </TableRow>
                    )}
                    {human.n > 0 && human.elo && (
                      <TableRow className="bg-secondary/40">
                        <TableCell className="text-center">
                          <User className="mx-auto size-4 text-chart-2" />
                        </TableCell>
                        <TableCell className="font-medium">You (human)</TableCell>
                        <TableCell className="text-right font-mono font-semibold">
                          {human.elo.bounded ? human.elo.rating.toFixed(0) : `≥${human.elo.rating.toFixed(0)}`}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{pct(human.solved / human.n)}</TableCell>
                        <TableCell className="text-right text-muted-foreground">—</TableCell>
                        <TableCell className="text-right text-muted-foreground">—</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
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

          {apiBase && humans.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Users className="size-4 text-chart-2" /> Top human solvers
                </CardTitle>
                <CardDescription>Shared across everyone who solves in the browser.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12 text-center">#</TableHead>
                      <TableHead>Solver</TableHead>
                      <TableHead className="text-right">Puzzle Elo</TableHead>
                      <TableHead className="text-right">Solved</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {humans.map((h, i) => (
                        <TableRow key={i} className={h.me ? "bg-secondary/40" : undefined}>
                          <TableCell className="text-center font-mono text-muted-foreground">{i + 1}</TableCell>
                          <TableCell className="font-medium">
                            {h.handle || `anon #${i + 1}`}
                            {h.me && <Badge variant="outline" className="ml-2 text-xs font-normal">you</Badge>}
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold tabular-nums">
                            {h.elo.bounded ? h.elo.rating.toFixed(0) : `≥${h.elo.rating.toFixed(0)}`}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {h.solved}/{h.n}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
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
