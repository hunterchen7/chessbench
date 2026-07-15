import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Activity, ArrowUpRight, BookOpen, CheckCircle2, ExternalLink, History, Repeat2, Sigma } from "lucide-react"
import { useData } from "@/lib/useData"
import { loadHistoricalCandidates, loadPublicCorpus, type HistoricalCandidateBank, type PublicCorpus, type PuzzlePosition } from "@/lib/data"
import { pct, pointsText, responseStyleInfo, type ResponseStyleKey } from "@/lib/format"
import { isModelVariant } from "@/lib/participants"
import { ModelIdentity } from "@/components/ModelIdentity"
import { ResponseStyleBadge, ResponseStyleToggle } from "@/components/ResponseStyle"
import { ExportButton } from "@/components/ExportButton"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const WOODPECKER_BOOK = "https://www.simonandschuster.com/books/Woodpecker-Method/Axel-Smith/9781784830540"
const DEEP_BLUE_GAME = "https://www.kasparov.com/timeline-event/deep-blue/"

export function Woodpecker() {
  const { runs } = useData()
  const [corpus, setCorpus] = useState<PublicCorpus<PuzzlePosition> | null>(null)
  const [historical, setHistorical] = useState<HistoricalCandidateBank | null>(null)
  useEffect(() => {
    let live = true
    void loadPublicCorpus<PuzzlePosition>("woodpecker").then((next) => {
      if (live) setCorpus(next)
    })
    void loadHistoricalCandidates().then((next) => {
      if (live) setHistorical(next)
    })
    return () => { live = false }
  }, [])
  const all = useMemo(() => runs.filter((run) => run.track === "woodpecker" && isModelVariant(run.model_variant)), [runs])
  const suites = useMemo(() => Array.from(new Set(all.map((run) => run.suite?.name).filter(Boolean))) as string[], [all])
  const [suite, setSuite] = useState("")
  const [responseStyle, setResponseStyle] = useState<ResponseStyleKey>("json_rationale")
  const activeSuite = suite || suites[0] || ""
  const rows = useMemo(() => all
    .filter((run) => (!activeSuite || run.suite?.name === activeSuite) && responseStyleInfo(run.condition).key === responseStyle)
    .sort((a, b) => b.summary.points - a.summary.points || b.summary.solve_rate - a.summary.solve_rate), [all, activeSuite, responseStyle])
  const totalPoints = rows.reduce((sum, run) => sum + run.summary.points, 0)
  const totalSolved = rows.reduce((sum, run) => sum + run.summary.solved, 0)
  const sectionCounts = useMemo(() => ({
    easy: corpus?.items.filter((item) => item.difficulty_band === "easy").length ?? 0,
    medium: corpus?.items.filter((item) => item.difficulty_band === "medium").length ?? 0,
    hard: corpus?.items.filter((item) => item.difficulty_band === "hard").length ?? 0,
  }), [corpus])

  return (
    <div className="space-y-8">
      <section className="grid gap-6 border-b border-border/70 pb-8 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-violet-700 dark:text-violet-300"><Activity className="size-4" /> Full-line calculation</div>
          <h1 className="text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">Woodpecker track</h1>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-muted-foreground">
            The model sees a fresh position once and must return the complete solution—including forced replies—in a
            single response. A perfect line earns one point; correct solver plies in a matching prefix earn partial credit.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {suites.length > 1 && <Select value={activeSuite} onValueChange={setSuite}><SelectTrigger size="sm" className="w-52"><SelectValue /></SelectTrigger><SelectContent>{suites.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent></Select>}
          <ResponseStyleToggle value={responseStyle} onChange={setResponseStyle} />
          <ExportButton track="woodpecker" responseStyle={responseStyle} />
        </div>
      </section>

      <Card className="overflow-hidden border-violet-500/20 bg-violet-500/[0.035]">
        <CardContent className="grid gap-5 pt-6 md:grid-cols-[auto_1fr_1fr] md:items-start">
          <div className="grid size-11 place-items-center rounded-xl bg-violet-500/10 text-violet-700 dark:text-violet-300"><BookOpen className="size-5" /></div>
          <div>
            <h2 className="font-semibold">What is the Woodpecker Method?</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              It is a cyclic tactics-training system developed by GM Hans Tikkanen and presented with Axel Smith:
              solve a fixed set of puzzles, then repeat the same set again and again in progressively less time to
              strengthen tactical pattern recognition and recall.
            </p>
            <a href={WOODPECKER_BOOK} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-violet-700 hover:underline dark:text-violet-300">
              The original Quality Chess book <ExternalLink className="size-3.5" />
            </a>
          </div>
          <div className="rounded-xl border bg-background/70 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold"><Repeat2 className="size-4 text-violet-600" /> What ChessBench measures</div>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              A benchmark run does not train the model through repeated cycles. It borrows the method&apos;s recall and
              calculation pressure: one familiar-shaped tactical position, one request, and the entire UCI variation
              including forced replies. Repetitions are separate runs and are never allowed to share conversation state.
            </p>
          </div>
        </CardContent>
      </Card>

      <section aria-labelledby="woodpecker-sections">
        <div className="mb-3 flex flex-col items-start gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div><h2 id="woodpecker-sections" className="text-xl font-semibold">The training set</h2><p className="mt-1 text-sm text-muted-foreground">Easy, Medium, and Hard are editorial Woodpecker sections. Lichess rating and RD remain provenance—not the score for this track.</p></div>
          <Badge variant="outline">{corpus?.items.length ?? "…"} positions</Badge>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {([
            ["easy", sectionCounts.easy, "Direct patterns and shorter calculation."],
            ["medium", sectionCounts.medium, "Longer combinations with less obvious first moves."],
            ["hard", sectionCounts.hard, "Deep source lines and the 3000+ Lichess frontier."],
          ] as const).map(([label, count, copy]) => <Card key={label}><CardContent className="pt-6"><div className="flex items-center justify-between"><Badge variant="secondary" className="capitalize">{label}</Badge><span className="font-mono text-2xl font-semibold">{corpus ? count : "—"}</span></div><p className="mt-3 text-sm leading-relaxed text-muted-foreground">{copy}</p></CardContent></Card>)}
        </div>
      </section>

      <Card className="overflow-hidden border-amber-500/25 bg-amber-500/[0.035]">
        <CardContent className="grid gap-4 pt-6 md:grid-cols-[auto_1fr_auto] md:items-center">
          <div className="grid size-11 place-items-center rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-300"><History className="size-5" /></div>
          <div><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">Deep Blue–Kasparov, 1997 · game 2</h2><Badge variant="secondary">Historical lab</Badge><Badge variant="outline">not scored yet</Badge></div><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Kasparov missed the exceptional 45…Qe3 defensive resource after 45.Ra6. A pinned Stockfish 18 review validates that first move, but finds that the famous published continuation is not best play throughout. It stays visible here while branch-aware grading is designed instead of being forced into a misleading exact-line score.</p></div>
          <a href={DEEP_BLUE_GAME} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-800 hover:underline dark:text-amber-300">Game and historical account <ExternalLink className="size-3.5" /></a>
        </CardContent>
      </Card>

      <section aria-labelledby="historical-lab" className="space-y-3">
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="historical-lab" className="text-xl font-semibold">Historical curation lab</h2>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">Famous World Championship, Candidates, tournament, and human–computer positions enter here first. Every line replays legally; none affects the leaderboard until its strongest defenses and acceptable branches pass separate review.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{historical?.candidate_count ?? "…"} candidates</Badge>
            {historical && (["easy", "medium", "hard"] as const).map((band) => <Badge key={band} variant="secondary" className="capitalize">{historical.difficulty[band]} {band}</Badge>)}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {historical?.items.slice(0, 6).map((item) => (
            <Card key={item.id} className="group transition-colors hover:border-violet-500/35">
              <CardContent className="pt-6">
                <div className="flex flex-wrap items-center gap-2"><Badge variant="secondary" className="capitalize">{item.difficulty_band}</Badge><Badge variant="outline" className="capitalize">{item.provenance_confidence} provenance</Badge></div>
                <h3 className="mt-3 font-semibold leading-snug">{item.white} vs {item.black}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{item.event}{item.date ? ` · ${item.date.slice(0, 4)}` : ""}</p>
                <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-muted-foreground">{item.why_famous}</p>
                <a href={item.historical_context_url || item.source_url} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-violet-700 hover:underline dark:text-violet-300">Source and context <ExternalLink className="size-3.5" /></a>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="flex items-center gap-4 pt-6"><Sigma className="size-5 text-violet-600" /><div><div className="font-mono text-2xl font-semibold">{totalPoints.toFixed(2)}</div><div className="text-xs text-muted-foreground">points across published runs</div></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-4 pt-6"><CheckCircle2 className="size-5 text-emerald-600" /><div><div className="font-mono text-2xl font-semibold">{totalSolved}</div><div className="text-xs text-muted-foreground">complete lines solved</div></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-4 pt-6"><Activity className="size-5 text-amber-600" /><div><div className="font-mono text-2xl font-semibold">{rows.length}</div><div className="text-xs text-muted-foreground">model-budget variants</div></div></CardContent></Card>
      </section>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead className="w-12 text-center">#</TableHead><TableHead>Model variant</TableHead><TableHead>Prompt contract</TableHead><TableHead className="text-right">Points</TableHead><TableHead className="text-right">Complete lines</TableHead><TableHead className="text-right">Legal first</TableHead><TableHead className="text-right">Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((run, index) => <TableRow key={run.run_id}>
                <TableCell className="text-center font-mono text-xs text-muted-foreground">{index + 1}</TableCell>
                <TableCell><Link to={`/model/${encodeURIComponent(run.model_variant.key)}`} className="group flex items-center gap-2"><ModelIdentity variant={run.model_variant} /><ArrowUpRight className="size-3.5 opacity-0 group-hover:opacity-100" /></Link></TableCell>
                <TableCell><div className="flex flex-wrap gap-1"><Badge variant="secondary">one shot</Badge><Badge variant="outline">full variation</Badge><ResponseStyleBadge condition={run.condition} compact />{run.condition.prompt_style === "coached" && <Badge variant="outline">coached</Badge>}</div></TableCell>
                <TableCell className="text-right font-mono font-semibold">{pointsText(run.summary)}</TableCell>
                <TableCell className="text-right tabular-nums">{run.summary.solved}/{run.summary.n}<div className="text-[11px] text-muted-foreground">{pct(run.summary.solve_rate)}</div></TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{pct(run.summary.first_move_legal_rate)}</TableCell>
                <TableCell className="text-right"><Badge variant={run.status === "completed" ? "secondary" : "outline"}>{run.status}</Badge></TableCell>
              </TableRow>)}
              {rows.length === 0 && <TableRow><TableCell colSpan={7} className="py-16 text-center"><div className="font-medium">No Woodpecker runs published yet</div><div className="mt-1 text-sm text-muted-foreground">Run the dedicated Woodpecker track; progress will appear here item by item.</div></TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
