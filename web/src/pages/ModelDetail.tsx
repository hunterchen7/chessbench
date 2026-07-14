import { Fragment, useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { ArrowLeft, Check, ChevronDown, X } from "lucide-react"
import { useData } from "@/lib/useData"
import { eloText, MODES, modeInfo, pct, TIER_ORDER } from "@/lib/format"
import { uciToSan } from "@/lib/chess"
import { EloChart, type EloPoint } from "@/components/EloChart"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  )
}

export function ModelDetail() {
  const { model = "" } = useParams()
  const decoded = decodeURIComponent(model)
  const { runs } = useData()
  const mine = useMemo(
    () => runs.filter((r) => r.model === decoded).sort((a, b) => b.summary.n - a.summary.n),
    [runs, decoded],
  )
  const [slug, setSlug] = useState(mine[0]?.condition.slug ?? "")
  const [filter, setFilter] = useState<"all" | "solved" | "failed">("all")
  const [openPuzzle, setOpenPuzzle] = useState<string | null>(null)
  const run = mine.find((r) => r.condition.slug === slug) ?? mine[0]

  if (!run)
    return (
      <div>
        <p>No runs for {decoded}.</p>
        <Link to="/" className="text-sm underline">
          Back to leaderboard
        </Link>
      </div>
    )

  const points: EloPoint[] = run.items.map((it, i) => ({
    index: i + 1,
    seq_elo: it.seq_elo,
    rating: it.rating,
    solved: it.solved,
    puzzle_id: it.puzzle_id,
  }))
  const e = eloText(run.summary)

  // Tier-bucketed accuracy from this run's items.
  const byTier = TIER_ORDER.map((tier) => {
    const items = run.items.filter((it) => it.categories.tier?.includes(tier))
    const solved = items.filter((it) => it.solved).length
    return { tier, n: items.length, solved }
  }).filter((t) => t.n > 0)

  // This model across the 3 help modes (public suite), if run in more than one.
  const modeRuns = MODES.map((m) => ({
    mode: m,
    run: mine.find((r) => r.suite?.name !== "reasoning-mini-v1" && modeInfo(r.condition)?.n === m.n),
  }))
  const hasModeComparison = modeRuns.filter((x) => x.run).length > 1

  return (
    <div className="space-y-8">
      <div>
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Leaderboard
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">{decoded}</h1>
          <Badge variant="outline">{run.provider}</Badge>
          {run.condition.reasoning_effort && (
            <Badge className="bg-chart-4/15 text-chart-4">🧠 thinking: {run.condition.reasoning_effort}</Badge>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">Condition</span>
        <Select value={run.condition.slug} onValueChange={setSlug}>
          <SelectTrigger className="w-[360px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {mine.map((r) => (
              <SelectItem key={r.condition.slug} value={r.condition.slug}>
                {r.condition.slug} · {r.summary.n} puzzles
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Puzzle Elo" value={e.value} sub={e.ci ? `95% CI ${e.ci}` : "railed"} />
        <Stat
          label="Solve rate"
          value={pct(run.summary.solve_rate)}
          sub={`${run.summary.solved}/${run.summary.n} solved`}
        />
        <Stat label="Mean score" value={pct(run.summary.mean_score)} sub="partial credit" />
        <Stat label="Legal 1st move" value={pct(run.summary.first_move_legal_rate)} sub="first-attempt legal" />
      </div>

      {hasModeComparison && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Across the 3 help modes</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mode</TableHead>
                  <TableHead className="text-right">Puzzle Elo</TableHead>
                  <TableHead className="text-right">Solve rate</TableHead>
                  <TableHead className="text-right">Legal 1st</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {modeRuns.map(({ mode, run: r }) => (
                  <TableRow key={mode.n} className={r === run ? "bg-secondary/40" : undefined}>
                    <TableCell>
                      <span className="font-medium">
                        {mode.n}. {mode.name}
                      </span>{" "}
                      <span className="text-xs text-muted-foreground">{mode.blurb}</span>
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold tabular-nums">
                      {r ? eloText(r.summary).value : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r ? pct(r.summary.solve_rate) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {r ? pct(r.summary.first_move_legal_rate) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sequential puzzle-Elo trajectory</CardTitle>
        </CardHeader>
        <CardContent>
          <EloChart points={points} final={run.summary.puzzle_elo_bounded ? run.summary.puzzle_elo : undefined} />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Accuracy by tier</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tier</TableHead>
                  <TableHead className="text-right">Solved</TableHead>
                  <TableHead className="text-right">Accuracy</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byTier.map((t) => (
                  <TableRow key={t.tier}>
                    <TableCell className="capitalize">{t.tier}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {t.solved}/{t.n}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{pct(t.solved / t.n)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top themes</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Theme</TableHead>
                  <TableHead className="text-right">n</TableHead>
                  <TableHead className="text-right">Accuracy</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {run.themes.slice(0, 10).map((t) => (
                  <TableRow key={t.theme}>
                    <TableCell>{t.theme}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{t.n}</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(t.accuracy)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Per-puzzle answer sheet: exactly what the model played on each puzzle. */}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
          <CardTitle className="text-base">
            Answer sheet
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              what {decoded.includes("/") ? decoded.split("/")[1] : decoded} played, puzzle by puzzle
            </span>
          </CardTitle>
          <div className="flex gap-1">
            {(["all", "solved", "failed"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-md px-2.5 py-1 text-xs capitalize transition-colors ${
                  filter === f ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Puzzle</TableHead>
                <TableHead className="text-right">Rating</TableHead>
                <TableHead>Played</TableHead>
                <TableHead>Best</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {run.items
                .slice()
                .sort((a, b) => a.rating - b.rating)
                .filter((it) => (filter === "all" ? true : filter === "solved" ? it.solved : !it.solved))
                .map((it) => {
                  const played = uciToSan(it.fen, it.answer_move) ?? it.answer_move ?? "—"
                  const best = uciToSan(it.fen, it.solution_first) ?? it.solution_first ?? "—"
                  const open = openPuzzle === it.puzzle_id
                  const canOpen = !!it.answer_explanation
                  return (
                    <Fragment key={it.puzzle_id}>
                      <TableRow
                        className={canOpen ? "cursor-pointer" : undefined}
                        onClick={canOpen ? () => setOpenPuzzle(open ? null : it.puzzle_id) : undefined}
                      >
                        <TableCell className="text-center">
                          {it.solved ? (
                            <Check className="mx-auto size-4 text-chart-2" />
                          ) : (
                            <X className="mx-auto size-4 text-destructive/70" />
                          )}
                        </TableCell>
                        <TableCell>
                          <Link
                            to={`/puzzles/${it.puzzle_id}`}
                            className="font-mono text-sm hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {it.puzzle_id}
                          </Link>
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{it.rating}</TableCell>
                        <TableCell className={`font-mono ${it.solved ? "text-chart-2" : ""}`}>
                          {played}
                          {canOpen && (
                            <ChevronDown
                              className={`ml-1 inline size-3 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
                            />
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-muted-foreground">{best}</TableCell>
                        <TableCell>
                          {!it.solved && it.failure_reason && (
                            <Badge variant="secondary" className="text-xs font-normal">
                              {it.failure_reason}
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                      {open && it.answer_explanation && (
                        <TableRow>
                          <TableCell />
                          <TableCell colSpan={5} className="text-sm text-muted-foreground">
                            <span className="font-medium text-foreground">Its reasoning: </span>
                            {it.answer_explanation}
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  )
                })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
