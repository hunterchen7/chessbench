import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { Chess } from "chess.js"
import { ArrowLeft, Check, ChevronDown, Lightbulb, RotateCcw, X } from "lucide-react"
import { useData } from "@/lib/useData"
import { loadPuzzle, type PuzzleEntry } from "@/lib/data"
import { pct } from "@/lib/format"
import { uciLineToSan, uciToSan } from "@/lib/chess"
import { humanRecord } from "@/lib/human"
import { pushSolve } from "@/lib/backend"
import { Board } from "@/components/Board"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

type Status = "playing" | "solved" | "failed"

export function PuzzleDetail() {
  const { id = "" } = useParams()
  const { apiBase } = useData()
  const [entry, setEntry] = useState<PuzzleEntry | null | undefined>(undefined)
  useEffect(() => { setEntry(undefined); void loadPuzzle(id).then(setEntry) }, [id])
  if (entry === undefined) return <div className="py-20 text-center text-sm text-muted-foreground">Loading puzzle…</div>
  if (entry === null) return <div className="space-y-2"><p>Puzzle {id} not found.</p><Link to="/puzzles" className="text-sm underline">Back to puzzles</Link></div>
  return <PuzzleView key={id} id={id} entry={entry} apiBase={apiBase} />
}

function PuzzleView({ id, entry, apiBase }: { id: string; entry: PuzzleEntry; apiBase: string | null }) {

  // Record a human outcome both locally (offline Elo) and on the backend (shared
  // leaderboard). `move` is the player's first move; the server verifies it before crediting.
  const recordSolve = (solved: boolean, move: string | null) => {
    humanRecord(id, solved)
    if (apiBase) void pushSolve(apiBase, id, solved, move)
  }

  const startFen = entry.position.fen
  const orientation: "white" | "black" = entry.position.solver_is_white ? "white" : "black"

  const gameRef = useRef(new Chess(startFen))
  const [fen, setFen] = useState(startFen)
  const [status, setStatus] = useState<Status>("playing")
  const [ply, setPly] = useState(0)
  const [reveal, setReveal] = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)

  const solution = entry.position.solution ?? []
  const solutionSan = useMemo(() => uciLineToSan(startFen, solution), [startFen, solution])

  const p = entry.position

  function reset() {
    gameRef.current = new Chess(startFen)
    setFen(startFen)
    setStatus("playing")
    setPly(0)
    setReveal(false)
  }

  function onPieceDrop(from: string, to: string): boolean {
    if (status !== "playing") return false
    const g = gameRef.current
    const expected = solution[ply]
    if (!expected) return false
    const promo = expected.slice(0, 4) === from + to ? expected[4] || "q" : "q"
    let move
    try {
      move = g.move({ from, to, promotion: promo })
    } catch {
      return false
    }
    const uci = move.from + move.to + (move.promotion || "")
    if (uci !== expected) {
      g.undo()
      setStatus("failed")
      recordSolve(false, uci)
      return false
    }
    let idx = ply + 1
    // Auto-play the opponent's reply if the line continues.
    if (idx < solution.length) {
      const opp = solution[idx]
      try {
        g.move({ from: opp.slice(0, 2), to: opp.slice(2, 4), promotion: opp.slice(4) || undefined })
        idx++
      } catch {
        /* line ended */
      }
    }
    setFen(g.fen())
    setPly(idx)
    if (idx >= solution.length) {
      setStatus("solved")
      recordSolve(true, solution[0] ?? null)
    }
    return true
  }

  function giveUp() {
    if (status !== "solved") recordSolve(false, null)
    setStatus("failed")
    setReveal(true)
  }

  const playedSan = uciLineToSan(startFen, solution.slice(0, ply))

  return (
    <div className="space-y-6">
      <Link to="/puzzles" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Puzzles
      </Link>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,480px)_1fr]">
        {/* Board + controls */}
        <div className="space-y-4">
          <Board fen={fen} orientation={orientation} onPieceDrop={status === "playing" ? onPieceDrop : undefined} />

          {status === "solved" && (
            <div className="flex items-center gap-2 rounded-md border border-chart-2/40 bg-chart-2/10 px-3 py-2 text-sm">
              <Check className="size-4 text-chart-2" /> Solved — nicely done.
            </div>
          )}
          {status === "failed" && !reveal && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
              <X className="size-4 text-destructive" /> Not the move. Reset to try again or reveal the line.
            </div>
          )}
          {status === "playing" && (
            <p className="text-sm text-muted-foreground">
              {orientation === "white" ? "White" : "Black"} to move · drag a piece to play your move.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={reset}>
              <RotateCcw className="size-4" /> Reset
            </Button>
            <Button variant="outline" size="sm" onClick={giveUp}>
              <Lightbulb className="size-4" /> Show solution
            </Button>
            {playedSan.length > 0 && (
              <span className="font-mono text-sm text-muted-foreground">{playedSan.join("  ")}</span>
            )}
          </div>

          {reveal && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Solution</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-mono text-sm">{solutionSan.join("  ") || solution.join(" ")}</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Meta + model answers */}
        <div className="space-y-6">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-2xl font-bold">{p.puzzle_id}</h1>
              <Badge variant="secondary">Elo {p.rating}</Badge>
              <Badge variant="outline" className="capitalize">
                {p.categories.tier?.[0] ?? "—"}
              </Badge>
              {p.game_url && (
                <a href={p.game_url} target="_blank" className="text-xs text-muted-foreground underline">
                  source game
                </a>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {p.themes.map((t) => (
                <Badge key={t} variant="outline" className="text-xs font-normal">
                  {t}
                </Badge>
              ))}
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                How the models answered
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {entry.answers.filter((a) => a.item.solved).length}/{entry.answers.length} solved ·{" "}
                  {pct(entry.answers.filter((a) => a.item.solved).length / Math.max(1, entry.answers.length))}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {entry.answers
                .slice()
                .sort((a, b) => Number(b.item.solved) - Number(a.item.solved))
                .map((a, i) => {
                  const san = uciToSan(startFen, a.item.answer_move)
                  const open = expanded === i
                  const model = a.model.includes("/") ? a.model.split("/")[1] : a.model
                  return (
                    <div key={i} className="rounded-md border">
                      <button
                        className="flex w-full items-center gap-3 px-3 py-2 text-left"
                        onClick={() => setExpanded(open ? null : i)}
                      >
                        {a.item.solved ? (
                          <Check className="size-4 shrink-0 text-chart-2" />
                        ) : (
                          <X className="size-4 shrink-0 text-destructive/70" />
                        )}
                        <span className="font-medium">{model}</span>
                        <span className="font-mono text-sm text-muted-foreground">
                          {san ?? a.item.answer_move ?? "—"}
                        </span>
                        <Badge variant="outline" className="ml-auto text-xs font-normal">
                          {a.condition.split("__")[0]}
                        </Badge>
                        {!a.item.solved && a.item.failure_reason && (
                          <Badge variant="secondary" className="text-xs font-normal">
                            {a.item.failure_reason}
                          </Badge>
                        )}
                        {a.item.answer_explanation && (
                          <ChevronDown className={`size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
                        )}
                      </button>
                      {open && a.item.answer_explanation && (
                        <p className="border-t px-3 py-2 text-sm text-muted-foreground">{a.item.answer_explanation}</p>
                      )}
                    </div>
                  )
                })}
              {entry.answers.length === 0 && (
                <p className="text-sm text-muted-foreground">No model attempts recorded for this puzzle.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
