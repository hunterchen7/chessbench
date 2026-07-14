import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { ArrowLeft, MessageSquareText, Radio, Trophy } from "lucide-react"
import { loadTournament, type Tournament, type TournamentGame } from "@/lib/data"
import { Board } from "@/components/Board"
import { GameReplay } from "@/components/GameReplay"
import { ExportButton } from "@/components/ExportButton"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

const short = (m: string) => (m.includes("/") ? m.split("/")[1] : m)

function LiveBadge() {
  return (
    <Badge className="gap-1 bg-red-500/15 text-red-500">
      <Radio className="size-3 animate-pulse" /> LIVE
    </Badge>
  )
}

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
    setErr(null)
    loadTournament(decoded).then(setT).catch((e) => setErr(String(e)))
  }, [decoded])

  // While a tournament is streaming, poll for fresh games + the live board.
  const isLive = t?.status === "live"
  useEffect(() => {
    if (!isLive) return
    // Poll faster than a single LLM move (~1-1.5s) so the board advances one ply
    // at a time rather than jumping ahead a full move each refresh.
    const id = setInterval(() => {
      loadTournament(decoded).then(setT).catch(() => {})
    }, 1200)
    return () => clearInterval(id)
  }, [isLive, decoded])

  if (err) return <p className="text-destructive">Failed to load: {err}</p>
  if (!t) return <p className="animate-pulse text-muted-foreground">Loading tournament…</p>

  const standings = t.standings.slice().sort((a, b) => b.score - a.score || b.wins - a.wins)
  const live = t.live_game

  return (
    <div className="space-y-8">
      <div>
        <Link to="/games" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Games
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">{decoded.replace(/\.json$/, "")}</h1>
          {isLive && <LiveBadge />}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {t.standings.length} players · {t.games.length} games · condition{" "}
          <span className="font-mono">{t.condition.slug}</span>
          {isLive ? " · updating live" : ` · max ${t.max_plies} plies`}
        </p>
        <div className="mt-3"><ExportButton track="game" /></div>
      </div>

      {live && (
        <Card className="border-red-500/30">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <LiveBadge /> Now playing
              <span className="text-sm font-normal text-muted-foreground">
                {short(live.white)} <span className="text-muted-foreground">vs</span> {short(live.black)} · move{" "}
                {Math.ceil(live.plies / 2)}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Board fen={live.fen} orientation="white" id="live-board" maxWidth={360} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Standings {isLive ? "(live)" : ""} — match points
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 text-center">#</TableHead>
                <TableHead>Player</TableHead>
                <TableHead className="text-right">W–D–L</TableHead>
                <TableHead className="text-right">Points</TableHead>
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
            <div className="mt-6 border-t pt-5">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <MessageSquareText className="size-4" /> Model transcript
              </div>
              <div className="space-y-2">
                {open.moves.flatMap((move) => (move.attempts ?? []).map((attempt, attemptIndex) => (
                  <details key={`${move.ply}-${attemptIndex}`} className="group rounded-lg border bg-muted/20">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-3 text-sm">
                      <span className="font-medium">Ply {move.ply} · {move.color} · attempt {attemptIndex + 1}</span>
                      <span className={attempt.legal ? "text-emerald-600" : "text-rose-600"}>
                        {attempt.legal ? attempt.parsed_move ?? "legal" : "illegal"}
                      </span>
                    </summary>
                    <div className="space-y-3 border-t p-3 text-xs">
                      {attempt.system_prompt && <div><div className="mb-1 font-semibold uppercase tracking-wide text-muted-foreground">System</div><pre className="whitespace-pre-wrap rounded bg-background p-3">{attempt.system_prompt}</pre></div>}
                      <div><div className="mb-1 font-semibold uppercase tracking-wide text-muted-foreground">Turn prompt</div><pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-background p-3">{attempt.prompt ?? "—"}</pre></div>
                      {attempt.explanation && <div><div className="mb-1 font-semibold uppercase tracking-wide text-muted-foreground">Model rationale</div><p className="rounded bg-background p-3 leading-relaxed">{attempt.explanation}</p></div>}
                      <div><div className="mb-1 font-semibold uppercase tracking-wide text-muted-foreground">Visible response</div><pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-background p-3">{attempt.raw_response}</pre></div>
                      <div className="flex flex-wrap items-center gap-3 font-mono text-muted-foreground">
                        {attempt.response_format_valid != null && <Badge variant={attempt.response_format_valid ? "secondary" : "destructive"}>{attempt.response_format_valid ? "valid JSON" : "format recovered"}</Badge>}
                        <span>{attempt.prompt_tokens} prompt</span><span>{attempt.completion_tokens} completion</span><span>{attempt.reasoning_tokens} reasoning tokens</span><span>${attempt.cost_usd.toFixed(5)}</span>
                      </div>
                      {attempt.response_format_error && <p className="text-[11px] text-destructive">{attempt.response_format_error}</p>}
                    </div>
                  </details>
                )))}
                {!open.moves.some((move) => (move.attempts?.length ?? 0) > 0) && (
                  <p className="text-sm text-muted-foreground">This legacy game predates per-turn transcript capture.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
