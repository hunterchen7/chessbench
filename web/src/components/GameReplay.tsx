import { lazy, Suspense, useMemo, useState } from "react"
import type { CSSProperties } from "react"
import { Chess } from "chess.js"
import {
  BrainCircuit,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Flag,
  ListTree,
  MessageSquareText,
  ShieldCheck,
  SkipBack,
  SkipForward,
  Sparkles,
} from "lucide-react"
import type { Condition, ModelVariant, TournamentGame } from "@/lib/data"
import { Board } from "@/components/Board"
import { ResponseStyleBadge } from "@/components/ResponseStyle"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

const GameConversations = lazy(() =>
  import("@/components/GameConversations").then((module) => ({ default: module.GameConversations })),
)

interface ReplayFrame {
  fen: string
  uci: string | null
}

/** Build one board frame per persisted turn, retaining the position on a forfeit. */
function buildFrames(game: TournamentGame): ReplayFrame[] {
  const chess = new Chess(game.start_fen || undefined)
  const frames: ReplayFrame[] = [{ fen: chess.fen(), uci: null }]
  for (const move of game.moves) {
    try {
      if (move.uci) {
        chess.move({
          from: move.uci.slice(0, 2),
          to: move.uci.slice(2, 4),
          promotion: move.uci.slice(4) || undefined,
        })
      } else if (move.san) {
        chess.move(move.san)
      }
    } catch {
      // Preserve the last valid board while keeping transcript indices aligned.
    }
    frames.push({ fen: chess.fen(), uci: move.uci })
  }
  return frames
}

function short(model: string): string {
  return model.includes("/") ? model.split("/").at(-1)! : model
}

function modeLabel(condition?: Condition): string {
  if (!condition) return "Game protocol"
  if (condition.prompt_style === "coached") return "Mode 3 · coached"
  if (condition.legality === "legal_list") return "Mode 2 · legal moves"
  return "Mode 1 · raw position"
}

function reasoningLabel(condition?: Condition): string {
  if (condition?.reasoning_max_tokens) return `${condition.reasoning_max_tokens.toLocaleString()} thinking tokens`
  return `${condition?.reasoning_effort ?? "default"} reasoning`
}

function legalOnFirstAttempt(move: TournamentGame["moves"][number]): boolean {
  return move.first_attempt_legal ?? move.attempts?.[0]?.legal ?? !move.forfeited
}

function illegalAttempts(move: TournamentGame["moves"][number]): number {
  return move.illegal_attempts ?? move.attempts?.filter((attempt) => !attempt.legal).length ?? 0
}

function lastMoveStyles(uci: string | null): Record<string, CSSProperties> | undefined {
  if (!uci || uci.length < 4) return undefined
  const style = {
    background: "radial-gradient(circle, color-mix(in oklch, var(--chart-4) 58%, transparent) 0 32%, transparent 34%)",
  }
  return { [uci.slice(0, 2)]: style, [uci.slice(2, 4)]: style }
}

