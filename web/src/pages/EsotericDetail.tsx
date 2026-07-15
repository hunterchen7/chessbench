import { useEffect, useMemo, useState } from "react"
import { Chess } from "chess.js"
import { Link, useParams } from "react-router-dom"
import { ArrowLeft, Check, Lightbulb, X } from "lucide-react"
import { loadComposed, STIPULATION_BLURB, STIPULATION_LABEL, type ComposedData } from "@/lib/composed"
import { uciLineToSan } from "@/lib/chess"
import { pct } from "@/lib/format"
import { Board } from "@/components/Board"
import { ResponseStyleBadge } from "@/components/ResponseStyle"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

const short = (m: string) => (m.includes("/") ? m.split("/")[1] : m)

export function EsotericDetail() {
  const { id = "" } = useParams()
  const [data, setData] = useState<ComposedData | null>(null)
  const [reveal, setReveal] = useState(false)

  useEffect(() => {
    loadComposed().then(setData)
  }, [])

  const entry = data?.problems.get(id)
  const sideToMove = useMemo(() => {
    if (!entry) return "white"
    try {
      return new Chess(entry.problem.fen).turn() === "w" ? "white" : "black"
    } catch {
      return "white"
    }
  }, [entry])

  if (!data) return <p className="animate-pulse text-muted-foreground">Loading…</p>
  if (!entry)
    return (
      <div className="space-y-2">
        <p>Problem {id} not found.</p>
        <Link to="/esoteric" className="text-sm underline">
          Back to esoteric
        </Link>
      </div>
    )

  const p = entry.problem
  const solutionSan = uciLineToSan(p.fen, p.solution)
  const answers = entry.answers.filter((a) => a.solver !== "oracle")
  const solvedCount = answers.filter((a) => a.solved).length

  return (
    <div className="space-y-6">
      <Link to="/esoteric" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Esoteric
      </Link>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,440px)_1fr]">
        <div className="space-y-4">
          <Board fen={p.fen} orientation={sideToMove} id="composed-board" />
          <p className="text-sm text-muted-foreground">
            {sideToMove === "white" ? "White" : "Black"} to move.
          </p>
          <Button variant="outline" size="sm" onClick={() => setReveal((r) => !r)}>
            <Lightbulb className="size-4" /> {reveal ? "Hide" : "Show"} solution
          </Button>
          {reveal && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Solution</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-mono text-sm">{solutionSan.join("  ") || p.solution.join(" ") || "—"}</p>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-2xl font-bold">{p.id}</h1>
              <Badge variant="secondary">{STIPULATION_LABEL[p.kind]}</Badge>
              <Badge variant="outline" className="font-mono">
                {p.label}
              </Badge>
              {p.goal && <Badge variant="outline">{p.goal}</Badge>}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{STIPULATION_BLURB[p.kind]}</p>
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
                How the models did
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {solvedCount}/{answers.length} solved · {pct(answers.length ? solvedCount / answers.length : 0)}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {answers.map((a, i) => (
                <div key={i} className="flex items-start gap-3 rounded-md border px-3 py-2">
                  {a.solved ? (
                    <Check className="mt-0.5 size-4 shrink-0 text-chart-2" />
                  ) : (
                    <X className="mt-0.5 size-4 shrink-0 text-destructive/70" />
                  )}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{short(a.model)}</span>
                      <ResponseStyleBadge condition={a.condition} compact />
                      {a.answer && <span className="font-mono text-sm text-muted-foreground">{a.answer}</span>}
                    </div>
                    {a.detail && <p className="mt-0.5 text-xs text-muted-foreground">{a.detail}</p>}
                  </div>
                </div>
              ))}
              {answers.length === 0 && (
                <p className="text-sm text-muted-foreground">No model attempts recorded for this problem.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
