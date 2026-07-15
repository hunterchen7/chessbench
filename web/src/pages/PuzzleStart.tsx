import { useEffect, useState } from "react"
import { Navigate } from "react-router-dom"
import { loadPuzzleIndex } from "@/lib/data"
import { humanStore } from "@/lib/human"
import { Skeleton } from "@/components/ui/skeleton"

export function PuzzleStart() {
  const [target, setTarget] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    let active = true
    void loadPuzzleIndex().then((entries) => {
      if (!active) return
      if (!entries.length) return setTarget(null)
      const progress = humanStore()
      const unseen = entries.filter((entry) => !progress[entry.position.puzzle_id])
      const candidates = unseen.length ? unseen : entries
      const day = Math.floor(Date.now() / 86_400_000)
      setTarget(candidates[day % candidates.length].position.puzzle_id)
    }).catch(() => setTarget(null))
    return () => { active = false }
  }, [])
  if (target) return <Navigate replace to={`/puzzles/${target}`} />
  if (target === null) return <div className="py-20 text-center text-sm text-muted-foreground">No public puzzles are available.</div>
  return <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,620px)_340px]"><Skeleton className="aspect-square rounded-xl" /><Skeleton className="h-72 rounded-xl" /></div>
}
