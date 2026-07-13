import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { loadDataset, type Dataset } from "./data"

const Ctx = createContext<Dataset | null>(null)

export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Dataset | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadDataset().then(setData).catch((e) => setError(String(e)))
  }, [])

  if (error)
    return (
      <div className="mx-auto max-w-2xl p-10 text-destructive">
        Failed to load data: {error}
      </div>
    )
  if (!data)
    return (
      <div className="mx-auto max-w-2xl p-10 text-muted-foreground animate-pulse">Loading chessbench…</div>
    )
  return <Ctx.Provider value={data}>{children}</Ctx.Provider>
}

export function useData(): Dataset {
  const d = useContext(Ctx)
  if (!d) throw new Error("useData must be used within DataProvider")
  return d
}
