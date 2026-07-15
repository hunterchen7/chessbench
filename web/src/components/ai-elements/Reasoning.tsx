import { BrainCircuit, ChevronDown } from "lucide-react"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

/** AI Elements-style disclosure for visible model rationale or exact prompts. */
export function ReasoningDisclosure({
  label = "Reasoning",
  children,
  defaultOpen = false,
  className,
}: {
  label?: string
  children: ReactNode
  defaultOpen?: boolean
  className?: string
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className={cn("group/reasoning", className)}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="xs" className="h-7 w-full justify-start px-2 text-[10px] text-muted-foreground">
          <BrainCircuit className="size-3 text-violet-600 dark:text-violet-300" />
          {label}
          <ChevronDown className="ml-auto size-3 transition-transform duration-200 group-data-[state=open]/reasoning:rotate-180" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="pt-1">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}
