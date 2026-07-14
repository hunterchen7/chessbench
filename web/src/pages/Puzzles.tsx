import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Check } from "lucide-react"
import { useData } from "@/lib/useData"
import type { PuzzleEntry } from "@/lib/data"
import { pct } from "@/lib/format"
import { humanStore } from "@/lib/human"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

function solveStats(entry: PuzzleEntry) {
  const answers = entry.answers
  const solved = answers.filter((a) => a.item.solved).length
  return { solved, total: answers.length, rate: answers.length ? solved / answers.length : 0 }
}

const TIERS = ["all", "beginner", "novice", "intermediate", "advanced", "expert", "master"]

export function Puzzles() {
  const { puzzleIndex } = useData()
  type Sort = "rating" | "rating-desc" | "hardest" | "easiest" | "todo"
  const [tier, setTier] = useState("all")
  const [q, setQ] = useState("")
  const [sort, setSort] = useState<Sort>("rating")
  const [mine, setMine] = useState<"all" | "unsolved" | "solved">("all")
  const [limit, setLimit] = useState(120)
  const store = humanStore()

  const rows = useMemo(() => {
    let list = Array.from(puzzleIndex.values())
    if (tier !== "all") list = list.filter((e) => e.position.categories.tier?.includes(tier))
    if (mine !== "all")
      list = list.filter((e) => {
        const rec = store[e.position.puzzle_id]
        return mine === "solved" ? rec?.solved : !rec?.solved
      })
    if (q.trim()) {
      const needle = q.toLowerCase()
      list = list.filter(
        (e) =>
          e.position.puzzle_id.toLowerCase().includes(needle) ||
          e.position.themes.some((t) => t.toLowerCase().includes(needle)),
      )
    }
    list = list.slice()
    if (sort === "rating") list.sort((a, b) => a.position.rating - b.position.rating)
    else if (sort === "rating-desc") list.sort((a, b) => b.position.rating - a.position.rating)
    else if (sort === "easiest") list.sort((a, b) => solveStats(b).rate - solveStats(a).rate)
    else if (sort === "hardest") list.sort((a, b) => solveStats(a).rate - solveStats(b).rate)
    else list.sort((a, b) => Number(!!store[a.position.puzzle_id]) - Number(!!store[b.position.puzzle_id]) || a.position.rating - b.position.rating)
    return list
  }, [puzzleIndex, tier, q, sort, mine, store])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Puzzles</h1>
        <p className="mt-1 text-muted-foreground">
          Browse the tactical suite from beginner to master. Open any puzzle to solve it yourself and see how each
          model answered.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search id or theme…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-56"
        />
        <Select value={tier} onValueChange={setTier}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIERS.map((t) => (
              <SelectItem key={t} value={t} className="capitalize">
                {t === "all" ? "All tiers" : t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
          <SelectTrigger className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="rating">Rating: low → high</SelectItem>
            <SelectItem value="rating-desc">Rating: high → low</SelectItem>
            <SelectItem value="hardest">Hardest for models</SelectItem>
            <SelectItem value="easiest">Easiest for models</SelectItem>
            <SelectItem value="todo">Your unsolved first</SelectItem>
          </SelectContent>
        </Select>
        <Select value={mine} onValueChange={(v) => setMine(v as typeof mine)}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">You: all</SelectItem>
            <SelectItem value="unsolved">You: unsolved</SelectItem>
            <SelectItem value="solved">You: solved</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{rows.length} puzzles</span>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Puzzle</TableHead>
                <TableHead className="text-right">Rating</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead>Themes</TableHead>
                <TableHead className="text-right">Models solved</TableHead>
                <TableHead className="text-center">You</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.slice(0, limit).map((e) => {
                const s = solveStats(e)
                const done = store[e.position.puzzle_id]
                return (
                  <TableRow key={e.position.puzzle_id}>
                    <TableCell>
                      <Link
                        to={`/puzzles/${e.position.puzzle_id}`}
                        className="font-mono text-sm font-medium hover:underline"
                      >
                        {e.position.puzzle_id}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{e.position.rating}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="capitalize">
                        {e.position.categories.tier?.[0] ?? "—"}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[280px]">
                      <div className="flex flex-wrap gap-1">
                        {e.position.themes.slice(0, 3).map((t) => (
                          <Badge key={t} variant="outline" className="text-xs font-normal">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                          <div className="h-full bg-chart-2" style={{ width: `${s.rate * 100}%` }} />
                        </div>
                        <span className="w-16 text-right tabular-nums text-muted-foreground">
                          {s.solved}/{s.total} · {pct(s.rate)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      {done ? (
                        done.solved ? (
                          <Check className="mx-auto size-4 text-chart-2" />
                        ) : (
                          <span className="text-xs text-muted-foreground">tried</span>
                        )
                      ) : null}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {rows.length > limit && (
        <button
          onClick={() => setLimit((l) => l + 120)}
          className="mx-auto block rounded-md border px-4 py-2 text-sm hover:bg-secondary"
        >
          Show more ({rows.length - limit} remaining)
        </button>
      )}
    </div>
  )
}
