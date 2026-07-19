import { useState } from "react"
import { BrainCircuit, Check, Copy, Eye, LockKeyhole, MessageSquareText, MessagesSquare } from "lucide-react"
import type { PuzzleItem } from "@/lib/data"
import { presentReasoning } from "@/lib/reasoning"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { cn } from "@/lib/utils"

function CopyExactButton({ label, text, action = "Copy exact text" }: { label: string; text: string; action?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    setCopied(true)
    void navigator.clipboard.writeText(text).catch(() => {
      const textarea = document.createElement("textarea")
      textarea.value = text
      textarea.style.position = "fixed"
      textarea.style.opacity = "0"
      document.body.append(textarea)
      textarea.select()
      document.execCommand("copy")
      textarea.remove()
    })
    window.setTimeout(() => setCopied(false), 1_500)
  }

  return <Button type="button" variant="ghost" size="xs" onClick={copy} aria-label={`Copy ${label.toLowerCase()}`}>
    {copied ? <Check className="text-emerald-600" /> : <Copy />}{copied ? "Copied" : action}
  </Button>
}

export function ExactPromptBlock({ label, text, tone = "user" }: { label: string; text: string; tone?: "system" | "user" | "assistant" | "schema" | "reasoning" }) {

  return <div className="min-w-0 max-w-full overflow-hidden rounded-xl border bg-background shadow-xs">
    <div className={cn("flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2", tone === "system" || tone === "reasoning" ? "bg-violet-500/[0.06]" : tone === "schema" || tone === "assistant" ? "bg-sky-500/[0.06]" : "bg-emerald-500/[0.05]") }>
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="font-mono text-[10px] uppercase">{tone}</Badge>
        <span className="text-xs font-semibold">{label}</span>
        <span className="text-[10px] text-muted-foreground">{text.length.toLocaleString()} characters</span>
      </div>
      <CopyExactButton label={label} text={text} />
    </div>
    <pre className="max-h-[34rem] min-w-0 max-w-full overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[11px] leading-relaxed text-foreground [overflow-wrap:anywhere] sm:text-xs">{text}</pre>
  </div>
}

type PromptTurn = NonNullable<PuzzleItem["turns"]>[number]

function messageText(value: unknown): string {
  if (typeof value === "string") return value
  if (value == null) return ""
  return JSON.stringify(value, null, 2)
}

function messageLabel(role: string, index: number, current: boolean): string {
  const description = role === "system"
    ? "system instructions"
    : role === "assistant"
      ? "prior model response"
      : current
        ? "current user prompt"
        : "prior user prompt"
  return `Message ${index + 1} · ${description}`
}

function ReasoningContinuityBlock({ index, text }: { index: number; text: string }) {
  return <Accordion type="single" collapsible className="rounded-xl border border-violet-500/20 bg-violet-500/[0.04] px-3">
    <AccordionItem value="reasoning-continuity" className="border-0">
      <AccordionTrigger className="py-2.5 text-xs">
        <span className="flex min-w-0 flex-wrap items-center gap-2 text-left">
          <BrainCircuit className="size-3.5 shrink-0 text-violet-600 dark:text-violet-300" />
          <span>Message {index + 1} · provider reasoning continuity</span>
          <Badge variant="outline" className="font-mono text-[9px]">included in request</Badge>
        </span>
      </AccordionTrigger>
      <AccordionContent className="pb-3">
        <ExactPromptBlock label={`Message ${index + 1} · exact reasoning continuity`} text={text} tone="reasoning" />
      </AccordionContent>
    </AccordionItem>
  </Accordion>
}

