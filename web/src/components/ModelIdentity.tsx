import { BrainCircuit, Cpu } from "lucide-react"
import type { ModelVariant } from "@/lib/data"
import { Badge } from "@/components/ui/badge"
import { reasoningConfigurationEffort, reasoningLabel, reasoningTitle } from "@/lib/modelReasoning"
import { participantKind } from "@/lib/participants"
import { ModelName } from "@/components/ModelMakerLogo"

const REASONING_BADGE_CLASSES: Record<string, string> = {
  none: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  minimal: "border-sky-500/35 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  low: "border-cyan-500/35 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  medium: "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  high: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  xhigh: "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  max: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  budget: "border-violet-500/35 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  provider: "border-zinc-500/35 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
}

export function ModelIdentity({ variant, compact = false }: { variant: ModelVariant; compact?: boolean }) {
  const kind = participantKind(`${variant.key} ${variant.model_id} ${variant.display_name}`, variant.provider)
  return (
    <div className="min-w-0">
      <ModelName variant={variant} className="font-medium" />
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="h-5 border-border/70 px-1.5 text-[10px] font-normal uppercase tracking-wide">
          {variant.provider}
        </Badge>
        {kind === "model" ? <Badge variant="outline" title={reasoningTitle(variant)} className={`h-5 gap-1 px-1.5 text-[10px] font-normal ${REASONING_BADGE_CLASSES[reasoningConfigurationEffort(variant)] ?? REASONING_BADGE_CLASSES.provider}`}>
          <BrainCircuit className="size-3" /> {reasoningLabel(variant)}
        </Badge> : <Badge variant="secondary" className="h-5 gap-1 px-1.5 text-[10px] font-normal"><Cpu className="size-3" /> {kind === "engine" ? "engine reference" : "reference baseline"}</Badge>}
        {!compact && kind === "model" && (
          <span className="text-[10px] tabular-nums text-muted-foreground">{variant.max_output_tokens === 0 ? "provider output limit" : `${variant.max_output_tokens.toLocaleString()} out`}</span>
        )}
      </div>
    </div>
  )
}
