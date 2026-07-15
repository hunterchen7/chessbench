import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { Chess } from "chess.js"
import { ArrowLeft, Check, ChevronDown, Circle, Lightbulb, Play, RotateCcw, X } from "lucide-react"
import { useData } from "@/lib/useData"
import { loadPuzzle, type PuzzleEntry } from "@/lib/data"
import { pct, responseStyleInfo } from "@/lib/format"
import { solverMovesToSan, uciLineToSan, uciToSan } from "@/lib/chess"
import { humanRecord, type HumanOutcome } from "@/lib/human"
import { pushSolve } from "@/lib/backend"
import { Board } from "@/components/Board"
import { ResponseStyleBadge } from "@/components/ResponseStyle"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

type Status = "playing" | "solved" | "failed"
const EMPTY_SOLUTION: string[] = []

export function PuzzleDetail() {
  const { id = "" } = useParams()
  const { apiBase } = useData()
  const [entry, setEntry] = useState<PuzzleEntry | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    setEntry(undefined)
    setError(null)
    void loadPuzzle(id).then((value) => { if (active) setEntry(value) }).catch((reason) => { if (active) setError(String(reason)) })
    return () => { active = false }
  }, [id])
  if (error) return <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-6"><p className="font-medium text-destructive">Failed to load puzzle {id}</p><p className="text-sm text-muted-foreground">{error}</p><Button variant="outline" size="sm" onClick={() => window.location.reload()}>Retry</Button></div>
  if (entry === undefined) return <div className="py-20 text-center text-sm text-muted-foreground">Loading puzzle…</div>
  if (entry === null) return <div className="space-y-2"><p>Puzzle {id} not found.</p><Link to="/puzzles" className="text-sm underline">Back to puzzles</Link></div>
  return <PuzzleView key={id} id={id} entry={entry} apiBase={apiBase} />
}

