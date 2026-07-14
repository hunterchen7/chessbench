import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Sparkles } from "lucide-react"
import {
  loadComposed,
  STIPULATION_BLURB,
  STIPULATION_LABEL,
  type ComposedData,
  type Stipulation,
} from "@/lib/composed"
import { pct } from "@/lib/format"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

const short = (m: string) => (m.includes("/") ? m.split("/")[1] : m)

export function Esoteric() {
  const [data, setData] = useState<ComposedData | null>(null)
  const [kind, setKind] = useState<Stipulation | "all">("all")

  useEffect(() => {
    loadComposed().then(setData)
  }, [])

  const models = useMemo(() => {
    if (!data) return []
    return data.runs
      .filter((r) => r.solver !== "oracle")
      .map((r) => ({ model: r.model, solved: r.summary.solved, n: r.summary.n, rate: r.summary.solve_rate }))
      .sort((a, b) => b.rate - a.rate)
  }, [data])

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

  if (!data) return <p className="animate-pulse text-muted-foreground">Loading esoteric problems…</p>
  if (data.problems.size === 0)
    return (
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Esoteric</h1>
        <p className="text-muted-foreground">No composed-problem runs have been published yet.</p>
      </div>
    )

  const nonOracle = (e: (typeof rows)[number]) => e.answers.filter((a) => a.solver !== "oracle")

  return (
    <div className="space-y-8">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
          <Sparkles className="size-6 text-chart-4" /> Esoteric
        </h1>
        <p className="mt-1 max-w-3xl text-muted-foreground">
          Composed chess problems — the genres you never see in a normal game: selfmates, helpmates, reflexmates,
          series-movers, proof games, and endgame studies. Each is solver-validated, so a perfect answer exists; the
          question is whether a model can find it.
        </p>
      </div>

      {/* Solver leaderboard */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Who solves the weird ones</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
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
                <TableRow key={m.model}>
                  <TableCell className="text-center font-mono text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="font-medium">{short(m.model)}</TableCell>
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
          className={`rounded-full border px-3 py-1 text-sm ${kind === "all" ? "bg-secondary" : "hover:bg-secondary/50"}`}
        >
          All ({data.problems.size})
        </button>
        {kinds.map((k) => {
          const count = [...data.problems.values()].filter((e) => e.problem.kind === k).length
          return (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`rounded-full border px-3 py-1 text-sm ${kind === k ? "bg-secondary" : "hover:bg-secondary/50"}`}
            >
              {STIPULATION_LABEL[k]} ({count})
            </button>
          )
        })}
      </div>

      {kind !== "all" && (
        <p className="-mt-4 text-sm text-muted-foreground">{STIPULATION_BLURB[kind]}</p>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
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
                      <Badge variant="secondary">{STIPULATION_LABEL[e.problem.kind]}</Badge>
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
