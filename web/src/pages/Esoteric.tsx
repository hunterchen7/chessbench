import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { CircleHelp, Radio, Sparkles } from "lucide-react"
import {
  STIPULATION_BLURB,
  STIPULATION_LABEL,
  type Stipulation,
} from "@/lib/composed"
import { useComposedData } from "@/lib/useComposedData"
import { pct, responseStyleInfo, type ResponseStyleKey } from "@/lib/format"
import { participantKind } from "@/lib/participants"
import { ResponseStyleBadge, ResponseStyleToggle } from "@/components/ResponseStyle"
import { ExportButton } from "@/components/ExportButton"
import { SuiteDescriptor } from "@/components/SuiteDescriptor"
import { TablePageSkeleton } from "@/components/LoadingSkeletons"
import { StipulationTooltip } from "@/components/StipulationTooltip"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

const short = (m: string) => (m.includes("/") ? m.split("/").at(-1)! : m)

export function Esoteric() {
  const { data, error } = useComposedData()
  const [kind, setKind] = useState<Stipulation | "all">("all")
  const [responseStyle, setResponseStyle] = useState<ResponseStyleKey>("json_rationale")

  const models = useMemo(() => {
    if (!data) return []
    return data.runs
      .filter((r) => participantKind(`${r.solver} ${r.model}`, r.model_variant?.provider) === "model")
      .filter((r) => responseStyleInfo(r.condition).key === responseStyle)
      .map((r) => ({
        key: r.run_id ?? `${r.model}-${r.created}`,
        model: r.model_variant?.display_name ?? r.model,
        condition: r.condition,
        solved: r.summary.solved,
        n: r.summary.n,
        rate: r.summary.solve_rate,
        status: r.status,
      }))
      .sort((a, b) => b.rate - a.rate)
  }, [data, responseStyle])

  const kinds = useMemo(() => {
    if (!data) return [] as Stipulation[]
    return Array.from(new Set([...data.problems.values()].map((e) => e.problem.kind)))
  }, [data])

  const rows = useMemo(() => {
    if (!data) return []
    let list = data.order.map((id) => data.problems.get(id)!).filter(Boolean)
    if (kind !== "all") list = list.filter((e) => e.problem.kind === kind)
    return list
  }, [data, kind])

  if (error) return <p className="text-sm text-destructive">Failed to load esoteric problems: {error}</p>
  if (!data) return <TablePageSkeleton label="Loading esoteric problems" />
  if (data.problems.size === 0)
    return (
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Esoteric</h1>
        <p className="text-muted-foreground">No composed-problem runs have been published yet.</p>
      </div>
    )

  const nonOracle = (e: (typeof rows)[number]) => e.answers.filter((a) => participantKind(`${a.solver} ${a.model}`, a.model_variant?.provider) === "model" && responseStyleInfo(a.condition).key === responseStyle)

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
          <Sparkles className="size-6 text-chart-4" /> Esoteric
        </h1>
        <p className="mt-1 max-w-3xl text-muted-foreground">
          Composed chess problems — the genres you never see in a normal game: selfmates, helpmates, reflexmates,
          series-movers, and proof games. The current frozen catalogue contains {data.problems.size} solver-validated
          tasks; the question is whether a model can find their exact answers.
        </p></div>
        <div className="flex flex-wrap items-center gap-2">
          {data.source === "api" && <Badge variant="outline" className="gap-1.5"><Radio className="size-3 text-emerald-500" /> Cloudflare live</Badge>}
          <ResponseStyleToggle value={responseStyle} onChange={setResponseStyle} />
          <ExportButton track="esoteric" responseStyle={responseStyle} />
        </div>
      </div>

      <SuiteDescriptor name="esoteric-seed-v2" />

      <p className="-mt-5 flex items-center gap-1.5 text-xs text-muted-foreground"><CircleHelp className="size-3.5" /> Click or focus any genre label for its exact stipulation.</p>

      {/* Solver leaderboard */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Who solves the weird ones</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table reorderableKey="esoteric-leaderboard">
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 text-center">#</TableHead>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Points</TableHead>
                <TableHead className="text-right">Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {models.map((m, i) => (
                <TableRow key={m.key}>
                  <TableCell className="text-center font-mono text-muted-foreground">{i + 1}</TableCell>
                  <TableCell><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{short(m.model)}</span>{m.status && m.status !== "completed" && <Badge variant="outline">{m.status}</Badge>}</div><div className="mt-1"><ResponseStyleBadge condition={m.condition} compact /></div></TableCell>
                  <TableCell className="text-right tabular-nums">
                    {m.solved}/{m.n}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{pct(m.rate)}</TableCell>
                </TableRow>
              ))}
              {models.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                    No model runs yet — the oracle reference confirms every problem is solvable.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Genre filter */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setKind("all")}
          className={`cursor-pointer rounded-full border px-3 py-1 text-sm ${kind === "all" ? "bg-secondary" : "hover:bg-secondary/50"}`}
        >
          All ({data.problems.size})
        </button>
        {kinds.map((k) => {
          const count = [...data.problems.values()].filter((e) => e.problem.kind === k).length
          return (
            <StipulationTooltip key={k} kind={k}>
              <button
                type="button"
                onClick={() => setKind(k)}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${kind === k ? "bg-secondary" : "hover:bg-secondary/50"}`}
              >
                {STIPULATION_LABEL[k]} ({count}) <CircleHelp className="size-3 opacity-55" />
              </button>
            </StipulationTooltip>
          )
        })}
      </div>

      {kind !== "all" && (
        <p className="-mt-4 text-sm text-muted-foreground">{STIPULATION_BLURB[kind]}</p>
      )}

      <Card>
        <CardContent className="p-0">
          <Table reorderableKey="esoteric-problems">
            <TableHeader>
              <TableRow>
                <TableHead>Problem</TableHead>
                <TableHead>Stipulation</TableHead>
                <TableHead>Genre</TableHead>
                <TableHead>Themes</TableHead>
                <TableHead className="text-right">Models solved</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((e) => {
                const ans = nonOracle(e)
                const solved = ans.filter((a) => a.solved).length
                const rate = ans.length ? solved / ans.length : 0
                return (
                  <TableRow key={e.problem.id}>
                    <TableCell>
                      <Link to={`/esoteric/${e.problem.id}`} className="font-mono text-sm font-medium hover:underline">
                        {e.problem.id}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono">{e.problem.label}</TableCell>
                    <TableCell>
                      <StipulationTooltip kind={e.problem.kind}>
                        <button type="button" className="cursor-help rounded-full focus-visible:ring-2 focus-visible:ring-ring/60">
                          <Badge variant="secondary" className="gap-1">{STIPULATION_LABEL[e.problem.kind]} <CircleHelp className="size-3 opacity-60" /></Badge>
                        </button>
                      </StipulationTooltip>
                    </TableCell>
                    <TableCell className="max-w-[260px]">
                      <div className="flex flex-wrap gap-1">
                        {e.problem.themes.slice(0, 3).map((t) => (
                          <Badge key={t} variant="outline" className="text-xs font-normal">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                          <div className="h-full bg-chart-2" style={{ width: `${rate * 100}%` }} />
                        </div>
                        <span className="w-14 text-right tabular-nums text-muted-foreground">
                          {solved}/{ans.length}
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
