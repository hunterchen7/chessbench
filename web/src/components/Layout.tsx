import { useEffect, useState } from "react"
import { NavLink, Outlet, useLocation } from "react-router-dom"
import { FlaskConical, Menu, Moon, Sun } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ErrorBoundary } from "@/components/ErrorBoundary"
import { DataExportMenu } from "@/components/ExportButton"
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet"

const NAV = [
  { to: "/puzzles", label: "Puzzles" },
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
      <a href="#main-content" className="fixed left-3 top-3 z-[100] -translate-y-20 rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background shadow-lg transition-transform focus:translate-y-0">Skip to content</a>
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/88 backdrop-blur-xl">
        <div className="flex min-h-16 w-full items-center gap-5 px-[clamp(1rem,2.5vw,5rem)]">
          <NavLink to="/puzzles" className="flex shrink-0 items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-lg bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
              <FlaskConical className="size-4.5" />
            </span>
            <span>
              <span className="block text-sm font-semibold tracking-tight">ChessBench</span>
              <span className="block text-[9px] font-medium uppercase tracking-[0.2em] text-muted-foreground">model observatory</span>
            </span>
          </NavLink>
          <nav className="scrollbar-none hidden min-w-0 items-center gap-0.5 overflow-x-auto md:flex" aria-label="Primary navigation">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => cn(
                  "whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors lg:px-3 lg:text-sm",
                  isActive ? "bg-foreground text-background" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto hidden shrink-0 items-center gap-2 md:flex">
            <DataExportMenu />
            <Button variant="ghost" size="icon-sm" aria-label={`Switch to ${dark ? "light" : "dark"} mode`} aria-pressed={dark} onClick={() => setDark((value) => !value)}>
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
          </div>
          <Sheet>
            <SheetTrigger asChild><Button variant="ghost" size="icon-sm" className="ml-auto md:hidden" aria-label="Open navigation"><Menu className="size-4" /></Button></SheetTrigger>
            <SheetContent>
              <SheetTitle className="pr-8 text-lg font-semibold">ChessBench</SheetTitle>
              <SheetDescription className="mt-1 text-sm text-muted-foreground">Model chess benchmark observatory</SheetDescription>
              <nav className="mt-8 flex flex-col gap-1" aria-label="Mobile navigation">
                {NAV.map((item) => <SheetClose asChild key={item.to}><NavLink to={item.to} className={({ isActive }) => cn("rounded-lg px-3 py-2.5 text-sm font-medium transition-colors", isActive ? "bg-foreground text-background" : "text-muted-foreground hover:bg-secondary hover:text-foreground")}>{item.label}</NavLink></SheetClose>)}
              </nav>
              <div className="mt-auto grid gap-2 border-t pt-4">
                <DataExportMenu />
                <Button variant="outline" onClick={() => setDark((value) => !value)} aria-pressed={dark}>{dark ? <Sun className="size-4" /> : <Moon className="size-4" />} Switch to {dark ? "light" : "dark"} mode</Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </header>
      <main id="main-content" className="w-full px-[clamp(1rem,2.5vw,5rem)] py-8 lg:py-10">
        <ErrorBoundary key={pathname}>
          <div key={pathname} className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300"><Outlet /></div>
        </ErrorBoundary>
      </main>
    </div>
  )
}