function PuzzleView({ id, entry, apiBase }: { id: string; entry: PuzzleEntry; apiBase: string | null }) {

  // Record a human outcome both locally (offline points) and on the backend (shared
  // leaderboard). `move` is the player's first move; the server verifies it before crediting.
  const recordSolve = (solved: boolean, move: string | null, outcome: HumanOutcome = solved ? "solved" : "incorrect") => {
    humanRecord(id, outcome)
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

  const solution = entry.position.solution ?? EMPTY_SOLUTION
  const solutionSan = useMemo(() => uciLineToSan(startFen, solution), [startFen, solution])
  const solverMoves = Math.ceil(solution.length / 2)

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
      recordSolve(false, uci, "incorrect")
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
      setReveal(true)
      recordSolve(true, solution[0] ?? null)
    }
    return true
  }

  function giveUp() {
    if (status !== "solved") recordSolve(false, null, "revealed")
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

          <div aria-live="polite">
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
            <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2 text-sm">
              <span className="inline-flex items-center gap-2"><Play className="size-3.5 text-emerald-600" /> {orientation === "white" ? "White" : "Black"} to move · drag a piece to play.</span>
              <span className="font-mono text-xs text-muted-foreground">move {Math.floor(ply / 2) + 1}/{Math.max(1, solverMoves)}</span>
            </div>
          )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={reset}>
              <RotateCcw className="size-4" /> {status === "failed" ? "Try again" : "Reset"}
            </Button>
            <Button variant="outline" size="sm" onClick={giveUp}>
              <Lightbulb className="size-4" /> Show solution
            </Button>
            {playedSan.length > 0 && (
              <span className="font-mono text-sm text-muted-foreground">{playedSan.join("  ")}</span>
            )}
          </div>

          {reveal && (
            <Card className="animate-in fade-in-0 slide-in-from-top-1 duration-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Correct line</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                <p className="font-mono text-sm">{solutionSan.join("  ") || solution.join(" ")}</p>
                {solutionSan.length > 0 && <p className="font-mono text-[11px] text-muted-foreground">UCI · {solution.join(" ")}</p>}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Meta + model answers */}
        <div className="space-y-6">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-2xl font-bold">Play puzzle {p.puzzle_id}</h1>
              <Badge variant="secondary">Rating {p.rating}</Badge>
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
                .toSorted((a, b) => Number(b.item.solved) - Number(a.item.solved))
                .map((a, i) => {
                  const san = uciToSan(startFen, a.item.answer_move)
                  const storedMoves = a.item.moves_played?.length ? a.item.moves_played : a.item.answer_move ? [a.item.answer_move] : []
                  const playedSequence = solverMovesToSan(startFen, storedMoves, solution)
                  const partial = !a.item.solved && a.item.score > 0
                  const requiredSolverMoves = a.item.solver_plies ?? Math.ceil(solution.length / 2)
                  const correctSolverMoves = a.item.plies_correct ?? Math.round(a.item.score * requiredSolverMoves)
                  const open = expanded === i
                  const hasAudit = Boolean(a.item.answer_rationale || a.item.answer_explanation || a.item.answer_raw || a.item.turns?.length)
                  const model = a.model.includes("/") ? a.model.split("/")[1] : a.model
                  const responseStyle = responseStyleInfo(a.condition)
                  return (
                    <div key={i} className="rounded-md border">
                      <button
                        className="flex w-full items-center gap-3 px-3 py-2 text-left"
                        onClick={() => setExpanded(open ? null : i)}
                        disabled={!hasAudit}
                      >
                        {a.item.solved ? (
                          <Check className="size-4 shrink-0 text-chart-2" />
                        ) : partial ? (
                          <Circle className="size-4 shrink-0 fill-amber-500/20 text-amber-600" />
                        ) : (
                          <X className="size-4 shrink-0 text-destructive/70" />
                        )}
                        <span className="font-medium">{model}</span>
                        <span className="min-w-0 truncate font-mono text-sm text-muted-foreground" title={playedSequence.join(" ")}>
                          {playedSequence.length ? playedSequence.map((move, moveIndex) => <span key={`${move}-${moveIndex}`} className={moveIndex < correctSolverMoves ? "text-emerald-700 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300"}>{moveIndex ? "  " : ""}{move}</span>) : "no parsed move"}
                        </span>
                        <Badge variant="outline" className="ml-auto text-xs font-normal">
                          {a.condition.split("__")[0]}
                        </Badge>
                        <ResponseStyleBadge condition={a.condition} compact />
                        <Badge variant={a.item.solved ? "secondary" : "outline"} className="text-xs font-normal">
                          {a.item.solved ? "full line" : partial ? `${correctSolverMoves}/${requiredSolverMoves} solver moves` : a.item.failure_reason?.replaceAll("_", " ") ?? "not solved"}
                        </Badge>
                        {hasAudit && (
                          <ChevronDown className={`size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
                        )}
                      </button>
                      {open && hasAudit && <div className="space-y-3 border-t p-3 animate-in fade-in-0 slide-in-from-top-1 duration-200">
                        <div className="grid gap-2 rounded-md border bg-muted/20 p-2 text-xs sm:grid-cols-2">
                          <div><div className="mb-1 font-semibold uppercase tracking-wide text-muted-foreground">Model sequence</div><span className="font-mono">{playedSequence.join("  ") || san || a.item.answer_move || "—"}</span><div className="mt-1 text-muted-foreground">{a.item.solved ? "Complete line solved" : partial ? `${correctSolverMoves} correct solver move${correctSolverMoves === 1 ? "" : "s"}; ${storedMoves.length > correctSolverMoves ? `diverged on ${playedSequence[correctSolverMoves] ?? storedMoves[correctSolverMoves]}` : "the later failed move was not retained by this legacy run"} · ${a.item.score.toFixed(2)}/1 point` : `Incorrect at solver move ${correctSolverMoves + 1}`}</div></div>
                          <div><div className="mb-1 font-semibold uppercase tracking-wide text-muted-foreground">Correct line</div><span className="font-mono">{solutionSan.join(" ") || solution.join(" ") || "—"}</span></div>
                        </div>
                        {a.item.turns?.map((turn, turnIndex) => <details key={`${turn.solver_ply}-${turnIndex}`} className="rounded-md border bg-muted/20" open={turnIndex === 0}>
                          <summary className="cursor-pointer p-2 text-xs font-medium">Solver move {turn.solver_ply + 1} · {turn.parsed_move ?? "unparsed"}</summary>
                          <div className="space-y-2 border-t p-2 text-xs">
                            {turn.system_prompt && <div><div className="mb-1 font-semibold uppercase tracking-wide text-muted-foreground">System</div><pre className="whitespace-pre-wrap rounded bg-background p-2">{turn.system_prompt}</pre></div>}
                            {turn.prompt && <div><div className="mb-1 font-semibold uppercase tracking-wide text-muted-foreground">Prompt</div><pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded bg-background p-2">{turn.prompt}</pre></div>}
                            {(turn.rationale || turn.explanation) && <div><div className="mb-1 font-semibold uppercase tracking-wide text-muted-foreground">Model rationale</div><p className="rounded bg-background p-2 leading-relaxed">{turn.rationale ?? turn.explanation}</p></div>}
                            <div><div className="mb-1 font-semibold uppercase tracking-wide text-muted-foreground">Visible response</div><pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded bg-background p-2">{turn.raw_response ?? "—"}</pre></div>
                            <div className="flex flex-wrap items-center gap-3 font-mono text-muted-foreground">
                              {turn.response_format_valid != null && <Badge variant={turn.response_format_valid ? "secondary" : "destructive"}>{turn.response_format_valid ? (responseStyle.key === "move_only" ? "parseable text" : "valid JSON") : "format recovered"}</Badge>}
                              <span>{turn.prompt_tokens} prompt</span><span>{turn.completion_tokens} completion</span><span>{turn.reasoning_tokens} reasoning</span><span>${turn.cost_usd.toFixed(5)}</span>
                            </div>
                            {turn.response_format_error && <p className="text-[11px] text-destructive">{turn.response_format_error}</p>}
                          </div>
                        </details>)}
                        {!a.item.turns?.length && <>
                          {(a.item.answer_rationale || a.item.answer_explanation) && <><div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Model rationale</div><p className="rounded bg-muted/30 p-3 text-xs leading-relaxed">{a.item.answer_rationale ?? a.item.answer_explanation}</p></>}
                          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Visible response</div><pre className="whitespace-pre-wrap rounded bg-muted/30 p-3 text-xs">{a.item.answer_raw ?? "—"}</pre>
                        </>}
                      </div>}
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
