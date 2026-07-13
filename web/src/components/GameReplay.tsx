import { useMemo, useState } from "react"
import { Chess } from "chess.js"
import { ChevronLeft, ChevronRight, SkipBack, SkipForward } from "lucide-react"
import type { TournamentGame } from "@/lib/data"
import { Board } from "@/components/Board"
import { Button } from "@/components/ui/button"

/** Build a FEN for every half-move by replaying the move list. */
function buildFens(game: TournamentGame): string[] {
  const g = new Chess(game.start_fen || undefined)
  const fens = [g.fen()]
  for (const m of game.moves) {
    try {
      if (m.uci) g.move({ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), promotion: m.uci.slice(4) || undefined })
      else if (m.san) g.move(m.san)
      else break
    } catch {
      break
    }
    fens.push(g.fen())
  }
  return fens
}

const short = (m: string) => (m.includes("/") ? m.split("/")[1] : m)

export function GameReplay({ game }: { game: TournamentGame }) {
  const fens = useMemo(() => buildFens(game), [game])
  const [cursor, setCursor] = useState(fens.length - 1)
  const clamp = (n: number) => Math.max(0, Math.min(fens.length - 1, n))

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,420px)_1fr]">
      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">{short(game.black)}</span>
          <span className="text-muted-foreground">black</span>
        </div>
        <Board fen={fens[cursor]} orientation="white" id={`replay-${game.white}-${game.black}`} maxWidth={420} />
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">{short(game.white)}</span>
          <span className="text-muted-foreground">white</span>
        </div>
        <div className="flex items-center justify-center gap-1">
          <Button variant="outline" size="icon" onClick={() => setCursor(0)} disabled={cursor === 0}>
            <SkipBack className="size-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={() => setCursor((c) => clamp(c - 1))} disabled={cursor === 0}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="w-24 text-center text-sm tabular-nums text-muted-foreground">
            {cursor} / {fens.length - 1}
          </span>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCursor((c) => clamp(c + 1))}
            disabled={cursor === fens.length - 1}
          >
            <ChevronRight className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCursor(fens.length - 1)}
            disabled={cursor === fens.length - 1}
          >
            <SkipForward className="size-4" />
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="text-sm text-muted-foreground">
          {game.result} · {game.termination} · {game.plies} plies
        </div>
        <div className="max-h-[420px] overflow-y-auto rounded-md border p-2">
          <div className="grid grid-cols-[auto_1fr_1fr] items-baseline gap-x-2 gap-y-0.5 text-sm">
            {Array.from({ length: Math.ceil(game.moves.length / 2) }).map((_, r) => {
              const wi = r * 2
              const bi = r * 2 + 1
              const w = game.moves[wi]
              const b = game.moves[bi]
              const cell = (m: (typeof game.moves)[number], i: number) => (
                <button
                  onClick={() => setCursor(i + 1)}
                  className={`rounded px-1.5 py-0.5 text-left font-mono ${
                    cursor === i + 1 ? "bg-secondary font-semibold" : "hover:bg-secondary/50"
                  } ${m.forfeited ? "text-destructive" : ""} ${!m.first_attempt_legal ? "text-chart-4" : ""}`}
                  title={
                    (m.first_attempt_legal ? "" : `${m.illegal_attempts} illegal attempt(s); `) +
                    (m.eval_cp != null ? `eval ${(m.eval_cp / 100).toFixed(1)}` : "")
                  }
                >
                  {m.san ?? m.uci ?? "…"}
                </button>
              )
              return (
                <div key={r} className="contents">
                  <span className="py-0.5 text-right text-muted-foreground tabular-nums">{r + 1}.</span>
                  {w ? cell(w, wi) : <span />}
                  {b ? cell(b, bi) : <span />}
                </div>
              )
            })}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          <span className="text-chart-4">Amber</span> = move that took an illegal attempt first ·{" "}
          <span className="text-destructive">red</span> = forfeit. Click a move to jump.
        </p>
      </div>
    </div>
  )
}
