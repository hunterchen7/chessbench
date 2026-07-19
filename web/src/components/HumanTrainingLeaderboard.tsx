import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Play, UserRound } from "lucide-react"
import { fetchHumanTrainingLeaderboard, type HumanTrainingLeaderboardRow } from "@/lib/backend"
import { formatRatingDeviation, pct } from "@/lib/format"
import { useData } from "@/lib/useData"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export function HumanTrainingLeaderboard() {
  const { apiBase } = useData()
  const [rows, setRows] = useState<HumanTrainingLeaderboardRow[] | null>(null)

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

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-base"><UserRound className="size-4 text-emerald-600" /> Human training ratings</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">Explicitly saved browser runs using the same frozen-puzzle Glicko updates. Usernames are unique; these casual runs remain separate from the model benchmark.</p>
        </div>
        <Button asChild size="sm"><Link to="/puzzles/play"><Play className="size-3.5 fill-current" /> Play seeded run</Link></Button>
      </CardHeader>
      <CardContent>
        {rows == null ? <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div> : rows.length ? (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader><TableRow><TableHead className="w-14 text-right">#</TableHead><TableHead>Username</TableHead><TableHead className="text-right">Rating</TableHead><TableHead className="text-right">RD</TableHead><TableHead className="text-right">Record</TableHead><TableHead className="text-right">Accuracy</TableHead></TableRow></TableHeader>
              <TableBody>{rows.map((row) => <TableRow key={row.handle} className={row.me ? "bg-emerald-500/[0.06]" : undefined}>
                <TableCell className="text-right font-mono text-xs text-muted-foreground">{row.rank}</TableCell>
                <TableCell><span className="font-medium">{row.handle}</span>{row.me ? <Badge variant="secondary" className="ml-2 text-[10px]">you</Badge> : null}</TableCell>
                <TableCell className="text-right font-mono font-semibold tabular-nums">{Math.round(row.rating).toLocaleString()}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">{formatRatingDeviation(row.rating_deviation)}{row.provisional ? "?" : ""}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">{row.solved}/{row.attempts}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">{pct(row.accuracy)}</TableCell>
              </TableRow>)}</TableBody>
            </Table>
          </div>
        ) : <div className="rounded-lg border border-dashed py-10 text-center"><div className="font-medium">No saved human ratings yet</div><p className="mt-1 text-sm text-muted-foreground">Start a seeded run, play at least one puzzle, choose a username, and save it.</p></div>}
      </CardContent>
    </Card>
  )
}
