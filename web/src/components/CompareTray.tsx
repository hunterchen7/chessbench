import { Link } from "react-router-dom"
import { GitCompareArrows, X } from "lucide-react"
import type { RunIndexEntry } from "@/lib/data"
import { modeInfo, responseStyleInfo } from "@/lib/format"
import { comparisonPath, MAX_COMPARISON_RUNS } from "@/lib/runComparison"
import { Button } from "@/components/ui/button"

export function CompareTray({ runs, onRemove, onClear }: { runs: RunIndexEntry[]; onRemove: (id: string) => void; onClear: () => void }) {
  if (!runs.length) return null
  const ready = runs.length >= 2
  return <aside className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-5xl animate-in slide-in-from-bottom-4 fade-in-0 duration-300 sm:inset-x-6 sm:bottom-6" aria-label="Selected comparison runs">
    <div className="overflow-hidden rounded-2xl border border-violet-500/25 bg-background/94 shadow-2xl backdrop-blur-xl">
      <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:p-4">
        <div className="flex shrink-0 items-center gap-2"><span className="grid size-8 place-items-center rounded-lg bg-violet-500/10 text-violet-700 dark:text-violet-300"><GitCompareArrows className="size-4" /></span><div><div className="text-xs font-semibold">Compare runs</div><div className="text-[10px] text-muted-foreground">{runs.length}/{MAX_COMPARISON_RUNS} selected</div></div></div>
        <div className="scrollbar-none flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1 sm:pb-0">
          {runs.map((run, index) => <div key={run.run_id} className="flex min-w-[12rem] max-w-[17rem] items-center gap-2 rounded-lg border bg-card px-2.5 py-2 shadow-xs"><span className="grid size-5 shrink-0 place-items-center rounded-full bg-violet-500/12 font-mono text-[9px] font-semibold text-violet-700 dark:text-violet-300">{index + 1}</span><div className="min-w-0 flex-1"><div className="truncate text-xs font-medium">{run.model_variant.display_name}</div><div className="truncate text-[9px] text-muted-foreground">{modeInfo(run.condition)?.displayN}. {modeInfo(run.condition)?.name} · {responseStyleInfo(run.condition).label}</div></div><Button variant="ghost" size="icon-xs" aria-label={`Remove ${run.model_variant.display_name} from comparison`} onClick={() => onRemove(run.run_id)}><X /></Button></div>)}
        </div>
        <div className="flex shrink-0 items-center gap-2"><Button variant="ghost" size="sm" onClick={onClear}>Clear</Button>{ready ? <Button asChild size="sm"><Link to={comparisonPath(runs.map((run) => run.run_id))}><GitCompareArrows /> Compare {runs.length}</Link></Button> : <Button size="sm" disabled><GitCompareArrows /> Select one more</Button>}</div>
      </div>
    </div>
  </aside>
}
