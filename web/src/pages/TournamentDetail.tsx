import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { ArrowLeft, Trophy } from "lucide-react"
import { loadTournament, type Tournament, type TournamentGame } from "@/lib/data"
import { GameReplay } from "@/components/GameReplay"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

const short = (m: string) => (m.includes("/") ? m.split("/")[1] : m)

function resultBadge(result: string) {
  const v = result === "1-0" || result === "0-1" ? "default" : "secondary"
  return <Badge variant={v}>{result}</Badge>
}

export function TournamentDetail() {
  const { file = "" } = useParams()
  const decoded = decodeURIComponent(file)
  const [t, setT] = useState<Tournament | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState<TournamentGame | null>(null)

  useEffect(() => {
    setT(null)
    loadTournament(decoded).then(setT).catch((e) => setErr(String(e)))
  }, [decoded])

  if (err) return <p className="text-destructive">Failed to load: {err}</p>
  if (!t) return <p className="animate-pulse text-muted-foreground">Loading tournament…</p>

  const standings = t.standings.slice().sort((a, b) => (b.rating ?? -1e9) - (a.rating ?? -1e9))

  return (
    <div className="space-y-8">
      <div>
        <Link to="/games" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Games
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">{decoded.replace(/\.json$/, "")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t.standings.length} players · {t.games.length} games · condition{" "}
          <span className="font-mono">{t.condition.slug}</span> · max {t.max_plies} plies
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Standings (Bradley–Terry game Elo)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 text-center">#</TableHead>
                <TableHead>Player</TableHead>
                <TableHead className="text-right">Elo</TableHead>
                <TableHead className="text-right">W–D–L</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead className="text-right">Forfeits</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {standings.map((s, i) => (
                <TableRow key={s.label}>
                  <TableCell className="text-center">
                    {i === 0 ? <Trophy className="mx-auto size-4 text-chart-4" /> : i + 1}
                  </TableCell>
                  <TableCell className="font-medium">{short(s.label)}</TableCell>
                  <TableCell className="text-right font-mono font-semibold tabular-nums">
                    {s.rating != null ? s.rating.toFixed(0) : "—"}
                    {s.rating_ci[0] != null && s.rating_ci[1] != null && (
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        ±{((s.rating_ci[1] - s.rating_ci[0]) / 2).toFixed(0)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {s.wins}–{s.draws}–{s.losses}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {s.score}/{s.games}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {s.illegal_forfeits || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Games</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>White</TableHead>
                <TableHead>Black</TableHead>
                <TableHead className="text-center">Result</TableHead>
                <TableHead>Termination</TableHead>
                <TableHead className="text-right">Plies</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {t.games.map((g, i) => (
                <TableRow key={i} className="cursor-pointer" onClick={() => setOpen(g)}>
                  <TableCell className="font-medium">{short(g.white)}</TableCell>
                  <TableCell className="font-medium">{short(g.black)}</TableCell>
                  <TableCell className="text-center">{resultBadge(g.result)}</TableCell>
                  <TableCell className="text-muted-foreground">{g.termination}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{g.plies}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8"
          onClick={() => setOpen(null)}
        >
          <div
            className="w-full max-w-4xl rounded-lg border bg-background p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">
                {short(open.white)} <span className="text-muted-foreground">vs</span> {short(open.black)}
              </h3>
              <button className="text-sm text-muted-foreground hover:text-foreground" onClick={() => setOpen(null)}>
                Close ✕
              </button>
            </div>
            <GameReplay game={open} />
          </div>
        </div>
      )}
    </div>
  )
}
