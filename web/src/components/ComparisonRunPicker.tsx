import { useDeferredValue, useMemo, useState } from "react"
import { BrainCircuit, Check, CircleDollarSign, Database, Plus, RotateCcw, Search, SlidersHorizontal, X } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"
import type { RatedSessionProtocol, RunIndexEntry } from "@/lib/data"
import { modeInfo, responseStyleInfo } from "@/lib/format"
import { reasoningConfigurationEffort, reasoningEffortLabel, reasoningLabel } from "@/lib/modelReasoning"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const ALL = "__all__"
const REASONING_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "budget", "provider"]
const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
})

interface RunPickerMetadata {
  run: RunIndexEntry
  modelKey: string
  modelName: string
  provider: string
  reasoningKey: string
  reasoning: string
  seed: number | null
  searchText: string
}

function runSeed(run: RunIndexEntry) {
  return run.protocol?.kind === "adaptive_glicko2"
    ? (run.protocol as RatedSessionProtocol).selection.seed
    : null
}

function reasoningText(run: RunIndexEntry) {
  const effort = reasoningConfigurationEffort(run.model_variant)
  return effort === "budget"
    ? reasoningLabel(run.model_variant)
    : reasoningEffortLabel(effort)
}

function runMethod(run: RunIndexEntry) {
  const mode = modeInfo(run.condition)
  return mode ? `${mode.displayN}. ${mode.name}` : "Special protocol"
}

function runProvider(run: RunIndexEntry) {
  const routed = run.model_variant.provider_route?.only ?? []
  if (routed.length === 1) return routed[0]
  const encodedRoute = run.model_variant.key.match(/--route-only-(.+?)(?:-no-fallbacks|-required-params|$)/)?.[1]
  return encodedRoute || run.model_variant.provider || run.provider
}

function runMetadata(run: RunIndexEntry): RunPickerMetadata {
  const modelName = run.model_variant.display_name
  const provider = runProvider(run)
  const reasoningKey = reasoningConfigurationEffort(run.model_variant)
  const reasoning = reasoningText(run)
  const seed = runSeed(run)
  const searchText = [
    modelName,
    run.model_variant.model_id,
    run.model_variant.base_key,
    provider,
    run.model_variant.provider,
    reasoning,
    reasoningLabel(run.model_variant),
    seed == null ? "" : `seed ${seed}`,
    runMethod(run),
    responseStyleInfo(run.condition).label,
    run.status,
    run.run_id,
  ].join(" ").toLocaleLowerCase()

  return {
    run,
    modelKey: run.model_variant.base_key || run.model_variant.model_id,
    modelName,
    provider,
    reasoningKey,
    reasoning,
    seed,
    searchText,
  }
}