function ExactRequestConversation({ messages }: { messages: Array<Record<string, unknown>> }) {
  const exactJSON = JSON.stringify(messages, null, 2)
  const lastUserIndex = messages.findLastIndex((message) => message.role === "user")

  return <div className="min-w-0 overflow-hidden rounded-xl border bg-background shadow-xs">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-emerald-500/[0.04] px-3 py-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <MessagesSquare className="size-3.5 text-emerald-700 dark:text-emerald-300" />
        <span className="text-xs font-semibold">Complete request conversation</span>
        <Badge variant="outline" className="font-mono text-[9px]">{messages.length} messages</Badge>
      </div>
      <CopyExactButton label="complete request messages JSON" text={exactJSON} action="Copy exact JSON" />
    </div>
    <p className="border-b px-3 py-2 text-[10px] leading-relaxed text-muted-foreground">
      These are the complete messages sent for this solver move, including prior prompts, model answers, and available reasoning continuity.
    </p>
    <div className="space-y-3 p-3">
      {messages.map((message, index) => {
        const role = typeof message.role === "string" ? message.role : "message"
        const current = role === "user" && index === lastUserIndex
        const tone = role === "system" ? "system" : role === "assistant" ? "assistant" : "user"
        const content = messageText(message.content)
        const reasoningDetails = Array.isArray(message.reasoning_details)
          ? JSON.stringify(message.reasoning_details, null, 2)
          : null
        const reasoning = typeof message.reasoning === "string" ? message.reasoning : null
        return <div key={`${role}-${index}`} className="space-y-2">
          <ExactPromptBlock label={messageLabel(role, index, current)} text={content || "—"} tone={tone} />
          {reasoningDetails ? <ReasoningContinuityBlock index={index} text={reasoningDetails} /> : null}
          {!reasoningDetails && reasoning ? <ReasoningContinuityBlock index={index} text={reasoning} /> : null}
        </div>
      })}
    </div>
  </div>
}

export function ProviderReasoning({
  reasoning,
  details,
  reasoningTokens = 0,
}: {
  reasoning?: string | null
  details?: Array<Record<string, unknown>> | null
  reasoningTokens?: number
}) {
  const presented = presentReasoning(reasoning, details)
  if (!presented.readableText && !presented.nativeBlockCount && reasoningTokens <= 0) return null
  const hiddenOnly = !presented.readableText
  return <Accordion type="single" collapsible className="rounded-xl border border-violet-500/20 bg-violet-500/[0.04] px-3">
    <AccordionItem value="provider-reasoning" className="border-0">
      <AccordionTrigger className="py-2.5 text-xs">
        <span className="flex min-w-0 flex-wrap items-center gap-2 text-left">
          {hiddenOnly
            ? <LockKeyhole className="size-3.5 shrink-0 text-violet-600 dark:text-violet-300" />
            : <BrainCircuit className="size-3.5 shrink-0 text-violet-600 dark:text-violet-300" />}
          <span>{hiddenOnly ? "Hidden model reasoning" : "Readable model reasoning"}</span>
          {presented.readableText ? <Badge variant="outline" className="gap-1 font-mono text-[9px]"><Eye className="size-2.5" /> readable</Badge> : null}
          {reasoningTokens > 0 ? <Badge variant="outline" className="font-mono text-[9px]">{reasoningTokens.toLocaleString()} tokens</Badge> : null}
          {presented.hiddenBlockCount > 0 ? <Badge variant="outline" className="font-mono text-[9px]">{presented.hiddenBlockCount} opaque</Badge> : null}
        </span>
      </AccordionTrigger>
      <AccordionContent className="space-y-3 pb-3">
        {presented.readableText ? <>
          <p className="text-[10px] leading-relaxed text-muted-foreground">Readable reasoning returned by the inference provider. It is audit material, not part of the scored answer, and may be a provider-generated summary rather than the model&apos;s complete internal computation.</p>
          <ExactPromptBlock label="Readable provider reasoning" text={presented.readableText} tone="reasoning" />
        </> : <p className="rounded-lg border border-dashed bg-background/60 px-3 py-2.5 text-[10px] leading-relaxed text-muted-foreground">The provider reported reasoning usage but returned no human-readable reasoning text.</p>}
        {presented.nativeBlockCount > 0 ? <div className="flex items-start gap-2.5 rounded-lg border bg-background/70 px-3 py-2.5">
          <LockKeyhole className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 space-y-1">
            <p className="text-[10px] font-semibold text-foreground">Native continuity artifact preserved</p>
            <p className="text-[10px] leading-relaxed text-muted-foreground">{presented.nativeBlockCount} provider-native block{presented.nativeBlockCount === 1 ? " is" : "s are"} stored exactly for audit and same-session continuation. Signatures and encrypted content are not rendered as readable thought; the complete artifact remains in the scoped JSON export.</p>
            <div className="flex flex-wrap gap-1 pt-0.5">{presented.blockTypes.map((type) => <Badge key={type} variant="secondary" className="font-mono text-[9px]">{type}</Badge>)}{presented.signedBlockCount > 0 ? <Badge variant="secondary" className="font-mono text-[9px]">{presented.signedBlockCount} signed</Badge> : null}</div>
          </div>
        </div> : null}
      </AccordionContent>
    </AccordionItem>
  </Accordion>
}

