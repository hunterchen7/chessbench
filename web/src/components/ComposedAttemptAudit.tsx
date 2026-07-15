import { BrainCircuit, Check, CircleDollarSign, FileText, MessageSquareText, X } from "lucide-react"
import { composedTurnUsage, type ComposedAnswer, type ComposedTurn } from "@/lib/composed"
import { responseStyleInfo } from "@/lib/format"
import { ModelIdentity } from "@/components/ModelIdentity"
import { ResponseStyleBadge } from "@/components/ResponseStyle"
import { Badge } from "@/components/ui/badge"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"

const short = (model: string) => model.includes("/") ? model.split("/").at(-1)! : model
const integer = (value: number) => value.toLocaleString()
const dollars = (value: number) => value ? `$${value.toFixed(value < 0.01 ? 5 : 4)}` : "$0.0000"

function formatMetadata(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function FormatBadge({ turn, answer }: { turn: ComposedTurn; answer: ComposedAnswer }) {
  const style = responseStyleInfo(answer.condition)
  const valid = turn.response_format_valid ?? answer.response_format_valid
  const label = valid == null
    ? `${style.shortLabel} · unreported`
    : valid
      ? style.key === "move_only" ? "parseable text" : "valid JSON"
      : "format recovered"
  return <Badge variant={valid === false ? "destructive" : "outline"} title={`Response protocol: ${style.protocol}`}>{style.protocol} · {label}</Badge>
}

function AuditBlock({ label, children, accent = false }: { label: string; children: string; accent?: boolean }) {
  return <section>
    <div className={`mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${accent ? "text-violet-700 dark:text-violet-300" : "text-muted-foreground"}`}>{label}</div>
    <pre className={`max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border p-3 text-[11px] leading-relaxed ${accent ? "border-violet-500/15 bg-violet-500/[0.035]" : "bg-background/80"}`}>{children || "—"}</pre>
  </section>
}

function TurnAudit({ turn, answer, index }: { turn: ComposedTurn; answer: ComposedAnswer; index: number }) {
  const usage = composedTurnUsage(turn)
  const rationale = turn.rationale ?? turn.explanation
  const metadata = formatMetadata(turn.response_format)
  const formatError = turn.response_format_error ?? answer.response_format_error
  return <Accordion type="single" collapsible defaultValue={index === 0 ? `turn-${index}` : undefined}>
    <AccordionItem value={`turn-${index}`} className="conversation-turn overflow-hidden rounded-xl border bg-muted/[0.18]">
    <AccordionTrigger className="flex-wrap px-3 py-2.5 hover:no-underline">
      <span className="text-xs font-semibold">Turn {index + 1}</span>
      {turn.parsed_move && <Badge variant="secondary" className="font-mono">{turn.parsed_move}</Badge>}
      <FormatBadge turn={turn} answer={answer} />
      <span className="ml-auto flex flex-wrap items-center gap-2 font-mono text-[10px] tabular-nums text-muted-foreground">
        <span>{integer(usage.promptTokens)} in</span>
        <span>{integer(usage.completionTokens)} out</span>
        <span>{integer(usage.reasoningTokens)} reasoning</span>
        <span>{dollars(usage.costUsd)}</span>
      </span>
    </AccordionTrigger>
    <AccordionContent className="space-y-4 border-t p-3 pb-3">
      {turn.system_prompt && <AuditBlock label="Exact system prompt">{turn.system_prompt}</AuditBlock>}
      <AuditBlock label="Exact turn prompt">{turn.prompt ?? "Prompt was not retained by this artifact."}</AuditBlock>
      {rationale && <section>
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-700 dark:text-violet-300"><BrainCircuit className="size-3" /> Visible rationale</div>
        <p className="rounded-lg border border-violet-500/15 bg-violet-500/[0.035] p-3 text-xs leading-relaxed">{rationale}</p>
      </section>}
      <AuditBlock label="Raw model response" accent>{turn.raw_response ?? "—"}</AuditBlock>
      {metadata && <AuditBlock label="Provider response-format metadata">{metadata}</AuditBlock>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-background/70 px-3 py-2 font-mono text-[10px] tabular-nums text-muted-foreground">
        <span className="flex items-center gap-1"><FileText className="size-3" /> {integer(usage.promptTokens)} prompt</span>
        <span className="flex items-center gap-1"><MessageSquareText className="size-3" /> {integer(usage.completionTokens)} completion</span>
        <span className="flex items-center gap-1"><BrainCircuit className="size-3" /> {integer(usage.reasoningTokens)} reasoning</span>
        <span className="flex items-center gap-1"><CircleDollarSign className="size-3" /> {dollars(usage.costUsd)} provider cost</span>
      </div>
      {formatError && <p className="rounded-md bg-destructive/8 px-3 py-2 text-[11px] text-destructive">{formatError}</p>}
    </AccordionContent>
    </AccordionItem>
  </Accordion>
}

export function ComposedAttemptAudit({ answer }: { answer: ComposedAnswer }) {
  const style = responseStyleInfo(answer.condition)
  const totals = answer.turns.reduce((sum, turn) => {
    const usage = composedTurnUsage(turn)
    sum.prompt += usage.promptTokens
    sum.completion += usage.completionTokens
    sum.reasoning += usage.reasoningTokens
    sum.cost += usage.costUsd
    return sum
  }, { prompt: 0, completion: 0, reasoning: 0, cost: 0 })

  return <Accordion type="single" collapsible className="overflow-hidden rounded-xl border bg-card">
    <AccordionItem value="attempt">
    <AccordionTrigger className="items-center gap-3 px-3 py-3 hover:no-underline">
      {answer.solved
        ? <Check className="size-4 shrink-0 text-emerald-600" />
        : <X className="size-4 shrink-0 text-rose-500" />}
      <div className="min-w-0 flex-1">
        {answer.model_variant
          ? <ModelIdentity variant={answer.model_variant} compact />
          : <div className="truncate font-medium">{short(answer.model)}</div>}
      </div>
      <div className="hidden flex-wrap items-center justify-end gap-1.5 sm:flex">
        <ResponseStyleBadge condition={answer.condition} compact />
        {answer.status && answer.status !== "completed" && <Badge variant="outline">{answer.status}</Badge>}
        <Badge variant={answer.solved ? "secondary" : "outline"}>{answer.solved ? "solved" : "not solved"}</Badge>
      </div>
    </AccordionTrigger>
    <AccordionContent className="space-y-4 border-t bg-muted/[0.08] p-3 pb-3 sm:p-4 sm:pb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2 sm:hidden"><ResponseStyleBadge condition={answer.condition} compact /><Badge variant={answer.solved ? "secondary" : "outline"}>{answer.solved ? "solved" : "not solved"}</Badge></div>
          <div className="mt-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Verifier result</div>
          <p className="mt-1 text-xs leading-relaxed">{answer.detail || (answer.solved ? "Accepted" : "Not accepted")}</p>
        </div>
        {answer.turns.length > 0 && <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border bg-background/70 px-3 py-2 font-mono text-[10px] tabular-nums text-muted-foreground sm:grid-cols-4">
          <span>{integer(totals.prompt)} in</span><span>{integer(totals.completion)} out</span><span>{integer(totals.reasoning)} reasoning</span><span>{dollars(totals.cost)}</span>
        </div>}
      </div>

      {answer.turns.length > 0
        ? <div className="space-y-2">{answer.turns.map((turn, index) => <TurnAudit key={index} turn={turn} answer={answer} index={index} />)}</div>
        : <div className="space-y-3 rounded-xl border border-dashed p-3">
            <p className="text-[11px] text-muted-foreground">No turn envelopes were recorded for this answer; the persisted visible answer remains available below.</p>
            {answer.answer_rationale && <section><div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-700 dark:text-violet-300">Visible rationale</div><p className="rounded-lg bg-violet-500/[0.035] p-3 text-xs leading-relaxed">{answer.answer_rationale}</p></section>}
            <AuditBlock label="Recorded raw answer" accent>{answer.answer || "—"}</AuditBlock>
            <div className="flex flex-wrap gap-2"><Badge variant="outline">{style.protocol}</Badge>{answer.response_format_valid != null && <Badge variant={answer.response_format_valid ? "secondary" : "destructive"}>{answer.response_format_valid ? (style.key === "move_only" ? "parseable text" : "valid JSON") : "format recovered"}</Badge>}</div>
          </div>}
    </AccordionContent>
    </AccordionItem>
  </Accordion>
}
