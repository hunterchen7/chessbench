import { useState, type ReactElement } from "react"
import { STIPULATION_BLURB, STIPULATION_LABEL, type Stipulation } from "@/lib/composed"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

interface StipulationTooltipProps {
  kind: Stipulation
  children: ReactElement
}

export function StipulationTooltip({ kind, children }: StipulationTooltipProps) {
  const [open, setOpen] = useState(false)
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild onClick={() => setOpen((current) => !current)}>{children}</TooltipTrigger>
        <TooltipContent sideOffset={6} className="max-w-xs px-3 py-2 leading-relaxed">
          <span className="font-semibold">{STIPULATION_LABEL[kind]}.</span>{" "}{STIPULATION_BLURB[kind]}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
