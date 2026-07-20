import { type FormEvent, useEffect, useRef, useState } from "react"
import { Navigate, useNavigate, useSearchParams } from "react-router-dom"
import { Dices, Gauge, RotateCcw } from "lucide-react"
import { loadSeededRatedPuzzle, type SeededRatedPuzzleSelection } from "@/lib/data"
import {
  TRAINING_RATING_RADIUS,
  humanTrainingSettled,
  humanTrainingSelected,
  humanTrainingSession,
  startHumanTrainingSession,
  type HumanTrainingSession,
} from "@/lib/humanTraining"
import { useData } from "@/lib/useData"
import { formatRatingDeviation } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { RatedPoolDownloads } from "@/components/RatedPoolDownloads"
import { HumanTrainingSave } from "@/components/HumanTrainingSave"

function safeInteger(value: string | null): number | null {
  if (value == null || !/^-?\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

export function PuzzleStart() {
  const { apiBase } = useData()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const requestedSeed = safeInteger(searchParams.get("seed"))
  const requestedPoolHash = searchParams.get("pool_hash") || null
  const requestedRadius = safeInteger(searchParams.get("target_radius")) ?? TRAINING_RATING_RADIUS
  const restart = searchParams.get("restart") === "1"
  const [seedInput, setSeedInput] = useState(() => String(humanTrainingSession().selector?.seed ?? 0))
  const [formError, setFormError] = useState<string | null>(null)
  const [session, setSession] = useState<HumanTrainingSession>(() => humanTrainingSession())
  const [ready, setReady] = useState(false)
  const [selection, setSelection] = useState<SeededRatedPuzzleSelection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const initializedKey = useRef<string | null>(null)

  useEffect(() => {
    if (requestedSeed == null) {
      initializedKey.current = null
      setReady(false)
      return
    }
    const key = `${requestedSeed}:${requestedPoolHash ?? "active"}:${requestedRadius}`
    if (!restart && initializedKey.current === key) return
    const current = humanTrainingSession()
    const matches = current.selector?.seed === requestedSeed &&
      current.selector.target_radius === requestedRadius &&
      (requestedPoolHash == null || current.selector.pool_hash === requestedPoolHash)
    const next = restart || !matches
      ? startHumanTrainingSession(requestedSeed, requestedPoolHash, requestedRadius)
      : current
    initializedKey.current = key
    setSession(next)
    setReady(true)
    if (restart) {
      const clean = new URLSearchParams(searchParams)
      clean.delete("restart")
      navigate(`/puzzles/play?${clean}`, { replace: true })
    }
  }, [navigate, requestedPoolHash, requestedRadius, requestedSeed, restart, searchParams])

  useEffect(() => {
    if (!ready || requestedSeed == null) return
    if (humanTrainingSettled(session)) return
    const selector = session.selector
    if (!selector) return
    const controller = new AbortController()
    setSelection(null)
    setError(null)
    if (!apiBase) {
      setError("Seeded puzzle training requires the live ChessBench API.")
      return () => controller.abort()
    }
    void loadSeededRatedPuzzle(apiBase, {
      rating: session.state.rating,
      seed: selector.seed,
      sequence: selector.next_sequence,
      targetRadius: selector.target_radius,
      poolHash: selector.pool_hash,
      excluded: session.recent_puzzle_ids,
    }, controller.signal).then((next) => {
      humanTrainingSelected({
        puzzleId: next.puzzle.puzzle_id,
        poolHash: next.pool.content_hash,
        seed: next.selection.seed,
        sequence: next.selection.sequence,
        targetRadius: selector.target_radius,
      })
      setSelection(next)
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(String(reason))
    })
    return () => controller.abort()
  }, [apiBase, ready, requestedSeed, retry, session])

  function start(event: FormEvent) {
    event.preventDefault()
    const seed = safeInteger(seedInput.trim())
    if (seed == null) {
      setFormError("Enter a whole number between JavaScript's safe integer limits.")
      return
    }
    setFormError(null)
    navigate(`/puzzles/play?seed=${encodeURIComponent(seed)}&restart=1`)
  }

  if (requestedSeed != null && ready && humanTrainingSettled(session)) return (
    <Card className="mx-auto max-w-xl overflow-hidden">
      <CardHeader className="border-b bg-emerald-500/5">
        <div className="mb-2 grid size-11 place-items-center rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"><Gauge className="size-5" /></div>
        <CardTitle>Seed {session.selector?.seed} complete</CardTitle>
        <p className="text-sm text-muted-foreground">The run stopped after {session.attempts} rated puzzles at RD {formatRatingDeviation(session.state.deviation)}.</p>
      </CardHeader>
      <CardContent className="space-y-4 pt-6">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-lg border bg-muted/20 p-3"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Rating</div><div className="mt-1 font-mono text-xl font-semibold">{Math.round(session.state.rating).toLocaleString()}</div></div>
          <div className="rounded-lg border bg-muted/20 p-3"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">RD</div><div className="mt-1 font-mono text-xl font-semibold">{formatRatingDeviation(session.state.deviation)}</div></div>
          <div className="rounded-lg border bg-muted/20 p-3"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Record</div><div className="mt-1 font-mono text-xl font-semibold">{session.solved}/{session.attempts}</div></div>
        </div>
        {apiBase ? <HumanTrainingSave apiBase={apiBase} session={session} /> : null}
        <Button type="button" variant="outline" className="w-full" onClick={() => navigate(`/puzzles/play?seed=${encodeURIComponent(String(session.selector?.seed ?? 0))}&restart=1`)}><RotateCcw className="size-4" /> Start this seed again</Button>
      </CardContent>
    </Card>
  )

  if (selection) {
    const params = new URLSearchParams({
      source: "train",
      selection: selection.selection_id,
      seed: String(selection.selection.seed),
      pool_hash: selection.pool.content_hash,
      target_radius: String(session.selector?.target_radius ?? TRAINING_RATING_RADIUS),
      sequence: String(selection.selection.sequence),
    })
    return <Navigate
      replace
      to={`/puzzles/${encodeURIComponent(selection.puzzle.puzzle_id)}?${params}`}
      state={{ trainingPuzzle: selection.puzzle }}
    />
  }

  if (requestedSeed == null) return (
    <Card className="mx-auto max-w-xl overflow-hidden">
      <CardHeader className="border-b bg-muted/20">
        <div className="mb-2 grid size-11 place-items-center rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"><Dices className="size-5" /></div>
        <CardTitle>Play a seeded puzzle run</CardTitle>
        <p className="text-sm text-muted-foreground">Enter any whole-number seed below. Starting resets your rating to 1,500 and uses the exact model-benchmark selector, so matching outcomes produce the same puzzle path.</p>
      </CardHeader>
      <CardContent className="pt-6">
        <form className="space-y-4" onSubmit={start}>
          <label className="grid gap-2 text-sm font-medium" htmlFor="training-seed">
            Seed
            <Input
              id="training-seed"
              inputMode="numeric"
              pattern="-?[0-9]+"
              value={seedInput}
              onChange={(event) => { setSeedInput(event.target.value); setFormError(null) }}
              className="font-mono"
              autoFocus
            />
          </label>
          {formError && <p className="text-sm text-destructive">{formError}</p>}
          <Button type="submit" className="w-full"><Gauge className="size-4" /> Start seeded run</Button>
        </form>
        <div className="mt-6 border-t pt-5"><RatedPoolDownloads /></div>
      </CardContent>
    </Card>
  )

  if (error) return (
    <Card className="mx-auto max-w-xl border-destructive/30">
      <CardContent className="py-14 text-center">
        <p className="font-medium text-destructive">Could not select a training puzzle</p>
        <p className="mt-2 text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" className="mt-5" onClick={() => setRetry((value) => value + 1)}>
          <RotateCcw className="size-4" /> Try again
        </Button>
      </CardContent>
    </Card>
  )

  return (
    <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,620px)_340px]">
      <Skeleton className="aspect-square rounded-xl" />
      <Card className="h-fit overflow-hidden">
        <CardContent className="space-y-5 p-6">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"><Gauge className="size-5" /></div>
            <div><div className="font-semibold">Finding seeded match {session.selector?.next_sequence ?? 0}</div><div className="text-xs text-muted-foreground">Benchmark selector · seed {requestedSeed}</div></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border bg-muted/20 p-3"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Rating</div><div className="mt-1 font-mono text-xl font-semibold">{Math.round(session.state.rating).toLocaleString()}</div></div>
            <div className="rounded-lg border bg-muted/20 p-3"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">RD</div><div className="mt-1 font-mono text-xl font-semibold">{formatRatingDeviation(session.state.deviation)}</div></div>
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
        </CardContent>
      </Card>
    </div>
  )
}
