import { memo, useEffect, useMemo, useRef, useState } from "react"
import {
  Bot,
  BrainCircuit,
  Check,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Code2,
  LockKeyhole,
  MessageSquareText,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react"
import type {
  Condition,
  GameMove,
  GameMoveAttempt,
  ModelVariant,
  TournamentGame,
} from "@/lib/data"
import { ModelIdentity } from "@/components/ModelIdentity"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type VariantCollection = ModelVariant[] | Record<string, ModelVariant> | undefined

interface GameConversationsProps {
  game: TournamentGame
  condition?: Condition
  variants?: VariantCollection
  cursor: number
  onSelect: (cursor: number) => void
}

interface IndexedMove {
  move: GameMove
  index: number
}

const compactNumber = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })

function shortModel(model: string): string {
  return model.includes("/") ? model.split("/").at(-1)! : model
}

function titleCase(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function isFirstAttemptLegal(move: GameMove): boolean {
  return move.first_attempt_legal ?? move.attempts?.[0]?.legal ?? !move.forfeited
}

function illegalAttemptCount(move: GameMove): number {
  return move.illegal_attempts ?? move.attempts?.filter((attempt) => !attempt.legal).length ?? 0
}

function findVariant(label: string, variants: VariantCollection, condition?: Condition): ModelVariant {
  const candidates = Array.isArray(variants) ? variants : variants ? Object.values(variants) : []
  const variant = candidates.find(
    (entry) => entry.key === label || entry.model_id === label || entry.base_key === label || entry.label === label,
  )
  if (variant) return variant

  const provider = label.includes("/") ? label.split("/")[0] : "baseline"
  const effort = condition?.reasoning_effort ?? null
  const maxTokens = condition?.reasoning_max_tokens ?? null
  return {
    key: `${label}--${maxTokens ? `r${maxTokens}t` : `r-${effort ?? "default"}`}`,
    base_key: label,
    display_name: shortModel(label),
    provider,
    model_id: label,
    reasoning: { effort, max_tokens: maxTokens, exclude: true },
    max_output_tokens: condition?.max_output_tokens ?? 2048,
  }
}

function modeLabel(condition?: Condition): string {
  if (!condition) return "Game protocol"
  if (condition.prompt_style === "coached") return "Mode 3 · coached"
  if (condition.legality === "legal_list") return "Mode 2 · legal moves"
  return "Mode 1 · raw position"
}

function reasoningLabel(condition?: Condition): string {
  if (condition?.reasoning_max_tokens) return `${condition.reasoning_max_tokens.toLocaleString()} thinking tokens`
  if (condition?.reasoning_effort) return `${condition.reasoning_effort} reasoning`
  return "default reasoning"
}

function totalUsage(moves: IndexedMove[]) {
  let prompt = 0
  let completion = 0
  let reasoning = 0
  let cost = 0
  for (const { move } of moves) {
    if (move.attempts?.length) {
      for (const attempt of move.attempts) {
        prompt += attempt.prompt_tokens
        completion += attempt.completion_tokens
        reasoning += attempt.reasoning_tokens
        cost += attempt.cost_usd
      }
    } else {
      prompt += move.prompt_tokens ?? 0
      completion += move.completion_tokens ?? 0
      reasoning += move.reasoning_tokens ?? 0
      cost += move.cost_usd ?? 0
    }
  }
  return { prompt, completion, reasoning, cost }
}

function UsageStrip({ attempt }: { attempt: GameMoveAttempt }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
      <span title="Prompt tokens">{attempt.prompt_tokens.toLocaleString()} in</span>
      <span title="Completion tokens">{attempt.completion_tokens.toLocaleString()} out</span>
      <span className="inline-flex items-center gap-1 text-violet-600 dark:text-violet-300" title="Reasoning tokens">
        <BrainCircuit className="size-3" /> {attempt.reasoning_tokens.toLocaleString()} think
      </span>
      <span title="Provider-reported cost">${attempt.cost_usd.toFixed(5)}</span>
    </div>
  )
}

