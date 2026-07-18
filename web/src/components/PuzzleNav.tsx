import { Link, NavLink } from "react-router-dom"
import { BarChart3, ListFilter, Play } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

export function PuzzleNav({
  count,
  hideLeaderboard = false,
  leaderboardTo = "/puzzles",
  browserTo = "/puzzles/browse",
}: {
  count?: number
  hideLeaderboard?: boolean
  leaderboardTo?: string
  browserTo?: string
}) {
  const links = [
    { to: leaderboardTo, label: "Leaderboard", icon: BarChart3, end: true },
    { to: browserTo, label: "Puzzle browser", icon: ListFilter, end: false },
  ]
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Standard puzzle views">
      <div className="inline-flex rounded-lg border bg-card/70 p-1 shadow-sm">
        {links.filter(({ label }) => !hideLeaderboard || label !== "Leaderboard").map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-all",
              isActive ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" /> {label}{label === "Puzzle browser" && count ? ` · ${count.toLocaleString()}` : ""}
          </NavLink>
        ))}
      </div>
      <Button asChild size="sm" className="h-10 bg-emerald-700 text-white hover:bg-emerald-600 dark:bg-emerald-600 dark:text-white dark:hover:bg-emerald-500">
        <Link to="/puzzles/play"><Play className="size-3.5 fill-current" /> Train puzzles</Link>
      </Button>
    </div>
  )
}
