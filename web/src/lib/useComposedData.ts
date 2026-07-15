import { useEffect, useMemo, useState } from "react"
import { loadComposed, type ComposedData } from "./composed"
import { useData } from "./useData"

export function useComposedData() {
  const { apiBase, runs } = useData()
  const manifests = useMemo(() => runs.filter((run) => run.track === "esoteric"), [runs])
  const signature = manifests
    .map((run) => `${run.run_id}:${run.status}:${run.updated_at ?? ""}:${run.progress.completed}`)
    .join("|")
  const [data, setData] = useState<ComposedData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void loadComposed({ apiBase, manifests }).then((next) => {
      if (!active) return
      setData(next)
      setError(null)
    }).catch((reason) => {
      if (active) setError(String(reason))
    })
    return () => { active = false }
    // The signature deliberately reloads item documents only when a manifest advances.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, signature])

  return { data, error }
}