const AttemptExchange = memo(function AttemptExchange({
  attempt,
  attemptIndex,
  revealPrompt,
}: {
  attempt: GameMoveAttempt
  attemptIndex: number
  revealPrompt: boolean
}) {
  const rationale = attempt.rationale ?? attempt.explanation
  return (
    <div className={cn("space-y-2.5", attemptIndex > 0 && "border-t border-border/60 pt-3")}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {attempt.legal ? <Check className="size-3 text-emerald-600" /> : <X className="size-3 text-rose-500" />}
          Attempt {attemptIndex + 1}
        </div>
        <Badge
          variant="outline"
          className={cn(
            "h-5 px-1.5 text-[10px] font-normal",
            attempt.legal
              ? "border-emerald-500/25 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300"
              : "border-rose-500/25 bg-rose-500/8 text-rose-700 dark:text-rose-300",
          )}
        >
          {attempt.legal ? attempt.parsed_move ?? "legal" : "illegal"}
        </Badge>
      </div>

      {revealPrompt ? (
        <div className="space-y-2">
          {attempt.system_prompt ? (
            <div className="rounded-xl border border-border/60 bg-background/70 p-2.5">
              <div className="mb-1.5 flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                <LockKeyhole className="size-3" /> System prompt
              </div>
              <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words text-[10px] leading-relaxed text-foreground/80">
                {attempt.system_prompt}
              </pre>
            </div>
          ) : null}
          <div className="rounded-xl border border-border/60 bg-background/70 p-2.5">
            <div className="mb-1.5 flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <MessageSquareText className="size-3" /> Exact turn prompt
            </div>
            <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words text-[10px] leading-relaxed text-foreground/80">
              {attempt.prompt ?? "Prompt unavailable"}
            </pre>
          </div>
        </div>
      ) : null}

      {rationale ? (
        <div className="rounded-xl border border-violet-500/15 bg-violet-500/[0.06] p-2.5">
          <div className="mb-1 flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-violet-700 dark:text-violet-300">
            <Sparkles className="size-3" /> Visible rationale
          </div>
          <p className="text-[11px] leading-relaxed text-foreground/80">{rationale}</p>
        </div>
      ) : null}

      <div className="rounded-xl bg-foreground/[0.035] p-2.5 dark:bg-foreground/[0.055]">
        <div className="mb-1 flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          <Bot className="size-3" /> Raw model response
        </div>
        <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed">
          {attempt.raw_response || "Empty response"}
        </pre>
      </div>

      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {attempt.response_format_valid != null ? (
            <Badge variant="outline" className="h-5 px-1.5 text-[9px] font-normal">
              <Code2 className="size-3" /> {attempt.response_format_valid ? "valid format" : "format recovered"}
            </Badge>
          ) : null}
          <UsageStrip attempt={attempt} />
        </div>
        {attempt.response_format_error ? (
          <p className="text-[10px] leading-relaxed text-rose-600 dark:text-rose-300">{attempt.response_format_error}</p>
        ) : null}
      </div>
    </div>
  )
})