function TranscriptSkeleton() {
  return (
    <div className="space-y-3" aria-label="Loading model conversations">
      <Skeleton className="h-20 rounded-2xl" />
      <div className="grid gap-3 lg:grid-cols-2">
        {[0, 1].map((lane) => (
          <div key={lane} className="space-y-3 rounded-2xl border p-3">
            <Skeleton className="h-16 rounded-xl" />
            <Skeleton className="h-44 rounded-xl" />
            <Skeleton className="h-32 rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function GameReplay({
  game,
  condition,
  variants,
}: {
  game: TournamentGame
  condition?: Condition
  variants?: ModelVariant[] | Record<string, ModelVariant>
}) {
  const frames = useMemo(() => buildFrames(game), [game])
  const [cursor, setCursor] = useState(frames.length - 1)
  const clamp = (next: number) => Math.max(0, Math.min(frames.length - 1, next))
  const currentMove = cursor > 0 ? game.moves[cursor - 1] : null
  const currentFrame = frames[cursor]
  const squareStyles = useMemo(() => lastMoveStyles(currentFrame.uci), [currentFrame.uci])
  const progress = frames.length > 1 ? (cursor / (frames.length - 1)) * 100 : 0

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-2xl border bg-gradient-to-br from-card via-card to-muted/40 shadow-sm">
        <div className="grid items-stretch md:grid-cols-[1fr_auto_1fr]">
          <div className="flex min-w-0 items-center gap-3 p-4 md:p-5">
            <span className="grid size-9 shrink-0 place-items-center rounded-full border bg-white text-xs font-black text-zinc-900 shadow-sm">W</span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold sm:text-base">{short(game.white)}</div>
              <div className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">White session</div>
            </div>
          </div>

          <div className="flex items-center justify-center gap-2 border-y px-5 py-3 md:border-x md:border-y-0">
            <Badge variant="outline" className="bg-background/80 font-mono text-sm shadow-sm">{game.result}</Badge>
            <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{game.termination.replaceAll("_", " ")}</span>
          </div>

          <div className="flex min-w-0 items-center justify-end gap-3 p-4 text-right md:p-5">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold sm:text-base">{short(game.black)}</div>
              <div className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Black session</div>
            </div>
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-zinc-900 text-xs font-black text-white shadow-sm ring-1 ring-white/10">B</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-1.5 border-t bg-muted/25 px-4 py-2.5">
          <Badge variant="outline" className="bg-background/70"><Sparkles className="size-3" /> {modeLabel(condition)}</Badge>
          <ResponseStyleBadge condition={condition} compact />
          <Badge variant="outline" className="bg-background/70"><ListTree className="size-3" /> {condition?.context_mode ? `${condition.context_mode} context` : "game context"}</Badge>
          <Badge variant="outline" className="bg-background/70"><BrainCircuit className="size-3" /> {reasoningLabel(condition)}</Badge>
          <Badge variant="outline" className="border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-300"><ShieldCheck className="size-3" /> isolated chats</Badge>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(300px,430px)_minmax(0,1fr)]">
        <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-2xl border bg-card p-3 shadow-sm sm:p-4">
            <Board
              fen={currentFrame.fen}
              orientation="white"
              squareStyles={squareStyles}
              id="game-replay-board"
              maxWidth={420}
            />

            <div className="mt-4 flex items-center justify-center gap-1">
              <Button variant="outline" size="icon-sm" onClick={() => setCursor(0)} disabled={cursor === 0} aria-label="Initial position">
                <SkipBack className="size-4" />
              </Button>
              <Button variant="outline" size="icon-sm" onClick={() => setCursor((value) => clamp(value - 1))} disabled={cursor === 0} aria-label="Previous turn">
                <ChevronLeft className="size-4" />
              </Button>
              <div className="mx-1 min-w-28 text-center">
                <div className="font-mono text-xs font-semibold tabular-nums">
                  {cursor === 0 ? "Start" : currentMove?.forfeited ? `Turn ${currentMove.ply} · forfeit` : `Ply ${currentMove?.ply ?? cursor}`}
                </div>
                <div className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">{cursor} / {frames.length - 1} records</div>
              </div>
              <Button variant="outline" size="icon-sm" onClick={() => setCursor((value) => clamp(value + 1))} disabled={cursor === frames.length - 1} aria-label="Next turn">
                <ChevronRight className="size-4" />
              </Button>
              <Button variant="outline" size="icon-sm" onClick={() => setCursor(frames.length - 1)} disabled={cursor === frames.length - 1} aria-label="Final position">
                <SkipForward className="size-4" />
              </Button>
            </div>

            <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${progress}%` }} />
            </div>
          </div>

          <div className="rounded-2xl border bg-card p-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between gap-3 px-1">
              <span className="text-xs font-semibold">Move timeline</span>
              <span className="text-[10px] text-muted-foreground">select to jump</span>
            </div>
            <div className="scrollbar-none max-h-52 overflow-y-auto rounded-xl bg-muted/30 p-2">
              <div className="grid grid-cols-[auto_1fr_1fr] items-baseline gap-x-2 gap-y-0.5 text-sm">
                {Array.from({ length: Math.ceil(game.moves.length / 2) }).map((_, row) => {
                  const whiteIndex = row * 2
                  const blackIndex = row * 2 + 1
                  const whiteMove = game.moves[whiteIndex]
                  const blackMove = game.moves[blackIndex]
                  const cell = (move: TournamentGame["moves"][number], index: number) => {
                    const firstLegal = legalOnFirstAttempt(move)
                    const illegal = illegalAttempts(move)
                    return (
                      <button
                        type="button"
                        onClick={() => setCursor(index + 1)}
                        className={cn(
                          "flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-left font-mono transition-colors",
                          cursor === index + 1 ? "bg-primary text-primary-foreground" : "hover:bg-secondary",
                          move.forfeited && cursor !== index + 1 && "text-rose-600",
                          !firstLegal && !move.forfeited && cursor !== index + 1 && "text-amber-700 dark:text-amber-300",
                        )}
                        title={`${move.color} turn${illegal ? ` · ${illegal} illegal attempt(s)` : ""}`}
                      >
                        {move.forfeited ? <Flag className="size-3 shrink-0" /> : <CircleDot className="size-2 shrink-0 opacity-50" />}
                        <span className="truncate">{move.san ?? move.uci ?? "forfeit"}</span>
                      </button>
                    )
                  }
                  return (
                    <div key={row} className="contents">
                      <span className="py-1 text-right text-[10px] text-muted-foreground tabular-nums">{row + 1}.</span>
                      {whiteMove ? cell(whiteMove, whiteIndex) : <span />}
                      {blackMove ? cell(blackMove, blackIndex) : <span />}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        <Suspense fallback={<TranscriptSkeleton />}>
          <GameConversations game={game} condition={condition} variants={variants} cursor={cursor} onSelect={setCursor} />
        </Suspense>
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
        <MessageSquareText className="mt-0.5 size-3.5 shrink-0" />
        <span>The board, move timeline, and both model conversations share one cursor. Exact prompts are automatically expanded for each side&apos;s most recent turn.</span>
      </div>
    </div>
  )
}
