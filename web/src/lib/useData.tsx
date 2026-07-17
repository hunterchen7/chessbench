import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { loadDataset, type Dataset } from "./data"
import { AppLoadingSkeleton } from "@/components/LoadingSkeletons"

const Ctx = createContext<Dataset | null>(null)
const ACTIVE_REFRESH_MS = 10_000
const IDLE_REFRESH_MS = 60_000

const hasLiveProgress = (data: Dataset) =>
  data.runs.some((run) => run.status === "queued" || run.status === "running" || run.status === "partial") ||
  data.tournaments.some((tournament) => tournament.status === "live")

export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Dataset | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    let loaded = false
    let timer: number | undefined

    const schedule = (next: Dataset) => {
      window.clearTimeout(timer)
      const delay = document.visibilityState === "visible" && hasLiveProgress(next)
        ? ACTIVE_REFRESH_MS
        : IDLE_REFRESH_MS
      timer = window.setTimeout(refresh, delay)
    }

    const refresh = async () => {
      try {
        const next = await loadDataset()
        if (!active) return
        loaded = true
        setData(next)
        setError(null)
        schedule(next)
      } catch (reason) {
        if (!active) return
        if (!loaded) setError(String(reason))
        timer = window.setTimeout(refresh, IDLE_REFRESH_MS)
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return
      window.clearTimeout(timer)
      void refresh()
    }

    document.addEventListener("visibilitychange", onVisibilityChange)
    void refresh()
    return () => {
      active = false
      window.clearTimeout(timer)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [])

  if (error)
    return (
      <div className="mx-auto max-w-2xl p-10 text-destructive">
        Failed to load data: {error}
      </div>
    )
  if (!data)
    return <AppLoadingSkeleton />
  return <Ctx.Provider value={data}>{children}</Ctx.Provider>
}

export function useData(): Dataset {
  const d = useContext(Ctx)
  if (!d) throw new Error("useData must be used within DataProvider")
  return d
}
