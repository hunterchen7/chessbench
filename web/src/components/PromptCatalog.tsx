import { useEffect, useMemo, useState } from "react"
import { Braces, FileCheck2 } from "lucide-react"
import { loadPromptCatalog, type PromptCatalog as PromptCatalogData } from "@/lib/data"
import { ExactPromptBlock } from "@/components/PromptTranscript"
import { ResponseStyleBadge } from "@/components/ResponseStyle"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

type ResponseStyle = "move_only" | "json_rationale"

export function PromptCatalog() {
  const [catalog, setCatalog] = useState<PromptCatalogData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [method, setMethod] = useState(1)
  const [style, setStyle] = useState<ResponseStyle>("move_only")

  useEffect(() => {
    let active = true
    void loadPromptCatalog().then((value) => { if (active) setCatalog(value) }).catch((reason) => { if (active) setError(String(reason)) })
    return () => { active = false }
  }, [])

  const selectedMethod = useMemo(() => catalog?.methods.find((item) => item.display_mode === method) ?? catalog?.methods[0], [catalog, method])
  const selectedStyle = selectedMethod?.styles.find((item) => item.style === style) ?? selectedMethod?.styles[0]

  if (error) return <Card className="border-destructive/30"><CardContent className="py-6 text-sm text-destructive">The exact prompt catalog could not be loaded: {error}</CardContent></Card>
  if (!catalog || !selectedMethod || !selectedStyle) return <Card aria-label="Loading exact prompts" aria-busy="true"><CardContent className="grid gap-4 p-5 lg:grid-cols-[220px_minmax(0,1fr)]"><div className="space-y-2">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-12 w-full" />)}</div><div className="space-y-4"><div className="flex justify-between gap-4"><div className="space-y-2"><Skeleton className="h-6 w-52" /><Skeleton className="h-3 w-80 max-w-full" /></div><Skeleton className="h-9 w-44" /></div><Skeleton className="h-48 w-full" /><Skeleton className="h-64 w-full" /></div></CardContent></Card>

  const schemaText = selectedStyle.provider_response_format == null ? null : JSON.stringify(selectedStyle.provider_response_format, null, 2)
  return <div className="space-y-4" id="exact-prompts">
    <Card className="overflow-hidden border-emerald-500/25">
      <CardContent className="p-0">
        <div className="border-b bg-emerald-500/[0.045] p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2"><FileCheck2 className="size-4 text-emerald-600" /><h3 className="font-semibold">Exact Standard prompt library</h3><Badge variant="outline">generated from harness code</Badge></div>
              <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">These are complete first-turn messages for reference puzzle <span className="font-mono text-foreground">{catalog.reference.puzzle_id}</span>. There are no placeholders or shortened coaching blocks. Position and history fields change per puzzle; every actual run transcript is stored separately.</p>
            </div>
            <div className="text-right text-[10px] text-muted-foreground"><div className="font-mono text-foreground">{catalog.reference.suite}</div><div>{catalog.reference.content_hash}</div></div>
          </div>
        </div>

        <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[220px_minmax(0,1fr)]">
          <div className="space-y-2" role="group" aria-label="Prompt method">
            {catalog.methods.map((item) => <Button key={item.display_mode} type="button" variant="ghost" onClick={() => setMethod(item.display_mode)} aria-pressed={item.display_mode === selectedMethod.display_mode} className={cn("h-auto w-full justify-start px-3 py-2.5 text-left whitespace-normal", item.display_mode === selectedMethod.display_mode && "bg-foreground text-background hover:bg-foreground hover:text-background") }>
              <span className="grid size-6 shrink-0 place-items-center rounded-md border border-current/20 font-mono text-xs">{item.display_mode}</span><span><span className="block text-sm font-semibold">{item.name}</span><span className="block font-mono text-[9px] opacity-70">{item.prompt_version}</span></span>
            </Button>)}
          </div>

          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><div className="text-lg font-semibold">Method {selectedMethod.display_mode} · {selectedMethod.name}</div><div className="mt-0.5 max-w-xl break-all font-mono text-[9px] leading-relaxed text-muted-foreground">{selectedStyle.condition_slug}</div></div>
              <Tabs value={style} onValueChange={(value) => setStyle(value as ResponseStyle)}>
                <TabsList><TabsTrigger value="move_only"><ResponseStyleBadge condition="plain-text-v1" compact /></TabsTrigger><TabsTrigger value="json_rationale"><ResponseStyleBadge condition="json-rationale" compact /></TabsTrigger></TabsList>
              </Tabs>
            </div>
            <ExactPromptBlock label="Exact system prompt" text={selectedStyle.system_prompt} tone="system" />
            <ExactPromptBlock label="Exact user prompt" text={selectedStyle.user_prompt} />
            {schemaText ? <ExactPromptBlock label="Exact provider response-format constraint" text={schemaText} tone="schema" /> : <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground"><Braces className="size-3.5" /> Move-only requests send no provider response-format schema.</div>}
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
}
