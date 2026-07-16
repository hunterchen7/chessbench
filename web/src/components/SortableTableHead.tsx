import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"
import { TableHead } from "@/components/ui/table"
import { cn } from "@/lib/utils"

export type SortDirection = "asc" | "desc"

export function SortableTableHead({
  label,
  active,
  direction,
  align = "left",
  onSort,
  className,
}: {
  label: string
  active: boolean
  direction: SortDirection
  align?: "left" | "center" | "right"
  onSort: () => void
  className?: string
}) {
  const Icon = active ? direction === "asc" ? ArrowUp : ArrowDown : ArrowUpDown
  return (
    <TableHead
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
      className={cn(align === "right" && "text-right", align === "center" && "text-center", className)}
    >
      <button
        type="button"
        onClick={onSort}
        className={cn(
          "group inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-md px-1.5 text-xs font-medium transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60",
          align === "right" && "ml-auto",
          align === "center" && "mx-auto",
          active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
        title={`Sort by ${label}${active ? direction === "asc" ? ", descending" : ", ascending" : ""}`}
      >
        {label}
        <Icon className={cn("size-3.5", active ? "opacity-100" : "opacity-45 group-hover:opacity-90")} />
      </button>
    </TableHead>
  )
}
