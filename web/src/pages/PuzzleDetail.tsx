import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { Chess, type Square } from "chess.js"
import { ArrowLeft, ArrowRight, Check, Circle, Gauge, Lightbulb, Play, RotateCcw, X } from "lucide-react"
import { useData } from "@/lib/useData"
import {
  RATED_PUZZLE_PAGE_SIZE,
  loadPuzzle,
  loadPuzzleIndex,
  loadSeededRatedPuzzle,
  loadSeededRatedPuzzlePreview,
  loadRatedPuzzlePage,
  ratedPuzzleQueryFromSearchParams,
  ratedPuzzleQueryParams,
  type PuzzleEntry,
  type PuzzlePosition,
  type RatedPuzzleQuery,
  type SeededRatedPuzzlePreview,
} from "@/lib/data"
import { pct } from "@/lib/format"
import { puzzleContinuation, puzzleModelAttempts, uciLineToSan, type PuzzleContinuationPly } from "@/lib/chess"
import { humanRecord, type HumanOutcome } from "@/lib/human"
import {
  PROVISIONAL_DEVIATION,
  SETTLED_DEVIATION,
  humanTrainingRecord,
  humanTrainingSelected,
  humanTrainingSession,
  humanTrainingSettled,
  updateHumanGlicko,
  type HumanTrainingResult,
  type HumanTrainingSession,
} from "@/lib/humanTraining"
import { pushSolve } from "@/lib/backend"
import { Board } from "@/components/Board"
import { BoardDetailSkeleton } from "@/components/LoadingSkeletons"
import { ModelIdentity } from "@/components/ModelIdentity"
import { ResponseStyleBadge } from "@/components/ResponseStyle"
import { ExportButton } from "@/components/ExportButton"
import { HumanTrainingSave } from "@/components/HumanTrainingSave"
import { ExactPromptBlock, PromptTranscript } from "@/components/PromptTranscript"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

type Status = "playing" | "solved" | "revealed"
type PromotionPiece = "q" | "r" | "b" | "n"
type PendingPromotion = { from: string; to: string; color: "w" | "b" }

const PROMOTION_OPTIONS: Array<{ piece: PromotionPiece; label: string }> = [
  { piece: "q", label: "Queen" },
  { piece: "r", label: "Rook" },
  { piece: "b", label: "Bishop" },
  { piece: "n", label: "Knight" },
]

const PROMOTION_GLYPHS: Record<PendingPromotion["color"], Record<PromotionPiece, string>> = {
  w: { q: "♕", r: "♖", b: "♗", n: "♘" },
  b: { q: "♛", r: "♜", b: "♝", n: "♞" },
}
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
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const { apiBase } = useData()
  const training = searchParams.get("source") === "train"
  const trainingPoolHash = training ? searchParams.get("pool_hash") : null
  const ratedIndexParam = searchParams.get("index")
  const ratedIndexValue = searchParams.get("source") === "rated" && ratedIndexParam != null
    ? Number(ratedIndexParam)
    : Number.NaN
  const ratedIndex = Number.isSafeInteger(ratedIndexValue) && ratedIndexValue >= 0 ? ratedIndexValue : null
  const ratedQueryKey = searchParams.toString()
  const ratedQuery = useMemo(() => ratedPuzzleQueryFromSearchParams(new URLSearchParams(ratedQueryKey)), [ratedQueryKey])
  const navigationPosition = training
    ? (location.state as { trainingPuzzle?: PuzzlePosition } | null)?.trainingPuzzle
    : undefined
  const immediateEntry = useMemo(() => navigationPosition?.puzzle_id === id
    ? { position: navigationPosition, answers: [] } satisfies PuzzleEntry
    : undefined, [id, navigationPosition])
  const [entry, setEntry] = useState<PuzzleEntry | null | undefined>(() => immediateEntry)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    setEntry(immediateEntry)
    setError(null)
    void loadPuzzle(id, trainingPoolHash).then((value) => { if (active) setEntry(value) }).catch((reason) => { if (active) setError(String(reason)) })
    return () => { active = false }
  }, [id, immediateEntry, trainingPoolHash])
  const currentEntry = entry?.position.puzzle_id === id ? entry : immediateEntry
  if (error) return <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-6"><p className="font-medium text-destructive">Failed to load puzzle {id}</p><p className="text-sm text-muted-foreground">{error}</p><Button variant="outline" size="sm" onClick={() => window.location.reload()}>Retry</Button></div>
  if (currentEntry === undefined) return <BoardDetailSkeleton label={`Loading puzzle ${id}`} />
  if (currentEntry === null) return <div className="space-y-2"><p>Puzzle {id} not found.</p><Link to="/puzzles" className="text-sm underline">Back to puzzles</Link></div>
  return <PuzzleView key={id} id={id} entry={currentEntry} apiBase={apiBase} ratedIndex={ratedIndex} ratedQuery={ratedQuery} training={training} />
}

