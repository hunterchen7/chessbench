import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { Chess } from "chess.js"
import { ArrowLeft, ArrowRight, Check, ChevronDown, Circle, Lightbulb, Play, RotateCcw, X } from "lucide-react"
import { useData } from "@/lib/useData"
import { loadPuzzle, loadPuzzleIndex, type PuzzleEntry } from "@/lib/data"
import { pct } from "@/lib/format"
import { puzzleContinuation, puzzleModelAttempts, uciLineToSan, type PuzzleContinuationPly } from "@/lib/chess"
import { humanRecord, type HumanOutcome } from "@/lib/human"
import { pushSolve } from "@/lib/backend"
import { Board } from "@/components/Board"
import { BoardDetailSkeleton } from "@/components/LoadingSkeletons"
import { ModelIdentity } from "@/components/ModelIdentity"
import { ResponseStyleBadge } from "@/components/ResponseStyle"
import { ExportButton } from "@/components/ExportButton"
import { ExactPromptBlock, PromptTranscript } from "@/components/PromptTranscript"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

type Status = "playing" | "solved" | "revealed"
const EMPTY_SOLUTION: string[] = []

function fallbackModelName(model: string): string {
  const providerName = model.split("/").at(-1) ?? model
  return providerName.split("--r-")[0]
}

