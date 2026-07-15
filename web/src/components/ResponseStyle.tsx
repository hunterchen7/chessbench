import { Braces, TextCursorInput } from "lucide-react"
import type { Condition } from "@/lib/data"
import {
  RESPONSE_STYLES,
  responseStyleInfo,
  type ResponseStyleKey,
} from "@/lib/format"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

export function ResponseStyleBadge({
  condition,
  compact = false,
}: {
  condition: Condition | string | null | undefined
  compact?: boolean
}) {
  const style = responseStyleInfo(condition)
  const Icon = style.key === "move_only" ? TextCursorInput : Braces
  return (
    <Badge
      variant="outline"
      title={`${style.label} · ${style.protocol}`}
      className={cn(
        "font-normal",
        style.key === "move_only"
          ? "border-sky-500/25 bg-sky-500/[0.06] text-sky-700 dark:text-sky-300"
          : "border-violet-500/25 bg-violet-500/[0.06] text-violet-700 dark:text-violet-300",
      )}
    >
      <Icon className="size-3" /> {compact ? style.shortLabel : style.label}
    </Badge>
  )
}

export function ResponseStyleToggle({
  value,
  onChange,
  className,
}: {
  value: ResponseStyleKey
  onChange: (value: ResponseStyleKey) => void
  className?: string
}) {
  return (
    <Tabs value={value} onValueChange={(next) => onChange(next as ResponseStyleKey)} className={className} aria-label="Response style">
      <TabsList className="h-8 border bg-background p-0.5 shadow-xs">
      {RESPONSE_STYLES.map((style) => {
        const Icon = style.key === "move_only" ? TextCursorInput : Braces
        const selected = value === style.key
        return (
          <TabsTrigger
            key={style.key}
            value={style.key}
            title={style.description}
            className={cn(
              "h-6 px-2.5 text-xs",
              selected && "bg-foreground text-background dark:bg-foreground dark:text-background",
            )}
          >
            <Icon className="size-3" /> {style.shortLabel}
          </TabsTrigger>
        )
      })}
      </TabsList>
    </Tabs>
  )
}
