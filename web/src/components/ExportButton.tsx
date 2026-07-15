import { Download } from "lucide-react"
import { useData } from "@/lib/useData"
import type { ResponseStyleKey } from "@/lib/format"
import { Button } from "@/components/ui/button"

export function ExportButton({ track, model, run, responseStyle }: { track?: string; model?: string; run?: string; responseStyle?: ResponseStyleKey }) {
  const { apiBase } = useData()
  const params = new URLSearchParams()
  if (track) params.set("track", track)
  if (model) params.set("model", model)
  if (run) params.set("run", run)
  if (responseStyle) params.set("response_style", responseStyle)
  const href = apiBase ? `${apiBase}/export${params.size ? `?${params}` : ""}` : `${import.meta.env.BASE_URL}data/index.json`
  return (
    <Button asChild variant="outline" size="sm" className="gap-2">
      <a href={href} download>
        <Download className="size-3.5" /> Export JSON
      </a>
    </Button>
  )
}
