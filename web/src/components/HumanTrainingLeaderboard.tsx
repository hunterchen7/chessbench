import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Play, Search, UserRound } from "lucide-react"
import { fetchHumanTrainingLeaderboard, type HumanTrainingLeaderboardRow } from "@/lib/backend"
import { formatRatingDeviation, pct } from "@/lib/format"
import { useData } from "@/lib/useData"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export function HumanTrainingLeaderboard() {
  const navigate = useNavigate()
  const { apiBase } = useData()
  const [rows, setRows] = useState<HumanTrainingLeaderboardRow[] | null>(null)
  const [search, setSearch] = useState("")
  const [seedFilter, setSeedFilter] = useState("all")

  useEffect(() => {
    let active = true
    if (!apiBase) {
      setRows([])
      return () => { active = false }
    }
    void fetchHumanTrainingLeaderboard(apiBase).then((next) => {
      if (active) setRows(next)
    })
    return () => { active = false }
  }, [apiBase])

  const seedOptions = useMemo(() => rows
    ? [...new Set(rows.flatMap((row) => row.seed == null ? [] : [row.seed]))].toSorted((a, b) => a - b)
    : [], [rows])
  const visibleRows = useMemo(() => {
    if (!rows) return []
    const query = search.trim().toLowerCase()
    return rows.filter((row) => (
      (!query || row.handle.toLowerCase().includes(query)) &&
      (seedFilter === "all" || String(row.seed) === seedFilter)
    ))
  }, [rows, search, seedFilter])
  const clearFilters = () => {
    setSearch("")
    setSeedFilter("all")
  }

  return (
    <Card>
      <CardHeader className="gap-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base"><UserRound className="size-4 text-emerald-600" /> Human training ratings</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Explicitly saved browser runs using the same frozen-puzzle Glicko updates. Usernames are unique; these casual runs remain separate from the model benchmark.</p>
          </div>
          <Button asChild size="sm" className="shrink-0"><Link to="/puzzles/play"><Play className="size-3.5 fill-current" /> Play seeded run</Link></Button>
        </div>
        {rows?.length ? <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="relative block w-full sm:max-w-xs">
            <span className="sr-only">Filter usernames</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter username…" className="bg-background pl-9" />
          </label>
          <Select value={seedFilter} onValueChange={setSeedFilter}>
            <SelectTrigger className="w-full bg-background sm:w-44" aria-label="Filter by seed"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All seeds</SelectItem>
              {seedOptions.map((seed) => <SelectItem key={seed} value={String(seed)}>Seed {seed}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground sm:ml-auto">{visibleRows.length} of {rows.length} runs</span>
        </div> : null}
      </CardHeader>
      <CardContent>
        {rows == null ? <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div> : rows.length ? (
          <div className="overflow-x-auto rounded-lg border">
            <Table reorderableKey="human-training-leaderboard">
              <TableHeader><TableRow><TableHead className="w-14 text-right">#</TableHead><TableHead>Username</TableHead><TableHead className="text-right">Seed</TableHead><TableHead className="text-right">Rating</TableHead><TableHead className="text-right">RD</TableHead><TableHead className="text-right">Record</TableHead><TableHead className="text-right">Accuracy</TableHead></TableRow></TableHeader>
              <TableBody>{visibleRows.map((row) => <TableRow
                key={row.handle}
                role="link"
                tabIndex={0}
                className={cn("cursor-pointer", row.me && "bg-emerald-500/[0.06]")}
                onClick={() => navigate(`/human/${encodeURIComponent(row.handle)}`)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return
                  event.preventDefault()
                  navigate(`/human/${encodeURIComponent(row.handle)}`)
                }}
              >
                <TableCell className="text-right font-mono text-xs text-muted-foreground">{row.rank}</TableCell>
                <TableCell><span className="font-medium">{row.handle}</span>{row.me ? <Badge variant="secondary" className="ml-2 text-[10px]">you</Badge> : null}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">{row.seed ?? "—"}</TableCell>
                <TableCell className="text-right font-mono font-semibold tabular-nums">{Math.round(row.rating).toLocaleString()}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">{formatRatingDeviation(row.rating_deviation)}{row.provisional ? "?" : ""}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">{row.solved}/{row.attempts}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">{pct(row.accuracy)}</TableCell>
              </TableRow>)}{visibleRows.length === 0 ? <TableRow><TableCell colSpan={7} className="h-28 text-center"><div className="font-medium">No matching human runs</div><button type="button" className="mt-1 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground" onClick={clearFilters}>Clear filters</button></TableCell></TableRow> : null}</TableBody>
            </Table>
          </div>
        ) : <div className="rounded-lg border border-dashed py-10 text-center"><div className="font-medium">No saved human ratings yet</div><p className="mt-1 text-sm text-muted-foreground">Start a seeded run, play at least one puzzle, choose a username, and save it.</p></div>}
      </CardContent>
    </Card>
  )
}
