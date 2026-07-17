import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { Check, Play, RotateCcw } from "lucide-react"
import { loadPuzzleIndex, type PuzzleEntry } from "@/lib/data"
import { TIER_ORDER } from "@/lib/format"
import { humanStore } from "@/lib/human"
import { SortableTableHead, type SortDirection } from "@/components/SortableTableHead"
import { PuzzleNav } from "@/components/PuzzleNav"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const TIERS = ["all", "beginner", "novice", "intermediate", "advanced", "expert", "master"]
const PAGE_SIZE = 120
type SortKey = "puzzle" | "rating" | "tier" | "plays" | "popularity" | "you"

function userState(entry: PuzzleEntry, store: ReturnType<typeof humanStore>): number {
  const record = store[entry.position.puzzle_id]
  if (!record) return 0
  return record.solved ? 2 : 1
}

export function PuzzleBrowser() {
  const [entries, setEntries] = useState<PuzzleEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    setError(null)
    void loadPuzzleIndex().then(setEntries).catch((reason) => setError(String(reason)))
  }, [])
  useEffect(load, [load])
  const [tier, setTier] = useState("all")
  const [q, setQ] = useState("")
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({ key: "rating", direction: "asc" })
  const [mine, setMine] = useState<"all" | "unsolved" | "solved">("all")
  const [limit, setLimit] = useState(PAGE_SIZE)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const store = humanStore()

  const rows = useMemo(() => {
    let list = entries ? entries.slice() : []
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
    const multiplier = sort.direction === "asc" ? 1 : -1
    return list.toSorted((a, b) => {
      let comparison = 0
      if (sort.key === "puzzle") comparison = a.position.puzzle_id.localeCompare(b.position.puzzle_id)
      else if (sort.key === "rating") comparison = a.position.rating - b.position.rating
      else if (sort.key === "tier") {
        const aTier = a.position.categories.tier?.[0] ?? ""
        const bTier = b.position.categories.tier?.[0] ?? ""
        comparison = TIER_ORDER.indexOf(aTier) - TIER_ORDER.indexOf(bTier)
      } else if (sort.key === "plays") comparison = (a.position.plays ?? 0) - (b.position.plays ?? 0)
      else if (sort.key === "popularity") comparison = (a.position.popularity ?? 0) - (b.position.popularity ?? 0)
      else comparison = userState(a, store) - userState(b, store)
      return comparison * multiplier || a.position.rating - b.position.rating || a.position.puzzle_id.localeCompare(b.position.puzzle_id)
    })
  }, [entries, tier, q, sort.key, sort.direction, mine, store])

  useEffect(() => {
    setLimit(PAGE_SIZE)
  }, [tier, q, sort.key, sort.direction, mine])

  useEffect(() => {
    const target = loadMoreRef.current
    if (!target || limit >= rows.length) return

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setLimit((current) => Math.min(current + PAGE_SIZE, rows.length))
      }
    }, { rootMargin: "600px 0px" })

    observer.observe(target)
    return () => observer.disconnect()
  }, [limit, rows.length])

  const toggleSort = (key: SortKey) => setSort((current) => ({
    key,
    direction: current.key === key ? (current.direction === "asc" ? "desc" : "asc") : ["plays", "popularity"].includes(key) ? "desc" : "asc",
  }))

  if (error) return <div className="mx-auto max-w-md rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center"><div className="font-medium text-destructive">Could not load the puzzle index</div><p className="mt-1 text-sm text-muted-foreground">{error}</p><Button variant="outline" size="sm" className="mt-4" onClick={load}>Try again</Button></div>
  if (!entries) return <div className="space-y-3 py-20" aria-label="Loading puzzle index"><div className="mx-auto h-5 w-40 animate-pulse rounded bg-muted" /><div className="mx-auto h-48 max-w-4xl animate-pulse rounded-xl bg-muted/60" /></div>

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-5 border-b border-border/70 pb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Puzzle browser</h1>
          <p className="mt-1 text-muted-foreground">Inspect the canonical task bank by rating and theme, or open any position in the trainer.</p>
        </div>
        <PuzzleNav count={entries.length} />
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
                <SortableTableHead label="Puzzle" active={sort.key === "puzzle"} direction={sort.direction} onSort={() => toggleSort("puzzle")} />
                <SortableTableHead label="Rating" active={sort.key === "rating"} direction={sort.direction} align="right" onSort={() => toggleSort("rating")} />
                <TableHead className="text-right">RD</TableHead>
                <SortableTableHead label="Tier" active={sort.key === "tier"} direction={sort.direction} onSort={() => toggleSort("tier")} />
                <TableHead>Themes</TableHead>
                <SortableTableHead label="Lichess plays" active={sort.key === "plays"} direction={sort.direction} align="right" onSort={() => toggleSort("plays")} />
                <SortableTableHead label="Popularity" active={sort.key === "popularity"} direction={sort.direction} align="right" onSort={() => toggleSort("popularity")} />
                <SortableTableHead label="You" active={sort.key === "you"} direction={sort.direction} align="center" onSort={() => toggleSort("you")} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.slice(0, limit).map((e) => {
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
                    <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">±{e.position.rating_deviation ?? "—"}</TableCell>
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
                    <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">{(e.position.plays ?? 0).toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">{e.position.popularity ?? "—"}</TableCell>
                    <TableCell className="text-center">
                      <Link
                        to={`/puzzles/${e.position.puzzle_id}`}
                        className="inline-flex min-h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                        aria-label={`${done?.solved ? "Review" : done ? "Retry" : "Play"} puzzle ${e.position.puzzle_id}`}
                      >
                        {done?.solved ? <><Check className="size-3.5 text-chart-2" /> review</> : done ? <><RotateCcw className="size-3.5" /> retry</> : <><Play className="size-3.5" /> play</>}
                      </Link>
                    </TableCell>
                  </TableRow>
                )
              })}
              {rows.length === 0 && <TableRow><TableCell colSpan={8} className="py-16 text-center"><div className="font-medium">No puzzles match those filters</div><Button variant="ghost" size="sm" className="mt-2" onClick={() => { setQ(""); setTier("all"); setMine("all") }}>Clear filters</Button></TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {rows.length > limit && (
        <div ref={loadMoreRef} className="py-2 text-center text-sm text-muted-foreground" role="status">
          Loading more puzzles…
        </div>
      )}
    </div>
  )
}