function uniqueSorted(values: string[]) {
  return [...new Set(values)].toSorted((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}

function RunResult({ metadata, onSelect }: { metadata: RunPickerMetadata; onSelect: (id: string) => void }) {
  const { run, provider, reasoning, seed } = metadata
  const estimate = run.summary.puzzle_performance_rating
  const deviation = estimate?.rating_deviation ?? estimate?.stderr ?? null
  const cost = run.summary.cost_usd

  return <button
    type="button"
    onClick={() => onSelect(run.run_id)}
    className="group w-full cursor-pointer rounded-xl border bg-background p-3 text-left transition-[border-color,background-color,box-shadow,transform] hover:-translate-y-px hover:border-violet-500/35 hover:bg-violet-500/[0.035] hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 [content-visibility:auto] [contain-intrinsic-size:auto_112px]"
  >
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="border-border/70 bg-muted/35 text-[10px] font-normal uppercase tracking-wide">{provider}</Badge>
          <Badge variant="outline" className="border-violet-500/30 bg-violet-500/[0.07] text-[10px] font-medium text-violet-700 dark:text-violet-300"><BrainCircuit /> {reasoning}</Badge>
          <Badge variant="outline" className="border-sky-500/30 bg-sky-500/[0.07] text-[10px] font-medium text-sky-700 dark:text-sky-300">Seed {seed ?? "—"}</Badge>
          <Badge variant="outline" className="text-[10px] font-normal">{responseStyleInfo(run.condition).shortLabel}</Badge>
        </div>
        <div className="mt-2 font-medium">{runMethod(run)}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>{run.progress.completed}/{run.progress.total} items</span>
          <span>{DATE_FORMAT.format(new Date(run.completed_at ?? run.updated_at ?? run.created))}</span>
          <span className="font-mono">{run.run_id.slice(0, 8)}</span>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="font-mono text-lg font-semibold tabular-nums">{estimate ? Math.round(estimate.rating).toLocaleString() : "—"}</div>
        <div className="font-mono text-[10px] tabular-nums text-muted-foreground">RD {deviation == null ? "—" : deviation.toFixed(2)}</div>
        <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-muted-foreground"><CircleDollarSign className="size-3" />{cost == null ? "—" : `$${cost.toFixed(3)}`}</div>
      </div>
    </div>
    <div className="mt-2 flex items-center justify-end gap-1 text-[11px] font-medium text-violet-700 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 dark:text-violet-300"><Check className="size-3" /> Add to comparison</div>
  </button>
}

export function ComparisonRunPicker({
  runs,
  onSelect,
  disabled = false,
  placeholder,
  suiteConstrained = false,
}: {
  runs: RunIndexEntry[]
  onSelect: (id: string) => void
  disabled?: boolean
  placeholder: string
  suiteConstrained?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [provider, setProvider] = useState(ALL)
  const [model, setModel] = useState(ALL)
  const [reasoning, setReasoning] = useState(ALL)
  const [seed, setSeed] = useState(ALL)
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase())
  const metadata = useMemo(() => runs.map(runMetadata), [runs])

  const providers = useMemo(() => uniqueSorted(metadata.map((entry) => entry.provider)), [metadata])
  const models = useMemo(() => uniqueSorted(metadata
    .filter((entry) => provider === ALL || entry.provider === provider)
    .map((entry) => entry.modelKey)), [metadata, provider])
  const modelNames = useMemo(() => new Map(metadata.map((entry) => [entry.modelKey, entry.modelName])), [metadata])
  const reasoningOptions = useMemo(() => uniqueSorted(metadata
    .filter((entry) => (provider === ALL || entry.provider === provider) && (model === ALL || entry.modelKey === model))
    .map((entry) => entry.reasoningKey)).toSorted((a, b) => {
      const left = REASONING_ORDER.indexOf(a)
      const right = REASONING_ORDER.indexOf(b)
      return (left < 0 ? REASONING_ORDER.length : left) - (right < 0 ? REASONING_ORDER.length : right) || a.localeCompare(b)
    }), [metadata, model, provider])
  const reasoningNames = useMemo(() => new Map(metadata.map((entry) => [entry.reasoningKey, entry.reasoning])), [metadata])
  const seeds = useMemo(() => uniqueSorted(metadata
    .filter((entry) =>
      (provider === ALL || entry.provider === provider) &&
      (model === ALL || entry.modelKey === model) &&
      (reasoning === ALL || entry.reasoningKey === reasoning)
    )
    .map((entry) => entry.seed == null ? "none" : String(entry.seed))), [metadata, model, provider, reasoning])

  const filtered = useMemo(() => {
    const next: RunPickerMetadata[] = []
    let freeQuery = deferredQuery
    const explicitSeed = freeQuery.match(/(?:^|\s)seed(?::|=|\s)+(\d+|none|—)(?=\s|$)/)?.[1] ?? null
    const explicitProvider = freeQuery.match(/(?:^|\s)provider(?::|=)([^\s]+)(?=\s|$)/)?.[1] ?? null
    const explicitModel = freeQuery.match(/(?:^|\s)model(?::|=)([^\s]+)(?=\s|$)/)?.[1] ?? null
    const explicitReasoning = freeQuery.match(/(?:^|\s)reasoning(?::|=)([^\s]+)(?=\s|$)/)?.[1] ?? null
    freeQuery = freeQuery
      .replace(/(?:^|\s)seed(?::|=|\s)+(\d+|none|—)(?=\s|$)/, " ")
      .replace(/(?:^|\s)(?:provider|model|reasoning)(?::|=)[^\s]+(?=\s|$)/g, " ")
    const queryTokens = freeQuery.split(/\s+/).filter(Boolean)
    for (const entry of metadata) {
      if (provider !== ALL && entry.provider !== provider) continue
      if (model !== ALL && entry.modelKey !== model) continue
      if (reasoning !== ALL && entry.reasoningKey !== reasoning) continue
      if (seed !== ALL && (seed === "none" ? entry.seed != null : String(entry.seed) !== seed)) continue
      if (explicitSeed && (explicitSeed === "none" || explicitSeed === "—" ? entry.seed != null : String(entry.seed) !== explicitSeed)) continue
      if (explicitProvider && !entry.provider.toLocaleLowerCase().includes(explicitProvider)) continue
      if (explicitModel && !`${entry.modelName} ${entry.modelKey}`.toLocaleLowerCase().includes(explicitModel)) continue
      if (explicitReasoning && !`${entry.reasoningKey} ${entry.reasoning}`.toLocaleLowerCase().includes(explicitReasoning)) continue
      if (queryTokens.some((token) => !entry.searchText.includes(token))) continue
      next.push(entry)
    }
    return next.toSorted((a, b) =>
      a.modelName.localeCompare(b.modelName) ||
      a.reasoning.localeCompare(b.reasoning) ||
      (a.seed ?? Number.MAX_SAFE_INTEGER) - (b.seed ?? Number.MAX_SAFE_INTEGER) ||
      b.run.created.localeCompare(a.run.created) ||
      a.run.run_id.localeCompare(b.run.run_id)
    )
  }, [deferredQuery, metadata, model, provider, reasoning, seed])

  const groups = useMemo(() => {
    const next = new Map<string, { name: string; runs: RunPickerMetadata[] }>()
    for (const entry of filtered) {
      const group = next.get(entry.modelKey)
      if (group) group.runs.push(entry)
      else next.set(entry.modelKey, { name: entry.modelName, runs: [entry] })
    }
    return [...next.entries()]
  }, [filtered])

  const clearFilters = () => {
    setQuery("")
    setProvider(ALL)
    setModel(ALL)
    setReasoning(ALL)
    setSeed(ALL)
  }
  const selectRun = (id: string) => {
    onSelect(id)
    setOpen(false)
  }
  const filtersActive = query.length > 0 || provider !== ALL || model !== ALL || reasoning !== ALL || seed !== ALL

  return <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
    <DialogPrimitive.Trigger asChild>
      <Button variant="outline" disabled={disabled} className="w-[min(22rem,80vw)] justify-between font-normal">
        <span className="flex min-w-0 items-center gap-2"><Plus className="size-4" /><span className="truncate">{placeholder}</span></span>
        <SlidersHorizontal className="size-3.5 text-muted-foreground" />
      </Button>
    </DialogPrimitive.Trigger>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content className="fixed inset-x-3 top-1/2 z-50 flex max-h-[min(88vh,820px)] -translate-y-1/2 flex-col overflow-hidden rounded-2xl border bg-background text-foreground shadow-2xl outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:inset-x-auto sm:left-1/2 sm:w-[min(94vw,960px)] sm:-translate-x-1/2">
        <header className="border-b px-4 py-4 pr-12 sm:px-6 sm:py-5 sm:pr-14">
          <DialogPrimitive.Title className="text-lg font-semibold tracking-tight">Choose a compatible run</DialogPrimitive.Title>
          <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">Search every field or narrow the same-suite runs by provider, model, reasoning level, and seed.</DialogPrimitive.Description>
          <DialogPrimitive.Close className="absolute right-4 top-4 cursor-pointer rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Close run picker"><X className="size-4" /></DialogPrimitive.Close>
        </header>

        <div className="space-y-3 border-b bg-muted/20 px-4 py-4 sm:px-6">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search model, provider, reasoning, seed, run ID…" className="h-10 bg-background pl-9" aria-label="Search compatible runs" />
            </div>
            <Button variant="ghost" size="icon-lg" disabled={!filtersActive} onClick={clearFilters} aria-label="Clear run filters"><RotateCcw /></Button>
          </div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Select value={provider} onValueChange={(value) => { setProvider(value); setModel(ALL); setReasoning(ALL); setSeed(ALL) }}>
              <SelectTrigger className="w-full bg-background" aria-label="Filter runs by provider"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value={ALL}>All providers</SelectItem>{providers.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={model} onValueChange={(value) => { setModel(value); setReasoning(ALL); setSeed(ALL) }}>
              <SelectTrigger className="w-full bg-background" aria-label="Filter runs by model"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value={ALL}>All models</SelectItem>{models.map((value) => <SelectItem key={value} value={value}>{modelNames.get(value) ?? value}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={reasoning} onValueChange={(value) => { setReasoning(value); setSeed(ALL) }}>
              <SelectTrigger className="w-full bg-background" aria-label="Filter runs by reasoning"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value={ALL}>All reasoning</SelectItem>{reasoningOptions.map((value) => <SelectItem key={value} value={value}>{reasoningNames.get(value) ?? value}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={seed} onValueChange={setSeed}>
              <SelectTrigger className="w-full bg-background" aria-label="Filter runs by seed"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value={ALL}>All seeds</SelectItem>{seeds.map((value) => <SelectItem key={value} value={value}>{value === "none" ? "Unseeded" : `Seed ${value}`}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-b px-4 py-2 text-xs text-muted-foreground sm:px-6">
          <span>{filtered.length} matching run{filtered.length === 1 ? "" : "s"}</span>
          <span className="hidden items-center gap-1 sm:flex"><Database className="size-3" /> {suiteConstrained ? "Same puzzle pool only" : "All completed puzzle runs"}</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
          {groups.length ? <div className="space-y-6">
            {groups.map(([key, group]) => <section key={key} aria-labelledby={`run-group-${key.replaceAll(/[^a-zA-Z0-9_-]/g, "-")}`}>
              <div className="sticky top-0 z-10 mb-2 flex items-center justify-between gap-3 border-b bg-background/95 pb-2 backdrop-blur">
                <h3 id={`run-group-${key.replaceAll(/[^a-zA-Z0-9_-]/g, "-")}`} className="font-semibold">{group.name}</h3>
                <span className="text-[10px] text-muted-foreground">{group.runs.length} run{group.runs.length === 1 ? "" : "s"}</span>
              </div>
              <div className="grid gap-2 lg:grid-cols-2">{group.runs.map((entry) => <RunResult key={entry.run.run_id} metadata={entry} onSelect={selectRun} />)}</div>
            </section>)}
          </div> : <div className="grid min-h-56 place-items-center rounded-xl border border-dashed text-center">
            <div><Search className="mx-auto size-5 text-muted-foreground" /><div className="mt-3 font-medium">No compatible runs match</div><p className="mt-1 text-sm text-muted-foreground">Try a broader search or clear one of the filters.</p>{filtersActive ? <Button variant="ghost" size="sm" className="mt-3" onClick={clearFilters}><RotateCcw /> Clear filters</Button> : null}</div>
          </div>}
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>
}
