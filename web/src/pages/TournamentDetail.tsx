import { useEffect, useRef, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { ArrowLeft, BrainCircuit, Eye, Radio, Sparkles, Trophy } from "lucide-react"
import { loadTournament, type Tournament, type TournamentGame } from "@/lib/data"
import { Board } from "@/components/Board"
import { GameReplay } from "@/components/GameReplay"
import { ResponseStyleBadge } from "@/components/ResponseStyle"
import { ExportButton } from "@/components/ExportButton"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

const short = (m: string) => (m.includes("/") ? m.split("/")[1] : m)

function modeLabel(t: Tournament): string {
  if (t.condition.prompt_style === "coached") return "Mode 3 · coached"
  if (t.condition.legality === "legal_list") return "Mode 2 · legal moves"
  return "Mode 1 · raw position"
}

function reasoningLabel(t: Tournament): string {
  if (t.condition.reasoning_max_tokens) return `${t.condition.reasoning_max_tokens.toLocaleString()} thinking tokens`
  return `${t.condition.reasoning_effort ?? "default"} reasoning`
}

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
  const dialogRef = useRef<HTMLDialogElement>(null)

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

  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => {
      if (dialog?.open) dialog.close()
    }
  }, [open])

  const closeReplay = () => {
    dialogRef.current?.close()
    setOpen(null)
  }

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
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge variant="outline"><Sparkles className="size-3" /> {modeLabel(t)}</Badge>
          <ResponseStyleBadge condition={t.condition} />
          <Badge variant="outline"><BrainCircuit className="size-3" /> {reasoningLabel(t)}</Badge>
          <Badge variant="outline">{t.condition.context_mode ?? "game"} context</Badge>
          <ExportButton track="game" />
        </div>
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
                <TableHead className="w-24 text-right"><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {t.games.map((g, i) => (
                <TableRow key={i} className="group">
                  <TableCell className="font-medium">{short(g.white)}</TableCell>
                  <TableCell className="font-medium">{short(g.black)}</TableCell>
                  <TableCell className="text-center">{resultBadge(g.result)}</TableCell>
                  <TableCell className="text-muted-foreground">{g.termination}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {g.plies}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="opacity-100 sm:opacity-60 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                      aria-label={`Replay ${short(g.white)} versus ${short(g.black)}, ${g.result}`}
                      onClick={() => setOpen(g)}
                    >
                      <Eye className="size-3.5" /> Replay
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {open && (
        <dialog
          ref={dialogRef}
          aria-labelledby="game-replay-title"
          className="m-0 h-full max-h-none w-full max-w-none bg-transparent p-0 backdrop:bg-black/65 backdrop:backdrop-blur-sm"
          onCancel={(event) => {
            event.preventDefault()
            closeReplay()
          }}
        >
          <div
            className="flex min-h-full items-start justify-center overflow-y-auto bg-black/65 p-4 backdrop-blur-sm animate-in fade-in-0 sm:p-8"
            onClick={closeReplay}
          >
            <div
              className="w-full max-w-[min(1560px,calc(100vw-2rem))] rounded-2xl border bg-background p-4 shadow-2xl sm:p-6"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 id="game-replay-title" className="text-lg font-semibold">
                  {short(open.white)} <span className="text-muted-foreground">vs</span> {short(open.black)}
                </h3>
                <button autoFocus aria-label="Close game replay" className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground" onClick={closeReplay}>
                  Close ✕
                </button>
              </div>
              <GameReplay game={open} condition={t.condition} variants={t.model_variants} />
            </div>
          </div>
        </dialog>
      )}
    </div>
  )
}
