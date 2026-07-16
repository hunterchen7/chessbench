import { useState } from "react"
import { Check, Copy, MessageSquareText } from "lucide-react"
import type { PuzzleItem } from "@/lib/data"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { cn } from "@/lib/utils"

export function ExactPromptBlock({ label, text, tone = "user" }: { label: string; text: string; tone?: "system" | "user" | "schema" }) {
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

  return <div className="overflow-hidden rounded-xl border bg-background shadow-xs">
    <div className={cn("flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2", tone === "system" ? "bg-violet-500/[0.06]" : tone === "schema" ? "bg-sky-500/[0.06]" : "bg-emerald-500/[0.05]") }>
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="font-mono text-[10px] uppercase">{tone}</Badge>
        <span className="text-xs font-semibold">{label}</span>
        <span className="text-[10px] text-muted-foreground">{text.length.toLocaleString()} characters</span>
      </div>
      <Button type="button" variant="ghost" size="xs" onClick={copy} aria-label={`Copy ${label.toLowerCase()}`}>
        {copied ? <Check className="text-emerald-600" /> : <Copy />}{copied ? "Copied" : "Copy exact text"}
      </Button>
    </div>
    <pre className="max-h-[34rem] overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[11px] leading-relaxed text-foreground sm:text-xs">{text}</pre>
  </div>
}

type PromptTurn = NonNullable<PuzzleItem["turns"]>[number]

export function PromptTranscript({ turns, includeResponses = true }: { turns: PromptTurn[]; includeResponses?: boolean }) {
  if (!turns.length) return <p className="text-xs text-muted-foreground">This legacy item does not contain a turn-level prompt transcript.</p>
  return <div className="overflow-hidden rounded-xl border bg-muted/15">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
      <div className="flex items-center gap-2"><MessageSquareText className="size-4 text-emerald-600" /><span className="text-sm font-semibold">Exact prompt transcript</span></div>
      <span className="text-[10px] text-muted-foreground">Literal stored messages · no truncation or reconstruction</span>
    </div>
    <Accordion type="multiple" defaultValue={["turn-0"]}>
      {turns.map((turn, index) => <AccordionItem key={`${turn.solver_ply}-${index}`} value={`turn-${index}`} className="px-4">
        <AccordionTrigger className="py-3">
          <span className="flex flex-wrap items-center gap-2"><span>Solver move {turn.solver_ply + 1}</span><Badge variant="secondary" className="font-mono text-[10px]">{turn.parsed_move ?? "unparsed"}</Badge></span>
        </AccordionTrigger>
        <AccordionContent className="space-y-3">
          {turn.system_prompt ? <ExactPromptBlock label="Exact system prompt" text={turn.system_prompt} tone="system" /> : null}
          {turn.prompt ? <ExactPromptBlock label="Exact user prompt" text={turn.prompt} /> : null}
          {includeResponses ? <ExactPromptBlock label="Visible model response" text={turn.raw_response ?? "—"} tone="schema" /> : null}
          <div className="flex flex-wrap items-center gap-3 px-1 font-mono text-[10px] text-muted-foreground">
            <span>{turn.prompt_tokens.toLocaleString()} prompt</span><span>{turn.completion_tokens.toLocaleString()} completion</span><span>{turn.reasoning_tokens.toLocaleString()} reasoning</span>{(turn.cache_read_tokens ?? 0) > 0 ? <span className="text-emerald-700 dark:text-emerald-300">{turn.cache_read_tokens?.toLocaleString()} cached</span> : null}<span>${turn.cost_usd.toFixed(5)}</span>
          </div>
        </AccordionContent>
      </AccordionItem>)}
    </Accordion>
  </div>
}