function PuzzleView({ id, entry, apiBase, ratedIndex, ratedQuery, training }: { id: string; entry: PuzzleEntry; apiBase: string | null; ratedIndex: number | null; ratedQuery: RatedPuzzleQuery; training: boolean }) {
  const navigate = useNavigate()
  const p = entry.position
  const startFen = entry.position.fen
  const orientation: "white" | "black" = entry.position.solver_is_white ? "white" : "black"

  const gameRef = useRef(new Chess(startFen))
  const [fen, setFen] = useState(startFen)
  const [status, setStatus] = useState<Status>("playing")
  const [ply, setPly] = useState(0)
  const [reveal, setReveal] = useState(false)
  const [mistake, setMistake] = useState(false)
  const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion | null>(null)
  const [nextPuzzle, setNextPuzzle] = useState<{ id: string; index: number | null; position?: PuzzlePosition; trainingSearch?: string } | null>(null)
  const [trainingSession, setTrainingSession] = useState<HumanTrainingSession>(() => humanTrainingSession())
  const [trainingResult, setTrainingResult] = useState<HumanTrainingResult | null>(null)
  const [routePreview, setRoutePreview] = useState<{
    win: SeededRatedPuzzlePreview
    loss: SeededRatedPuzzlePreview
  } | null>(null)
  const trainingRatedRef = useRef(
    training && trainingSession.recent_attempts.some((attempt) => attempt.puzzle_id === id),
  )
  const trainingRating = trainingSession.state.rating
  const trainingRecentPuzzleIds = trainingSession.recent_puzzle_ids
  const trainingSelector = trainingSession.selector

  useEffect(() => {
    setRoutePreview(null)
    if (!training || !apiBase || !trainingSelector || trainingRatedRef.current) return
    const controller = new AbortController()
    const options = (solved: boolean) => ({
      rating: updateHumanGlicko(
        trainingSession.state,
        p.rating,
        p.rating_deviation ?? 500,
        solved,
      ).rating,
      seed: trainingSelector.seed,
      sequence: trainingSelector.next_sequence,
      targetRadius: trainingSelector.target_radius,
      poolHash: trainingSelector.pool_hash,
      excluded: trainingRecentPuzzleIds,
    })
    void Promise.all([
      loadSeededRatedPuzzlePreview(apiBase, options(true), controller.signal),
      loadSeededRatedPuzzlePreview(apiBase, options(false), controller.signal),
    ]).then(([win, loss]) => setRoutePreview({ win, loss })).catch(() => {})
    return () => controller.abort()
  }, [apiBase, p.rating, p.rating_deviation, training, trainingRecentPuzzleIds, trainingSelector, trainingSession.state])

  // Record public progress separately from the adaptive rating. The first wrong
  // move or full solve rates the training puzzle exactly once.
  const recordSolve = (solved: boolean, move: string | null, outcome: HumanOutcome = solved ? "solved" : "incorrect") => {
    humanRecord(id, outcome)
    if (apiBase) void pushSolve(apiBase, id, solved, move)
    if (!training || trainingRatedRef.current) return
    trainingRatedRef.current = true
    const result = humanTrainingRecord(id, p.rating, p.rating_deviation ?? 500, solved)
    if (!result.duplicate) setTrainingResult(result)
    setTrainingSession(result.session)
  }

  useEffect(() => {
    let active = true
    setNextPuzzle(null)
    if (training) {
      if (!reveal || !apiBase || !trainingSelector) return () => { active = false }
      const controller = new AbortController()
      void loadSeededRatedPuzzle(apiBase, {
        rating: trainingRating,
        seed: trainingSelector.seed,
        sequence: trainingSelector.next_sequence,
        targetRadius: trainingSelector.target_radius,
        poolHash: trainingSelector.pool_hash,
        excluded: trainingRecentPuzzleIds,
      }, controller.signal).then((selection) => {
        if (!active) return
        humanTrainingSelected({
          puzzleId: selection.puzzle.puzzle_id,
          poolHash: selection.pool.content_hash,
          seed: selection.selection.seed,
          sequence: selection.selection.sequence,
          targetRadius: trainingSelector.target_radius,
        })
        const params = new URLSearchParams({
          source: "train",
          selection: selection.selection_id,
          seed: String(selection.selection.seed),
          pool_hash: selection.pool.content_hash,
          target_radius: String(trainingSelector.target_radius),
          sequence: String(selection.selection.sequence),
        })
        setNextPuzzle({
          id: selection.puzzle.puzzle_id,
          index: null,
          position: selection.puzzle,
          trainingSearch: params.toString(),
        })
      }).catch(() => {})
      return () => { active = false; controller.abort() }
    }
    if (ratedIndex != null && apiBase) {
      const nextIndex = ratedIndex + 1
      const pageSize = RATED_PUZZLE_PAGE_SIZE
      const loadNext = async () => {
        try {
          const page = await loadRatedPuzzlePage(apiBase, Math.floor(nextIndex / pageSize) + 1, pageSize, undefined, ratedQuery)
          const next = page.puzzles[nextIndex % pageSize]
          if (active && next) setNextPuzzle({ id: next.puzzle_id, index: nextIndex })
        } catch (reason) {
          if (!String(reason).endsWith(": 404")) return
          const first = await loadRatedPuzzlePage(apiBase, 1, pageSize, undefined, ratedQuery).catch(() => null)
          const next = first?.puzzles[0]
          if (active && next) setNextPuzzle({ id: next.puzzle_id, index: 0 })
        }
      }
      void loadNext()
      return () => { active = false }
    }
    void loadPuzzleIndex().then((entries) => {
      if (!active) return
      const index = entries.findIndex((candidate) => candidate.position.puzzle_id === id)
      const next = entries[(index + 1 + entries.length) % entries.length]
      setNextPuzzle(next ? { id: next.position.puzzle_id, index: null } : null)
    })
    return () => { active = false }
  }, [apiBase, id, ratedIndex, ratedQuery, reveal, training, trainingRating, trainingRecentPuzzleIds, trainingSelector])

  const solution = entry.position.solution ?? EMPTY_SOLUTION
  const solutionSan = useMemo(() => uciLineToSan(startFen, solution), [startFen, solution])
  const solverMoves = Math.ceil(solution.length / 2)
  const displayedSolverMove = Math.min(Math.floor(ply / 2) + 1, Math.max(1, solverMoves))

  const ratedBrowseParams = ratedPuzzleQueryParams(ratedQuery)
  ratedBrowseParams.set("view", "rated")
  const ratedBrowserTo = `/puzzles/browse?${ratedBrowseParams}`
  const nextRatedPuzzleTo = nextPuzzle?.index == null ? null : (() => {
    const params = ratedPuzzleQueryParams(ratedQuery)
    params.set("source", "rated")
    params.set("index", String(nextPuzzle.index))
    return `/puzzles/${encodeURIComponent(nextPuzzle.id)}?${params}`
  })()

  function reset() {
    gameRef.current = new Chess(startFen)
    setFen(startFen)
    setStatus("playing")
    setPly(0)
    setReveal(false)
    setMistake(false)
    setPendingPromotion(null)
  }

  function onPieceDrop(from: string, to: string): boolean {
    if (status !== "playing") return false
    const g = gameRef.current
    const piece = g.get(from as Square)
    const promotionRank = piece?.color === "w" ? "8" : "1"
    const isLegalPromotion = piece?.type === "p" && to.endsWith(promotionRank) && g
      .moves({ square: from as Square, verbose: true })
      .some((candidate) => candidate.to === to && candidate.promotion)
    if (isLegalPromotion) {
      setPendingPromotion({ from, to, color: piece.color })
      return false
    }
    return submitMove(from, to)
  }

  function submitMove(from: string, to: string, promotion?: PromotionPiece): boolean {
    if (status !== "playing") return false
    const g = gameRef.current
    const expected = solution[ply]
    if (!expected) return false
    let move
    try {
      move = g.move(promotion ? { from, to, promotion } : { from, to })
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

  function choosePromotion(promotion: PromotionPiece) {
    if (!pendingPromotion) return
    const { from, to } = pendingPromotion
    setPendingPromotion(null)
    submitMove(from, to, promotion)
  }

  function giveUp() {
    if (training && !trainingRatedRef.current) recordSolve(false, null, "revealed")
    setStatus("revealed")
    setReveal(true)
  }

  function resetTrainingRun() {
    if (!trainingSelector) return
    const confirmed = window.confirm(
      `Reset seed ${trainingSelector.seed}? This clears your local rating and all attempts for this run.`,
    )
    if (!confirmed) return
    const params = new URLSearchParams({
      seed: String(trainingSelector.seed),
      target_radius: String(trainingSelector.target_radius),
      restart: "1",
    })
    if (trainingSelector.pool_hash) params.set("pool_hash", trainingSelector.pool_hash)
    navigate(`/puzzles/play?${params}`)
  }

  const playedSan = uciLineToSan(startFen, solution.slice(0, ply))
  const ratingDelta = trainingResult ? Math.round(trainingResult.after.rating - trainingResult.before.rating) : null
  const trainingState = trainingSession.state
  const trainingIsSettled = humanTrainingSettled(trainingSession)
  const trainingCanSave = trainingState.deviation < SETTLED_DEVIATION
  const modelCount = new Set(entry.answers.map((answer) => answer.model)).size
  const trainingNextTo = nextPuzzle
    ? `/puzzles/${encodeURIComponent(nextPuzzle.id)}?${nextPuzzle.trainingSearch ?? "source=train"}`
    : "/puzzles/play"

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><Link to={training ? "/puzzles" : ratedIndex == null ? "/puzzles/browse?view=fixed" : ratedBrowserTo} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {training ? "End training" : "Puzzle browser"}
      </Link><div className="flex flex-wrap items-center gap-2">{training && trainingSelector ? <Button type="button" variant="outline" size="sm" onClick={resetTrainingRun}><RotateCcw className="size-4" /> Reset run</Button> : null}<ExportButton track="puzzle" puzzle={id} label="Export this puzzle" /></div></div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,620px)_minmax(300px,1fr)] xl:gap-8">
        <div className="relative overflow-hidden rounded-xl border bg-card shadow-xl shadow-black/5 dark:shadow-black/20">
          <Board fen={fen} orientation={orientation} onPieceDrop={status === "playing" ? onPieceDrop : undefined} maxWidth={620} />
          {pendingPromotion ? <div className="absolute inset-0 z-20 grid place-items-center bg-black/55 p-4 backdrop-blur-[1px] animate-in fade-in-0 duration-150" role="dialog" aria-modal="true" aria-labelledby="promotion-title">
            <div className="w-full max-w-sm rounded-xl border bg-card p-4 shadow-2xl animate-in fade-in-0 zoom-in-95 duration-200">
              <div id="promotion-title" className="text-center text-base font-semibold">Choose promotion</div>
              <p className="mt-1 text-center text-xs text-muted-foreground">Select the piece for your pawn.</p>
              <div className="mt-4 grid grid-cols-4 gap-2">
                {PROMOTION_OPTIONS.map(({ piece, label }, index) => <button
                  key={piece}
                  type="button"
                  autoFocus={index === 0}
                  aria-label={`Promote to ${label}`}
                  className="flex aspect-square flex-col items-center justify-center rounded-lg border bg-background text-4xl leading-none transition-all hover:-translate-y-0.5 hover:border-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => choosePromotion(piece)}
                >
                  <span aria-hidden="true">{PROMOTION_GLYPHS[pendingPromotion.color][piece]}</span>
                  <span className="mt-1 text-[10px] font-medium leading-none text-muted-foreground">{label}</span>
                </button>)}
              </div>
              <Button type="button" variant="ghost" size="sm" className="mt-3 w-full" onClick={() => setPendingPromotion(null)}>Cancel</Button>
            </div>
          </div> : null}
        </div>

        <Card className="overflow-hidden border-border/70 lg:min-h-[420px]">
          <CardContent className="flex min-h-[420px] flex-col p-0">
            <div className="border-b p-5">
              <div className="flex items-center justify-between gap-3">
                <h1 className="text-xl font-semibold tracking-tight">Solve the position</h1>
                <div className="flex items-center gap-2">{training && trainingSelector ? <Badge variant="outline" className="font-mono text-[10px]">Seed {trainingSelector.seed} · puzzle {trainingSelector.next_sequence} · RD {Math.round(trainingState.deviation)}</Badge> : null}<span className="font-mono text-xs text-muted-foreground">{displayedSolverMove}/{Math.max(1, solverMoves)}</span></div>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{orientation === "white" ? "White" : "Black"} to move · click or drag a piece.</p>
            </div>

            {training && <div className="grid grid-cols-3 border-b bg-muted/15 text-center">
              <div className="border-r px-3 py-3"><div className="flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"><Gauge className="size-3" /> Rating</div><div className="mt-1 font-mono text-lg font-semibold tabular-nums">{Math.round(trainingState.rating).toLocaleString()}</div>{ratingDelta != null && <div className={ratingDelta >= 0 ? "text-[10px] font-medium text-emerald-600 dark:text-emerald-300" : "text-[10px] font-medium text-destructive"}>{ratingDelta >= 0 ? "+" : ""}{ratingDelta}</div>}</div>
              <div className="border-r px-3 py-3"><div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Rating deviation</div><div className="mt-1 font-mono text-lg font-semibold tabular-nums">{Math.round(trainingState.deviation)}</div><div className="text-[10px] text-muted-foreground">{trainingIsSettled ? "settled" : trainingState.deviation >= PROVISIONAL_DEVIATION ? "provisional" : "converging"}</div></div>
              <div className="px-3 py-3"><div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Record</div><div className="mt-1 font-mono text-lg font-semibold tabular-nums">{trainingSession.solved}/{trainingSession.attempts}</div><div className="text-[10px] text-muted-foreground">rated attempts</div></div>
            </div>}
            {training && trainingCanSave && apiBase ? <HumanTrainingSave apiBase={apiBase} session={trainingSession} /> : null}
            {training && !trainingRatedRef.current && <div className="grid grid-cols-2 border-b bg-muted/10">
              <div className="border-r px-4 py-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">If you solve it</div>
                {routePreview ? <div className="mt-1 flex items-baseline justify-between gap-2"><span className="font-mono text-sm font-semibold">{routePreview.win.puzzle.puzzle_id}</span><span className="font-mono text-xs text-muted-foreground">Rating {routePreview.win.puzzle.rating.toLocaleString()}</span></div> : <div className="mt-2 h-4 w-24 animate-pulse rounded bg-muted" />}
              </div>
              <div className="px-4 py-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-rose-700 dark:text-rose-300">If you miss it</div>
                {routePreview ? <div className="mt-1 flex items-baseline justify-between gap-2"><span className="font-mono text-sm font-semibold">{routePreview.loss.puzzle.puzzle_id}</span><span className="font-mono text-xs text-muted-foreground">Rating {routePreview.loss.puzzle.rating.toLocaleString()}</span></div> : <div className="mt-2 h-4 w-24 animate-pulse rounded bg-muted" />}
              </div>
            </div>}

            <div className="flex flex-1 flex-col justify-center p-5" aria-live="polite">
              {status === "playing" && !mistake && <div className="flex items-center gap-4"><div className="grid size-14 shrink-0 place-items-center rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"><Play className="size-6 fill-current" /></div><div><div className="text-xl font-semibold">Your turn</div><div className="text-sm text-muted-foreground">Find the best move for {orientation}.</div></div></div>}
              {status === "playing" && mistake && <div className="flex items-center gap-4 animate-in fade-in-0 zoom-in-95 duration-200"><div className="grid size-14 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive"><X className="size-7" /></div><div><div className="text-xl font-semibold">Not the move</div><div className="text-sm text-muted-foreground">{training ? "Rated as a miss. You can still retry or review the solution." : "Try something else, or reveal the solution."}</div></div></div>}
              {status === "solved" && <div className="flex items-center gap-4 animate-in fade-in-0 zoom-in-95 duration-300"><div className="grid size-14 shrink-0 place-items-center rounded-full bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"><Check className="size-7" /></div><div><div className="text-xl font-semibold">Puzzle complete</div><div className="text-sm text-muted-foreground">{trainingResult && !trainingResult.solved ? "Solved on retry; the first miss was the rated result." : "You found the full line."}</div></div></div>}
              {status === "revealed" && <div className="flex items-center gap-4 animate-in fade-in-0 zoom-in-95 duration-300"><div className="grid size-14 shrink-0 place-items-center rounded-full bg-amber-500/12 text-amber-700 dark:text-amber-300"><Lightbulb className="size-7" /></div><div><div className="text-xl font-semibold">Solution revealed</div><div className="text-sm text-muted-foreground">{training ? "Rated as a miss, matching the benchmark protocol." : "Review the idea, then try the next one."}</div></div></div>}

              {playedSan.length > 0 && <div className="mt-5 rounded-lg border bg-muted/20 p-3"><div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Moves played</div><div className="mt-1 font-mono text-sm">{playedSan.join("  ")}</div></div>}

              {reveal && <div className="mt-5 space-y-4 border-t pt-5 animate-in fade-in-0 slide-in-from-top-1 duration-300">
                <div><div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Correct line</div><p className="mt-1 font-mono text-sm font-medium">{solutionSan.join("  ") || solution.join(" ")}</p><p className="mt-1 font-mono text-[11px] text-muted-foreground">UCI · {solution.join(" ")}</p></div>
                <div className="flex flex-wrap items-center gap-1.5"><Badge variant="secondary">Rating {p.rating}</Badge><Badge variant="outline" className="capitalize">{p.categories?.tier?.[0] ?? "—"}</Badge>{(p.themes ?? []).slice(0, 4).map((theme) => <Badge key={theme} variant="outline" className="text-xs font-normal">{theme}</Badge>)}</div>
                {p.game_url && <a href={p.game_url} target="_blank" rel="noreferrer" className="inline-flex text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">View source game</a>}
              </div>}
            </div>

            <div className="flex flex-wrap gap-2 border-t bg-muted/15 p-4">
              <Button variant="outline" size="sm" onClick={reset}><RotateCcw className="size-4" /> Reset puzzle</Button>
              {!reveal && <Button variant="ghost" size="sm" onClick={giveUp}><Lightbulb className="size-4" /> View solution</Button>}
              {reveal && training && <Button asChild size="sm" className="ml-auto"><Link to={trainingNextTo} state={nextPuzzle?.position ? { trainingPuzzle: nextPuzzle.position } : undefined}>Next puzzle <ArrowRight className="size-4" /></Link></Button>}
              {reveal && !training && nextPuzzle && <Button asChild size="sm" className="ml-auto"><Link to={nextPuzzle.index == null ? `/puzzles/${nextPuzzle.id}` : nextRatedPuzzleTo ?? `/puzzles/${nextPuzzle.id}`}>Next puzzle <ArrowRight className="size-4" /></Link></Button>}
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
            <CardContent>
              <Accordion type="multiple" className="space-y-2">
                {entry.answers
                  .toSorted((a, b) => Number(b.item.solved) - Number(a.item.solved))
                  .map((a, i) => {
                  const attemptedMoves = puzzleModelAttempts(a.item)
                  const partial = !a.item.solved && a.item.score > 0
                  const requiredSolverMoves = a.item.solver_plies ?? Math.ceil(solution.length / 2)
                  const correctSolverMoves = a.item.plies_correct ?? Math.round(a.item.score * requiredSolverMoves)
                  const playedSequence = puzzleContinuation(startFen, attemptedMoves, solution, correctSolverMoves)
                  const hasAudit = Boolean(a.item.answer_rationale || a.item.answer_explanation || a.item.answer_raw || a.item.turns?.length)
                  const model = fallbackModelName(a.model)
                  const accordionKey = a.run_id ?? `${a.model}-${a.condition}-${i}`
                  return (
                    <AccordionItem key={accordionKey} value={accordionKey} className="rounded-md border last:border-b">
                      <AccordionTrigger
                        className={`w-full items-center gap-3 px-3 py-2 font-normal transition-colors hover:bg-muted/35 disabled:cursor-default disabled:hover:bg-transparent ${hasAudit ? "[&>svg]:duration-300" : "[&>svg]:hidden"}`}
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
                      </AccordionTrigger>
                      {hasAudit ? <AccordionContent className="space-y-3 border-t p-3">
                        <div className="grid gap-2 rounded-md border bg-muted/20 p-2 text-xs sm:grid-cols-2">
                          <div><div className="mb-1 font-semibold uppercase tracking-wide text-muted-foreground">Experienced continuation</div><ModelContinuation plies={playedSequence} /><div className="mt-1 text-muted-foreground">Green moves came from the model; neutral moves were supplied by the puzzle; red is the first divergence. {a.item.solved ? "Complete line solved." : partial ? `${correctSolverMoves} correct solver move${correctSolverMoves === 1 ? "" : "s"} · ${a.item.score.toFixed(2)}/1 point.` : `Incorrect at solver move ${correctSolverMoves + 1}.`}</div></div>
                          <div><div className="mb-1 font-semibold uppercase tracking-wide text-muted-foreground">Correct line</div><span className="font-mono">{solutionSan.join(" ") || solution.join(" ") || "—"}</span></div>
                        </div>
                        {a.item.turns?.length ? <PromptTranscript turns={a.item.turns} /> : null}
                        {!a.item.turns?.length && <>
                          {(a.item.answer_rationale || a.item.answer_explanation) && <><div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Model rationale</div><p className="rounded bg-muted/30 p-3 text-xs leading-relaxed">{a.item.answer_rationale ?? a.item.answer_explanation}</p></>}
                          <ExactPromptBlock label="Visible model response" text={a.item.answer_raw ?? "—"} tone="schema" />
                        </>}
                      </AccordionContent> : null}
                    </AccordionItem>
                  )
                  })}
              </Accordion>
              {entry.answers.length === 0 && (
                <p className="mt-2 text-sm text-muted-foreground">No model attempts recorded for this puzzle.</p>
              )}
            </CardContent>
          </Card>
      ) : (
        <Card className="border-dashed bg-card/40">
          <CardContent className="flex flex-wrap items-center gap-4 py-6">
            <div className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary"><Lightbulb className="size-4 text-muted-foreground" /></div>
            <div className="min-w-0 flex-1"><div className="font-medium">Model attempts stay hidden while you solve</div><div className="text-sm text-muted-foreground">Complete the puzzle or view the solution to inspect every model line and transcript without spoilers.</div></div>
            <Badge variant="secondary" className="shrink-0 tabular-nums">{modelCount} {modelCount === 1 ? "model has" : "models have"} played</Badge>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
