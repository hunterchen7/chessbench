import { useEffect, useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { ArrowLeft, BrainCircuit, Eye, Radio, Sparkles, Trophy } from "lucide-react"
import { loadTournament, type Tournament } from "@/lib/data"
import { Board } from "@/components/Board"
import { GameReplay } from "@/components/GameReplay"
import { GameExportActions } from "@/components/GameExportActions"
import { SortableTableHead, type SortDirection } from "@/components/SortableTableHead"
import { ResponseStyleBadge } from "@/components/ResponseStyle"
import { ExportButton } from "@/components/ExportButton"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
  const { file = "", game: gameParam } = useParams()
  const decoded = decodeURIComponent(file)
  const [t, setT] = useState<Tournament | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [standingSort, setStandingSort] = useState<{ key: "player" | "record" | "points" | "forfeits"; direction: SortDirection }>({ key: "points", direction: "desc" })
  const [gameSort, setGameSort] = useState<{ key: "white" | "black" | "result" | "termination" | "plies"; direction: SortDirection }>({ key: "plies", direction: "desc" })
  const [gameQuery, setGameQuery] = useState("")

  useEffect(() => {
    let active = true
    setT(null)
    setErr(null)
    loadTournament(decoded).then((value) => { if (active) setT(value) }).catch((e) => { if (active) setErr(String(e)) })
    return () => { active = false }
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

  const standings = useMemo(() => (t?.standings ?? []).toSorted((a, b) => {
    const multiplier = standingSort.direction === "asc" ? 1 : -1
    let comparison = 0
    if (standingSort.key === "player") comparison = a.label.localeCompare(b.label)
    else if (standingSort.key === "record") comparison = (a.wins - a.losses) - (b.wins - b.losses)
    else if (standingSort.key === "forfeits") comparison = a.illegal_forfeits - b.illegal_forfeits
    else comparison = a.score - b.score
    return comparison * multiplier || b.wins - a.wins
  }), [t, standingSort.key, standingSort.direction])

  const games = useMemo(() => {
    const needle = gameQuery.trim().toLowerCase()
    const values = (t?.games ?? []).map((game, originalIndex) => ({ game, originalIndex })).filter(({ game }) => !needle || `${game.white} ${game.black} ${game.result} ${game.termination}`.toLowerCase().includes(needle))
    const multiplier = gameSort.direction === "asc" ? 1 : -1
    return values.toSorted((a, b) => {
      let comparison = 0
      if (gameSort.key === "white") comparison = a.game.white.localeCompare(b.game.white)
      else if (gameSort.key === "black") comparison = a.game.black.localeCompare(b.game.black)
      else if (gameSort.key === "result") comparison = a.game.result.localeCompare(b.game.result)
      else if (gameSort.key === "termination") comparison = a.game.termination.localeCompare(b.game.termination)
      else comparison = a.game.plies - b.game.plies
      return comparison * multiplier || a.originalIndex - b.originalIndex
    })
  }, [t, gameQuery, gameSort.key, gameSort.direction])

  const toggleStandingSort = (key: typeof standingSort.key, direction: SortDirection = "desc") => setStandingSort((current) => ({ key, direction: current.key === key ? current.direction === "asc" ? "desc" : "asc" : direction }))
  const toggleGameSort = (key: typeof gameSort.key, direction: SortDirection = "asc") => setGameSort((current) => ({ key, direction: current.key === key ? current.direction === "asc" ? "desc" : "asc" : direction }))

  if (err) return <p className="text-destructive">Failed to load: {err}</p>
  if (!t) return <p className="animate-pulse text-muted-foreground">Loading tournament…</p>

  const selectedIndex = gameParam == null ? null : Number(gameParam) - 1
  const selectedGame = selectedIndex == null || !Number.isInteger(selectedIndex) ? null : t.games[selectedIndex]
  if (gameParam != null && !selectedGame) {
    return <div className="space-y-3"><p>Game {gameParam} was not found in this match.</p><Link to={`/games/${encodeURIComponent(decoded)}`} className="text-sm underline">Back to match</Link></div>
  }
  if (selectedGame && selectedIndex != null) {
    const title = `${short(selectedGame.white)} vs ${short(selectedGame.black)} · game ${selectedIndex + 1}`
    return (
      <div className="space-y-6 animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b pb-5">
          <div>
            <Link to={`/games/${encodeURIComponent(decoded)}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="size-4" /> All games in this match
            </Link>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">Complete board replay, PGN, move record, and two isolated model conversations.</p>
          </div>
          <GameExportActions game={selectedGame} name={`${decoded}-game-${selectedIndex + 1}`} />
        </div>
        <GameReplay game={selectedGame} condition={t.condition} variants={t.model_variants} />
      </div>
    )
  }

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
                <SortableTableHead label="Player" active={standingSort.key === "player"} direction={standingSort.direction} onSort={() => toggleStandingSort("player", "asc")} />
                <SortableTableHead label="W–D–L" active={standingSort.key === "record"} direction={standingSort.direction} align="right" onSort={() => toggleStandingSort("record")} />
                <SortableTableHead label="Points" active={standingSort.key === "points"} direction={standingSort.direction} align="right" onSort={() => toggleStandingSort("points")} />
                <SortableTableHead label="Forfeits" active={standingSort.key === "forfeits"} direction={standingSort.direction} align="right" onSort={() => toggleStandingSort("forfeits", "asc")} />
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
        <CardHeader className="flex-row items-center justify-between gap-4">
          <CardTitle className="text-base">Games <span className="font-normal text-muted-foreground">· open any row for the complete replay and conversations</span></CardTitle>
          <Input value={gameQuery} onChange={(event) => setGameQuery(event.target.value)} placeholder="Filter player or result…" className="w-56" />
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTableHead label="White" active={gameSort.key === "white"} direction={gameSort.direction} onSort={() => toggleGameSort("white")} />
                <SortableTableHead label="Black" active={gameSort.key === "black"} direction={gameSort.direction} onSort={() => toggleGameSort("black")} />
                <SortableTableHead label="Result" active={gameSort.key === "result"} direction={gameSort.direction} align="center" onSort={() => toggleGameSort("result")} />
                <SortableTableHead label="Termination" active={gameSort.key === "termination"} direction={gameSort.direction} onSort={() => toggleGameSort("termination")} />
                <SortableTableHead label="Plies" active={gameSort.key === "plies"} direction={gameSort.direction} align="right" onSort={() => toggleGameSort("plies", "desc")} />
                <TableHead className="w-24 text-right"><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {games.map(({ game: g, originalIndex: i }) => (
                <TableRow key={i} className="group">
                  <TableCell className="font-medium">{short(g.white)}</TableCell>
                  <TableCell className="font-medium">{short(g.black)}</TableCell>
                  <TableCell className="text-center">{resultBadge(g.result)}</TableCell>
                  <TableCell className="text-muted-foreground">{g.termination}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {g.plies}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="ghost" size="xs" className="opacity-100 sm:opacity-60 sm:group-hover:opacity-100 sm:focus-visible:opacity-100">
                      <Link to={`/games/${encodeURIComponent(decoded)}/${i + 1}`} aria-label={`Open full game ${short(g.white)} versus ${short(g.black)}, ${g.result}`}>
                        <Eye className="size-3.5" /> Full game
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {games.length === 0 && <TableRow><TableCell colSpan={6} className="py-12 text-center text-sm text-muted-foreground">No games match that filter.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

    </div>
  )
}