function ModelContinuation({ plies }: { plies: PuzzleContinuationPly[] }) {
  return <span className="inline-flex flex-wrap items-center gap-1 font-mono text-xs">
    {plies.length ? plies.map((ply, index) => <span key={`${ply.source}-${ply.uci}-${index}`} title={`${ply.source === "model" ? "Model move" : "Built-in puzzle reply"} · ${ply.uci}`} className={ply.status === "wrong" ? "rounded bg-rose-500/12 px-1.5 py-0.5 font-semibold text-rose-700 ring-1 ring-inset ring-rose-500/25 dark:text-rose-300" : ply.source === "puzzle" ? "rounded bg-muted px-1.5 py-0.5 text-muted-foreground ring-1 ring-inset ring-border" : "rounded bg-emerald-500/10 px-1.5 py-0.5 font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-500/20 dark:text-emerald-300"}>{ply.san}</span>) : <span className="text-muted-foreground">no move</span>}
  </span>
}

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
  if (entry === undefined) return <BoardDetailSkeleton label={`Loading puzzle ${id}`} />
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
  const [mistake, setMistake] = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [nextId, setNextId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void loadPuzzleIndex().then((entries) => {
      if (!active) return
      const index = entries.findIndex((candidate) => candidate.position.puzzle_id === id)
      const next = entries[(index + 1 + entries.length) % entries.length]
      setNextId(next?.position.puzzle_id ?? null)
    })
    return () => { active = false }
  }, [id])

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
    setMistake(false)
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
      setMistake(true)
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
    setMistake(false)
    if (idx >= solution.length) {
      setStatus("solved")
      setReveal(true)
      recordSolve(true, solution[0] ?? null)
    }
    return true
  }

  function giveUp() {
    if (status !== "solved") recordSolve(false, null, "revealed")
    setStatus("revealed")
    setReveal(true)
  }

  const playedSan = uciLineToSan(startFen, solution.slice(0, ply))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><Link to="/puzzles/browse" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Puzzle browser
      </Link><ExportButton track="puzzle" puzzle={id} label="Export this puzzle" /></div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,620px)_minmax(300px,1fr)] xl:gap-8">
        <div className="overflow-hidden rounded-xl border bg-card shadow-xl shadow-black/5 dark:shadow-black/20">
          <Board fen={fen} orientation={orientation} onPieceDrop={status === "playing" ? onPieceDrop : undefined} maxWidth={620} />
        </div>

        <Card className="overflow-hidden border-border/70 lg:min-h-[420px]">
          <CardContent className="flex min-h-[420px] flex-col p-0">
            <div className="border-b p-5">
              <div className="flex items-center justify-between gap-3">
                <h1 className="text-xl font-semibold tracking-tight">Solve the position</h1>
                <span className="font-mono text-xs text-muted-foreground">{Math.floor(ply / 2) + 1}/{Math.max(1, solverMoves)}</span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{orientation === "white" ? "White" : "Black"} to move · click or drag a piece.</p>
            </div>

            <div className="flex flex-1 flex-col justify-center p-5" aria-live="polite">
              {status === "playing" && !mistake && <div className="flex items-center gap-4"><div className="grid size-14 shrink-0 place-items-center rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"><Play className="size-6 fill-current" /></div><div><div className="text-xl font-semibold">Your turn</div><div className="text-sm text-muted-foreground">Find the best move for {orientation}.</div></div></div>}
              {status === "playing" && mistake && <div className="flex items-center gap-4 animate-in fade-in-0 zoom-in-95 duration-200"><div className="grid size-14 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive"><X className="size-7" /></div><div><div className="text-xl font-semibold">Not the move</div><div className="text-sm text-muted-foreground">Try something else, or reveal the solution.</div></div></div>}
              {status === "solved" && <div className="flex items-center gap-4 animate-in fade-in-0 zoom-in-95 duration-300"><div className="grid size-14 shrink-0 place-items-center rounded-full bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"><Check className="size-7" /></div><div><div className="text-xl font-semibold">Puzzle complete</div><div className="text-sm text-muted-foreground">You found the full line.</div></div></div>}
              {status === "revealed" && <div className="flex items-center gap-4 animate-in fade-in-0 zoom-in-95 duration-300"><div className="grid size-14 shrink-0 place-items-center rounded-full bg-amber-500/12 text-amber-700 dark:text-amber-300"><Lightbulb className="size-7" /></div><div><div className="text-xl font-semibold">Solution revealed</div><div className="text-sm text-muted-foreground">Review the idea, then try the next one.</div></div></div>}

              {playedSan.length > 0 && <div className="mt-5 rounded-lg border bg-muted/20 p-3"><div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Moves played</div><div className="mt-1 font-mono text-sm">{playedSan.join("  ")}</div></div>}

              {reveal && <div className="mt-5 space-y-4 border-t pt-5 animate-in fade-in-0 slide-in-from-top-1 duration-300">
                <div><div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Correct line</div><p className="mt-1 font-mono text-sm font-medium">{solutionSan.join("  ") || solution.join(" ")}</p><p className="mt-1 font-mono text-[11px] text-muted-foreground">UCI · {solution.join(" ")}</p></div>
                <div className="flex flex-wrap items-center gap-1.5"><Badge variant="secondary">Rating {p.rating}</Badge><Badge variant="outline" className="capitalize">{p.categories.tier?.[0] ?? "—"}</Badge>{p.themes.slice(0, 4).map((theme) => <Badge key={theme} variant="outline" className="text-xs font-normal">{theme}</Badge>)}</div>
                {p.game_url && <a href={p.game_url} target="_blank" rel="noreferrer" className="inline-flex text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">View source game</a>}
              </div>}
            </div>

            <div className="flex flex-wrap gap-2 border-t bg-muted/15 p-4">
              <Button variant="outline" size="sm" onClick={reset}><RotateCcw className="size-4" /> Reset</Button>
              {!reveal && <Button variant="ghost" size="sm" onClick={giveUp}><Lightbulb className="size-4" /> View solution</Button>}
              {reveal && nextId && <Button asChild size="sm" className="ml-auto"><Link to={`/puzzles/${nextId}`}>Next puzzle <ArrowRight className="size-4" /></Link></Button>}
            </div>
          </CardContent>
        </Card>
      </div>

      {reveal ? (
          <Card className="animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
            <CardHeader>
              <CardTitle className="text-base">
                How the models answered
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {entry.answers.filter((a) => a.item.solved).length}/{entry.answers.length} solved ·{" "}
                  {pct(entry.answers.filter((a) => a.item.solved).length / Math.max(1, entry.answers.length))}
                </span>
              </CardTitle>
              <p className="text-xs text-muted-foreground">Expand any model to inspect and copy the exact system and user messages for every solver move.</p>
            </CardHeader>
            <CardContent className="space-y-2">
              {entry.answers
                .toSorted((a, b) => Number(b.item.solved) - Number(a.item.solved))
                .map((a, i) => {
                  const attemptedMoves = puzzleModelAttempts(a.item)
                  const partial = !a.item.solved && a.item.score > 0
                  const requiredSolverMoves = a.item.solver_plies ?? Math.ceil(solution.length / 2)
                  const correctSolverMoves = a.item.plies_correct ?? Math.round(a.item.score * requiredSolverMoves)
                  const playedSequence = puzzleContinuation(startFen, attemptedMoves, solution, correctSolverMoves)
                  const open = expanded === i
                  const hasAudit = Boolean(a.item.answer_rationale || a.item.answer_explanation || a.item.answer_raw || a.item.turns?.length)
                  const model = fallbackModelName(a.model)
                  return (
                    <div key={a.run_id ?? `${a.model}-${a.condition}-${i}`} className="rounded-md border">
                      <button
                        className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/35 disabled:cursor-default disabled:hover:bg-transparent"
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
                        <div className="w-48 shrink-0">
                          {a.model_variant ? <ModelIdentity variant={a.model_variant} compact /> : <span className="block truncate font-medium" title={model}>{model}</span>}
                        </div>
                        <span className="min-w-0 flex-1"><ModelContinuation plies={playedSequence} /></span>
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
                          <div><div className="mb-1 font-semibold uppercase tracking-wide text-muted-foreground">Experienced continuation</div><ModelContinuation plies={playedSequence} /><div className="mt-1 text-muted-foreground">Green moves came from the model; neutral moves were supplied by the puzzle; red is the first divergence. {a.item.solved ? "Complete line solved." : partial ? `${correctSolverMoves} correct solver move${correctSolverMoves === 1 ? "" : "s"} · ${a.item.score.toFixed(2)}/1 point.` : `Incorrect at solver move ${correctSolverMoves + 1}.`}</div></div>
                          <div><div className="mb-1 font-semibold uppercase tracking-wide text-muted-foreground">Correct line</div><span className="font-mono">{solutionSan.join(" ") || solution.join(" ") || "—"}</span></div>
                        </div>
                        {a.item.turns?.length ? <PromptTranscript turns={a.item.turns} /> : null}
                        {!a.item.turns?.length && <>
                          {(a.item.answer_rationale || a.item.answer_explanation) && <><div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Model rationale</div><p className="rounded bg-muted/30 p-3 text-xs leading-relaxed">{a.item.answer_rationale ?? a.item.answer_explanation}</p></>}
                          <ExactPromptBlock label="Visible model response" text={a.item.answer_raw ?? "—"} tone="schema" />
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
      ) : (
        <Card className="border-dashed bg-card/40">
          <CardContent className="flex items-center gap-4 py-6">
            <div className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary"><Lightbulb className="size-4 text-muted-foreground" /></div>
            <div><div className="font-medium">Model attempts stay hidden while you solve</div><div className="text-sm text-muted-foreground">Complete the puzzle or view the solution to inspect every model line and transcript without spoilers.</div></div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
