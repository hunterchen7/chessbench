import { Link } from "react-router-dom"
import { ArrowRight, Radio, Swords, Trophy } from "lucide-react"
import { useData } from "@/lib/useData"
import { modeFromSlug } from "@/lib/format"
import { ResponseStyleBadge } from "@/components/ResponseStyle"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export function Games() {
  const { tournaments } = useData()
  return (
    <div className="space-y-6">
      <div>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Stateful games</h1>
          <p className="mt-1 max-w-3xl text-muted-foreground">
            Match-point tournaments with both colours, configurable illegal-move handling, and auditable model transcripts.
            The canonical setup keeps one chat per game and re-sends the authoritative position every turn.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tournaments.map((t) => (
          <Link key={t.file} to={`/games/${encodeURIComponent(t.file)}`}>
            <Card className={`group h-full transition-all duration-200 hover:-translate-y-0.5 hover:border-ring hover:shadow-md ${t.status === "live" ? "border-red-500/40" : ""}`}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Swords className="size-4 text-muted-foreground" />
                  {t.file.replace(/\.json$/, "")}
                </CardTitle>
                <CardDescription className="flex items-center gap-2">
                  {t.n_players} players · {t.n_games} games
                  {modeFromSlug(t.condition_slug) && (
                    <Badge variant="outline" className="text-xs font-normal">
                      {modeFromSlug(t.condition_slug)!.n}. {modeFromSlug(t.condition_slug)!.name}
                    </Badge>
                  )}
                  <ResponseStyleBadge condition={t.condition_slug} compact />
                  {t.condition_slug?.includes("hybrid") && <Badge variant="secondary" className="text-xs font-normal">stateful hybrid</Badge>}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {t.status === "live" ? (
                  <div className="flex items-center gap-2 text-sm">
                    <Radio className="size-4 animate-pulse text-red-500" />
                    <span className="font-medium text-red-500">Live now</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm">
                    <Trophy className="size-4 text-chart-4" />
                    {t.winner ? <>Winner: <span className="font-medium">{t.winner}</span></> : <span className="font-medium">Match tied</span>}
                  </div>
                )}
                <div className="mt-4 flex items-center justify-between border-t pt-3 text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
                  <span>View standings and {t.n_games} full game{t.n_games === 1 ? "" : "s"}</span>
                  <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
        {tournaments.length === 0 && <p className="text-sm text-muted-foreground">No games recorded yet.</p>}
      </div>
    </div>
  )
}
