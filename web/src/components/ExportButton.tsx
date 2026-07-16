import { Archive, ChevronDown, Download, Puzzle, Swords } from "lucide-react"
import { useData } from "@/lib/useData"
import type { ResponseStyleKey } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

type ExportScope = {
  track?: string
  model?: string
  run?: string
  responseStyle?: ResponseStyleKey
  suite?: string
  mode?: number
  status?: string
  puzzle?: string
  tournament?: string
}

function useExportHref(scope: ExportScope = {}) {
  const { apiBase } = useData()
  const params = new URLSearchParams()
  if (scope.track) params.set("track", scope.track)
  if (scope.model) params.set("model", scope.model)
  if (scope.run) params.set("run", scope.run)
  if (scope.responseStyle) params.set("response_style", scope.responseStyle)
  if (scope.suite) params.set("suite", scope.suite)
  if (scope.mode) params.set("mode", String(scope.mode))
  if (scope.status) params.set("status", scope.status)
  if (scope.puzzle) params.set("puzzle", scope.puzzle)
  if (scope.tournament) params.set("tournament", scope.tournament)
  return apiBase ? `${apiBase}/export${params.size ? `?${params}` : ""}` : `${import.meta.env.BASE_URL}data/index.json`
}

export function ExportButton({ label = "Export this view", ...scope }: ExportScope & { label?: string }) {
  const href = useExportHref(scope)
  return (
    <Button asChild variant="outline" size="sm" className="gap-2">
      <a href={href} download>
        <Download className="size-3.5" /> {label}
      </a>
    </Button>
  )
}

export function DataExportMenu() {
  const puzzleHref = useExportHref({ track: "puzzle", status: "completed" })
  const gameHref = useExportHref({ track: "game", status: "completed" })
  const archiveHref = useExportHref()
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="gap-2"><Download className="size-3.5" /> Data <ChevronDown className="size-3" /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuLabel>Choose an export scope</DropdownMenuLabel>
      <DropdownMenuItem asChild><a href={puzzleHref} download><Puzzle /> Completed standard runs</a></DropdownMenuItem>
      <DropdownMenuItem asChild><a href={gameHref} download><Swords /> Completed game runs</a></DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem asChild><a href={archiveHref} download><Archive /> <span><span className="block">Export all data</span><span className="block text-[11px] text-muted-foreground">Full archive, every run and track</span></span></a></DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
}
