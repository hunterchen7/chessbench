import { useEffect, useState } from "react"
import { Navigate } from "react-router-dom"
import { Gauge, RotateCcw } from "lucide-react"
import { loadRandomRatedPuzzle, type RatedPuzzleSelection } from "@/lib/data"
import {
  TRAINING_RATING_RADIUS,
  humanTrainingSession,
  type HumanTrainingSession,
} from "@/lib/humanTraining"
import { useData } from "@/lib/useData"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export function PuzzleStart() {
  const { apiBase } = useData()
  const [session] = useState<HumanTrainingSession>(() => humanTrainingSession())
  const [selection, setSelection] = useState<RatedPuzzleSelection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setSelection(null)
    setError(null)
    if (!apiBase) {
      setError("Adaptive puzzle training requires the live ChessBench API.")
      return () => controller.abort()
    }

    const select = async () => {
      let lastError: unknown
      // The ordinary match is ±100. Expand only when recent exclusions exhaust it.
      for (const radius of [TRAINING_RATING_RADIUS, 200, 400]) {
        try {
          return await loadRandomRatedPuzzle(
            apiBase,
            session.state.rating,
            radius,
            session.recent_puzzle_ids,
            controller.signal,
          )
        } catch (reason) {
          if (controller.signal.aborted) throw reason
          lastError = reason
        }
      }
      throw lastError ?? new Error("No matching puzzle is available.")
    }

    void select()
      .then(setSelection)
      .catch((reason) => { if (!controller.signal.aborted) setError(String(reason)) })
    return () => controller.abort()
  }, [apiBase, retry, session])

  if (selection) {
    const params = new URLSearchParams({ source: "train", selection: selection.selection_id })
    return <Navigate
      replace
      to={`/puzzles/${encodeURIComponent(selection.puzzle.puzzle_id)}?${params}`}
      state={{ trainingPuzzle: selection.puzzle }}
    />
  }

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
            <div><div className="font-semibold">Finding your next match</div><div className="text-xs text-muted-foreground">Randomized near your current rating</div></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border bg-muted/20 p-3"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Rating</div><div className="mt-1 font-mono text-xl font-semibold">{Math.round(session.state.rating).toLocaleString()}</div></div>
            <div className="rounded-lg border bg-muted/20 p-3"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">RD</div><div className="mt-1 font-mono text-xl font-semibold">{Math.round(session.state.deviation)}</div></div>
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
        </CardContent>
      </Card>
    </div>
  )
}
