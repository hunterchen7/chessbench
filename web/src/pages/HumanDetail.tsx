import { useEffect, useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { ArrowLeft, Check, Gauge, Target, UserRound, X } from "lucide-react"
import { fetchHumanTrainingProfileByHandle, type HumanTrainingProfile } from "@/lib/backend"
import { formatRatingDeviation, pct } from "@/lib/format"
import type { HumanTrainingAttempt } from "@/lib/humanTraining"
import { useData } from "@/lib/useData"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

function MoveSequence({ attempt }: { attempt: HumanTrainingAttempt }) {
  const experienced = attempt.experienced_line
  const moves = experienced ?? attempt.moves ?? []
  if (moves.length === 0) return <span className="text-xs text-muted-foreground">Move not recorded</span>
  return <span className="inline-flex flex-wrap items-center gap-1">{moves.map((move, index) => {
    const humanMove = experienced ? index % 2 === 0 : true
    const wrong = humanMove && !attempt.solved && attempt.outcome === "incorrect" && index === moves.length - 1
    return <span key={`${move}-${index}`} className={wrong
      ? "rounded border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 font-mono text-xs text-rose-700 dark:text-rose-300"
      : humanMove
        ? "rounded border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-xs text-emerald-700 dark:text-emerald-300"
        : "rounded border bg-muted/50 px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
    }>{move}</span>
  })}</span>
}

function Outcome({ attempt }: { attempt: HumanTrainingAttempt }) {
  if (attempt.solved) return <Badge variant="secondary" className="gap-1"><Check className="size-3" /> Solved</Badge>
  if (attempt.outcome === "revealed") return <Badge variant="outline">Revealed</Badge>
  return <Badge variant="outline" className="gap-1 border-rose-500/30 text-rose-700 dark:text-rose-300"><X className="size-3" /> Missed</Badge>
}

export function HumanDetail() {
  const { handle = "" } = useParams()
  const { apiBase } = useData()
  const [profile, setProfile] = useState<HumanTrainingProfile | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setProfile(undefined)
    setError(null)
    if (!apiBase) {
      setProfile(null)
      return () => { active = false }
    }
    void fetchHumanTrainingProfileByHandle(apiBase, handle).then((result) => {
      if (active) setProfile(result)
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "Could not load this human run.")
    })
    return () => { active = false }
  }, [apiBase, handle])

  const attempts = useMemo(() => profile?.session.recent_attempts.toReversed() ?? [], [profile])

  if (profile === undefined && !error) return <div className="space-y-5"><Skeleton className="h-28 w-full" /><Skeleton className="h-[520px] w-full" /></div>
  if (!profile || error) return <Card><CardContent className="py-16 text-center"><div className="font-semibold">Human run not found</div><p className="mt-1 text-sm text-muted-foreground">{error ?? "This username does not have a public saved run."}</p><Link to="/puzzles" className="mt-4 inline-flex items-center gap-1 text-sm text-emerald-700 hover:underline dark:text-emerald-300"><ArrowLeft className="size-4" /> Back to ratings</Link></CardContent></Card>

  const seed = profile.session.selector?.seed
  return <div className="space-y-6">
    <Link to="/puzzles" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Human ratings</Link>

    <Card className="overflow-hidden border-emerald-500/20 bg-emerald-500/[0.025]">
      <CardContent className="flex flex-col gap-5 py-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4"><div className="grid size-12 place-items-center rounded-full bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"><UserRound className="size-6" /></div><div><div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-semibold tracking-tight">{profile.handle}</h1>{seed != null ? <Badge variant="outline" className="font-mono">Seed {seed}</Badge> : null}</div><p className="mt-1 text-sm text-muted-foreground">Saved human puzzle-training run · updated {new Date(profile.updated_at).toLocaleString()}</p></div></div>
        <div className="grid grid-cols-3 gap-x-7 gap-y-2 text-right">
          <div><div className="font-mono text-2xl font-semibold tabular-nums">{Math.round(profile.rating).toLocaleString()}</div><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Glicko-2 rating</div></div>
          <div><div className="font-mono text-2xl font-semibold tabular-nums">{formatRatingDeviation(profile.rating_deviation)}</div><div className="text-[10px] uppercase tracking-wider text-muted-foreground">RD</div></div>
          <div><div className="font-mono text-2xl font-semibold tabular-nums">{profile.solved}/{profile.attempts}</div><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Record</div></div>
        </div>
      </CardContent>
    </Card>

    <section className="grid gap-3 sm:grid-cols-3">
      <Card><CardContent className="flex items-center gap-4 py-5"><Gauge className="size-5 text-violet-600" /><div><div className="font-mono text-xl font-semibold">{Math.round(profile.rating).toLocaleString()}</div><div className="text-xs text-muted-foreground">rating · RD {formatRatingDeviation(profile.rating_deviation)}</div></div></CardContent></Card>
      <Card><CardContent className="flex items-center gap-4 py-5"><Target className="size-5 text-emerald-600" /><div><div className="font-mono text-xl font-semibold">{pct(profile.accuracy)}</div><div className="text-xs text-muted-foreground">complete-solve accuracy</div></div></CardContent></Card>
      <Card><CardContent className="flex items-center gap-4 py-5"><UserRound className="size-5 text-sky-600" /><div><div className="font-mono text-xl font-semibold">{attempts.length}/{profile.attempts}</div><div className="text-xs text-muted-foreground">attempt details retained</div></div></CardContent></Card>
    </section>

    <Card className="flex max-h-[calc(100dvh-2rem)] min-w-0 flex-col overflow-hidden">
      <CardHeader className="shrink-0 gap-2 border-b">
        <CardTitle className="text-base">Puzzle answer sheet</CardTitle>
        <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground"><span className="inline-flex items-center gap-1"><i className="size-2 rounded-sm bg-emerald-500/70" /> human move</span><span className="inline-flex items-center gap-1"><i className="size-2 rounded-sm border bg-muted" /> built-in puzzle reply</span><span className="inline-flex items-center gap-1"><i className="size-2 rounded-sm bg-rose-500/70" /> wrong move</span><span>Saved runs retain at most the 100 most recent attempts.</span></div>
      </CardHeader>
      <CardContent className="min-h-0 min-w-0 flex-1 overflow-auto p-0">
        <Table reorderableKey="human-run-answer-sheet" className="min-w-[980px] table-fixed">
          <TableHeader className="sticky top-0 z-10 bg-card"><TableRow><TableHead className="w-24">Puzzle</TableHead><TableHead className="w-20 text-right">Rating</TableHead><TableHead className="w-28">Outcome</TableHead><TableHead className="w-[300px]">Experienced continuation</TableHead><TableHead className="w-[260px]">Correct line</TableHead><TableHead className="w-28 text-right">Rating change</TableHead><TableHead className="w-36 text-right">Played</TableHead></TableRow></TableHeader>
          <TableBody>{attempts.map((attempt) => {
            const delta = Math.round(attempt.rating_after - attempt.rating_before)
            return <TableRow key={`${attempt.puzzle_id}-${attempt.played_at}`}>
              <TableCell><Link to={`/puzzles/${encodeURIComponent(attempt.puzzle_id)}`} className="font-mono text-xs font-medium hover:underline">{attempt.puzzle_id}</Link></TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums">{Math.round(attempt.puzzle_rating).toLocaleString()}</TableCell>
              <TableCell><Outcome attempt={attempt} /></TableCell>
              <TableCell className="whitespace-normal"><MoveSequence attempt={attempt} /></TableCell>
              <TableCell className="whitespace-normal font-mono text-xs leading-6 text-emerald-700 dark:text-emerald-300">{attempt.solution?.join(" ") || <span className="text-muted-foreground">Not recorded</span>}</TableCell>
              <TableCell className={`text-right font-mono text-xs font-semibold tabular-nums ${delta >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"}`}>{delta >= 0 ? "+" : ""}{delta}</TableCell>
              <TableCell className="text-right text-xs text-muted-foreground">{new Date(attempt.played_at).toLocaleString()}</TableCell>
            </TableRow>
          })}{attempts.length === 0 ? <TableRow><TableCell colSpan={7} className="h-32 text-center text-sm text-muted-foreground">No retained attempt details.</TableCell></TableRow> : null}</TableBody>
        </Table>
      </CardContent>
    </Card>
  </div>
}
