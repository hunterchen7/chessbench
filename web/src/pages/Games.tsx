import { Link } from "react-router-dom"
import { Swords, Trophy } from "lucide-react"
import { useData } from "@/lib/useData"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export function Games() {
  const { tournaments } = useData()
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Games</h1>
        <p className="mt-1 text-muted-foreground">
          Round-robin tournaments where models play both colours. Open one to see standings, the crosstable, and a
          move-by-move replay of every game.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tournaments.map((t) => (
          <Link key={t.file} to={`/games/${encodeURIComponent(t.file)}`}>
            <Card className="h-full transition-colors hover:border-ring">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Swords className="size-4 text-muted-foreground" />
                  {t.file.replace(/\.json$/, "")}
                </CardTitle>
                <CardDescription>
                  {t.n_players} players · {t.n_games} games
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 text-sm">
                  <Trophy className="size-4 text-chart-4" />
                  Winner: <span className="font-medium">{t.winner ?? "—"}</span>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
        {tournaments.length === 0 && <p className="text-sm text-muted-foreground">No tournaments recorded yet.</p>}
      </div>
    </div>
  )
}
