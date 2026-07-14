import { useEffect, useState } from "react"
import { NavLink, Outlet, useLocation } from "react-router-dom"
import { FlaskConical, Moon, Sun } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ErrorBoundary } from "@/components/ErrorBoundary"
import { ExportButton } from "@/components/ExportButton"

const NAV = [
  { to: "/", label: "Overview", end: true },
  { to: "/puzzles", label: "Standard" },
  { to: "/woodpecker", label: "Woodpecker" },
  { to: "/esoteric", label: "Esoteric" },
  { to: "/games", label: "Games" },
  { to: "/methodology", label: "Methods" },
]

export function Layout() {
  const [dark, setDark] = useState(() => localStorage.getItem("chessbench.theme") !== "light")
  const { pathname } = useLocation()
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
    localStorage.setItem("chessbench.theme", dark ? "dark" : "light")
  }, [dark])

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_15%_-10%,color-mix(in_oklch,var(--chart-2)_12%,transparent),transparent_30rem)]">
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/88 backdrop-blur-xl">
        <div className="mx-auto flex min-h-16 max-w-[1480px] items-center gap-5 px-4 lg:px-8">
          <NavLink to="/" className="flex shrink-0 items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-lg bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
              <FlaskConical className="size-4.5" />
            </span>
            <span>
              <span className="block text-sm font-semibold tracking-tight">ChessBench</span>
              <span className="block text-[9px] font-medium uppercase tracking-[0.2em] text-muted-foreground">model observatory</span>
            </span>
          </NavLink>
          <nav className="scrollbar-none flex min-w-0 items-center gap-0.5 overflow-x-auto">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => cn(
                  "whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors lg:px-3 lg:text-sm",
                  isActive ? "bg-foreground text-background" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto hidden shrink-0 items-center gap-2 sm:flex">
            <ExportButton />
            <Button variant="ghost" size="icon-sm" aria-label="Toggle theme" onClick={() => setDark((value) => !value)}>
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1480px] px-4 py-8 lg:px-8 lg:py-10">
        <ErrorBoundary key={pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  )
}
