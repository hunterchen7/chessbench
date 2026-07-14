import { BrainCircuit } from "lucide-react"
import type { ModelVariant } from "@/lib/data"
import { Badge } from "@/components/ui/badge"

export function reasoningLabel(variant: ModelVariant): string {
  const { effort, max_tokens: tokens } = variant.reasoning ?? {}
  if (tokens) return `${tokens >= 1000 ? `${(tokens / 1000).toFixed(tokens % 1000 ? 1 : 0)}k` : tokens} think`
  if (effort && effort !== "none") return `${effort} think`
  if (effort === "none") return "no think"
  return "default think"
}

export function ModelIdentity({ variant, compact = false }: { variant: ModelVariant; compact?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="truncate font-medium">{variant.display_name}</div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="h-5 border-border/70 px-1.5 text-[10px] font-normal uppercase tracking-wide">
          {variant.provider}
        </Badge>
        <Badge className="h-5 gap-1 bg-violet-500/10 px-1.5 text-[10px] font-normal text-violet-700 dark:text-violet-300">
          <BrainCircuit className="size-3" /> {reasoningLabel(variant)}
        </Badge>
        {!compact && (
          <span className="text-[10px] tabular-nums text-muted-foreground">{variant.max_output_tokens.toLocaleString()} out</span>
        )}
      </div>
    </div>
  )
}
