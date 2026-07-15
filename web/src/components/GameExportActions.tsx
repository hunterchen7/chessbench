import { Download, FileJson2, Link2 } from "lucide-react"
import { useState } from "react"
import type { TournamentGame } from "@/lib/data"
import { Button } from "@/components/ui/button"

function download(name: string, contents: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }))
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

export function GameExportActions({ game, name }: { game: TournamentGame; name: string }) {
  const [copied, setCopied] = useState(false)
  const slug = name.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase()
  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => download(`${slug}.pgn`, game.pgn, "application/x-chess-pgn")}>
        <Download className="size-3.5" /> PGN
      </Button>
      <Button variant="outline" size="sm" onClick={() => download(`${slug}.json`, JSON.stringify(game, null, 2), "application/json")}>
        <FileJson2 className="size-3.5" /> Full audit JSON
      </Button>
      <Button variant="ghost" size="sm" onClick={() => void copyLink()}>
        <Link2 className="size-3.5" /> {copied ? "Copied" : "Copy link"}
      </Button>
    </div>
  )
}