const TurnCard = memo(function TurnCard({
  indexed,
  isCurrent,
  isFuture,
  onSelect,
}: {
  indexed: IndexedMove
  isCurrent: boolean
  isFuture: boolean
  onSelect: (cursor: number) => void
}) {
  const { move, index } = indexed
  const [expanded, setExpanded] = useState(false)
  const attempts = move.attempts ?? []
  const illegal = illegalAttemptCount(move)
  const firstLegal = isFirstAttemptLegal(move)
  const showPrompts = isCurrent || expanded

  return (
    <article
      data-turn-index={index}
      aria-current={isCurrent ? "step" : undefined}
      className={cn(
        "conversation-turn rounded-2xl border bg-card/90 shadow-sm transition-all",
        isCurrent && "border-primary/35 shadow-[0_0_0_3px_color-mix(in_oklch,var(--ring)_12%,transparent)]",
        isFuture && "opacity-45 hover:opacity-80",
        move.forfeited && "border-rose-500/35",
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(index + 1)}
        className="flex w-full items-center justify-between gap-3 rounded-t-2xl px-3 py-2.5 text-left hover:bg-muted/45"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{move.ply}.</span>
          <span className={cn("truncate font-mono text-sm font-semibold", move.forfeited && "text-rose-600")}>
            {move.san ?? move.uci ?? "forfeit"}
          </span>
          {isCurrent ? <span className="size-1.5 shrink-0 rounded-full bg-primary shadow-[0_0_0_3px_color-mix(in_oklch,var(--primary)_15%,transparent)]" /> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {illegal > 0 ? (
            <Badge className="h-5 gap-1 bg-amber-500/12 px-1.5 text-[9px] font-normal text-amber-700 dark:text-amber-300">
              <RotateCcw className="size-3" /> {illegal} retr{illegal === 1 ? "y" : "ies"}
            </Badge>
          ) : null}
          <Badge
            variant="outline"
            className={cn(
              "h-5 px-1.5 text-[9px] font-normal",
              move.forfeited
                ? "border-rose-500/30 text-rose-600"
                : firstLegal
                  ? "border-emerald-500/25 text-emerald-700 dark:text-emerald-300"
                  : "border-amber-500/25 text-amber-700 dark:text-amber-300",
            )}
          >
            {move.forfeited ? "forfeit" : firstLegal ? "first try" : "recovered"}
          </Badge>
        </div>
      </button>

      {attempts.length ? (
        <div className="space-y-3 border-t border-border/60 px-3 py-3">
          {attempts.map((attempt, attemptIndex) => (
            <AttemptExchange
              key={`${index}-${attemptIndex}`}
              attempt={attempt}
              attemptIndex={attemptIndex}
              revealPrompt={showPrompts}
            />
          ))}
          {!isCurrent ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="w-full text-[10px] text-muted-foreground"
              onClick={() => setExpanded((value) => !value)}
            >
              <ChevronDown className={cn("size-3 transition-transform", expanded && "rotate-180")} />
              {expanded ? "Hide exact prompts" : "Inspect exact prompts"}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="border-t border-border/60 px-3 py-3 text-[11px] leading-relaxed text-muted-foreground">
          This move predates per-turn transcript capture. Board and outcome data remain available.
        </div>
      )}
    </article>
  )
})

const ConversationLane = memo(function ConversationLane({
  color,
  label,
  variant,
  moves,
  cursor,
  onSelect,
}: {
  color: "white" | "black"
  label: string
  variant: ModelVariant
  moves: IndexedMove[]
  cursor: number
  onSelect: (cursor: number) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const activeIndex = useMemo(() => {
    let active = -1
    for (const { index } of moves) if (index < cursor) active = index
    return active
  }, [moves, cursor])
  const usage = useMemo(() => totalUsage(moves), [moves])

  useEffect(() => {
    if (activeIndex < 0) {
      listRef.current?.scrollTo({ top: 0, behavior: "smooth" })
      return
    }
    listRef.current
      ?.querySelector<HTMLElement>(`[data-turn-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [activeIndex])

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border bg-background/70 shadow-sm backdrop-blur-sm">
      <div
        className={cn(
          "relative border-b px-4 py-3",
          color === "white"
            ? "bg-gradient-to-br from-white to-stone-100 dark:from-white/10 dark:to-white/[0.03]"
            : "bg-gradient-to-br from-zinc-900 to-zinc-700 text-white dark:from-black dark:to-zinc-900",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className={cn("min-w-0", color === "black" && "[&_div]:text-white [&_span]:border-white/15 [&_span]:text-white/75")}>
            <ModelIdentity variant={variant} compact />
          </div>
          <Badge
            variant="outline"
            className={cn(
              "mt-0.5 h-6 shrink-0 capitalize",
              color === "white" ? "bg-white/65" : "border-white/20 bg-white/10 text-white",
            )}
          >
            <span className={cn("size-2 rounded-full", color === "white" ? "border border-zinc-300 bg-white" : "bg-zinc-950")} />
            {color}
          </Badge>
        </div>
        <div className={cn("mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[10px]", color === "white" ? "text-muted-foreground" : "text-white/55")}>
          <span>{moves.length} turns</span>
          <span>{compactNumber.format(usage.prompt + usage.completion)} visible tokens</span>
          <span>{compactNumber.format(usage.reasoning)} reasoning</span>
          <span>${usage.cost.toFixed(4)}</span>
        </div>
      </div>

      <div ref={listRef} className="scrollbar-none max-h-[640px] min-h-72 flex-1 space-y-3 overflow-y-auto p-3 xl:min-h-[560px]">
        {moves.length ? (
          moves.map((indexed) => (
            <TurnCard
              key={`${label}-${indexed.index}`}
              indexed={indexed}
              isCurrent={indexed.index === activeIndex}
              isFuture={indexed.index >= cursor}
              onSelect={onSelect}
            />
          ))
        ) : (
          <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed p-6 text-center">
            <MessageSquareText className="mb-3 size-5 text-muted-foreground" />
            <p className="text-sm font-medium">No turns yet</p>
            <p className="mt-1 max-w-48 text-xs leading-relaxed text-muted-foreground">This side has not received a move prompt at the selected point.</p>
          </div>
        )}
      </div>
    </section>
  )
})

export function GameConversations({ game, condition, variants, cursor, onSelect }: GameConversationsProps) {
  const indexed = useMemo<IndexedMove[]>(() => game.moves.map((move, index) => ({ move, index })), [game.moves])
  const whiteMoves = useMemo(() => indexed.filter(({ move }) => move.color === "white"), [indexed])
  const blackMoves = useMemo(() => indexed.filter(({ move }) => move.color === "black"), [indexed])
  const whiteVariant = useMemo(() => findVariant(game.white, variants, condition), [game.white, variants, condition])
  const blackVariant = useMemo(() => findVariant(game.black, variants, condition), [game.black, variants, condition])

  return (
    <div className="space-y-3">
      <div className="flex flex-col justify-between gap-3 rounded-2xl border bg-muted/35 px-4 py-3 sm:flex-row sm:items-center">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 rounded-lg border bg-background p-1.5 text-emerald-600 shadow-sm">
            <ShieldCheck className="size-4" />
          </span>
          <div>
            <div className="text-sm font-semibold">Two isolated model sessions</div>
            <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              Each side receives the board and played moves. The opponent&apos;s prompts, responses, and rationale never enter its context.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 sm:justify-end">
          <Badge variant="outline" className="bg-background/70"><Clock3 className="size-3" /> {condition?.context_mode ? `${titleCase(condition.context_mode)} context` : "Game context"}</Badge>
          <Badge variant="outline" className="bg-background/70"><BrainCircuit className="size-3" /> {reasoningLabel(condition)}</Badge>
          <Badge variant="outline" className="bg-background/70"><CircleDollarSign className="size-3" /> provider cost</Badge>
        </div>
      </div>

      <div className="relative grid min-h-0 gap-3 lg:grid-cols-2">
        <div className="pointer-events-none absolute inset-y-4 left-1/2 z-10 hidden -translate-x-1/2 items-start lg:flex">
          <span className="rounded-full border bg-background p-1.5 text-muted-foreground shadow-sm" title="Conversation boundary">
            <LockKeyhole className="size-3.5" />
          </span>
        </div>
        <ConversationLane color="white" label={game.white} variant={whiteVariant} moves={whiteMoves} cursor={cursor} onSelect={onSelect} />
        <ConversationLane color="black" label={game.black} variant={blackVariant} moves={blackMoves} cursor={cursor} onSelect={onSelect} />
      </div>

      <div className="flex items-center justify-between gap-3 px-1 text-[10px] text-muted-foreground">
        <span>Future turns are dimmed. Select any turn to synchronize the board.</span>
        <span className="hidden font-medium sm:inline">{modeLabel(condition)}</span>
      </div>
    </div>
  )
}