export function PromptTranscript({ turns, includeResponses = true }: { turns: PromptTurn[]; includeResponses?: boolean }) {
  if (!turns.length) return <p className="text-xs text-muted-foreground">This legacy item does not contain a turn-level prompt transcript.</p>
  return <div className="min-w-0 max-w-full overflow-hidden rounded-xl border bg-muted/15">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
      <div className="flex items-center gap-2"><MessageSquareText className="size-4 text-emerald-600" /><span className="text-sm font-semibold">Exact prompt transcript</span></div>
      <span className="text-[10px] text-muted-foreground">Literal stored messages · no truncation or reconstruction</span>
    </div>
    <Accordion type="multiple" defaultValue={["turn-0"]}>
      {turns.map((turn, index) => {
        const requestMessages = turn.request_payload?.messages
        return <AccordionItem key={`${turn.solver_ply}-${index}`} value={`turn-${index}`} className="min-w-0 px-4">
        <AccordionTrigger className="py-3">
          <span className="flex flex-wrap items-center gap-2"><span>Solver move {turn.solver_ply + 1}</span><Badge variant="secondary" className="font-mono text-[10px]">{turn.parsed_move ?? "unparsed"}</Badge></span>
        </AccordionTrigger>
        <AccordionContent className="min-w-0 space-y-3">
          {requestMessages?.length
            ? <ExactRequestConversation messages={requestMessages} />
            : <>
              {turn.system_prompt ? <ExactPromptBlock label="Stored system prompt" text={turn.system_prompt} tone="system" /> : null}
              {turn.prompt ? <ExactPromptBlock label="Stored current-turn user prompt" text={turn.prompt} /> : null}
              <p className="px-1 text-[10px] leading-relaxed text-muted-foreground">This legacy record predates storage of the complete request messages array.</p>
            </>}
          {includeResponses ? <ExactPromptBlock label="Visible model response" text={turn.raw_response ?? "—"} tone="assistant" /> : null}
          <ProviderReasoning reasoning={turn.reasoning} details={turn.reasoning_details} reasoningTokens={turn.reasoning_tokens} />
          <div className="flex flex-wrap items-center gap-3 px-1 font-mono text-[10px] text-muted-foreground">
            <span>{turn.prompt_tokens.toLocaleString()} prompt</span><span>{turn.completion_tokens.toLocaleString()} completion</span><span>{turn.reasoning_tokens.toLocaleString()} reasoning</span>{(turn.cache_read_tokens ?? 0) > 0 ? <span className="text-emerald-700 dark:text-emerald-300">{turn.cache_read_tokens?.toLocaleString()} cached</span> : null}<span>${turn.cost_usd.toFixed(5)}</span>
          </div>
        </AccordionContent>
      </AccordionItem>})}
    </Accordion>
  </div>
}
