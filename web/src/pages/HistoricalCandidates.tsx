import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react"
import { ArrowLeft, Archive, ExternalLink, FilterX, Landmark, LockKeyhole, Search } from "lucide-react"
import { Link } from "react-router-dom"
import { loadHistoricalCandidates, type HistoricalCandidate, type HistoricalCandidateBank } from "@/lib/data"
import { SortableTableHead, type SortDirection } from "@/components/SortableTableHead"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table"

const PAGE_SIZE = 48
const DIFFICULTY_ORDER = { easy: 0, medium: 1, hard: 2 } as const
const PROVENANCE_ORDER = { high: 0, medium: 1, contested: 2 } as const

type DifficultyFilter = "all" | HistoricalCandidate["difficulty_band"]
type ProvenanceFilter = "all" | HistoricalCandidate["provenance_confidence"]
type SortKey = "players" | "event" | "year" | "difficulty" | "provenance" | "source"

function candidateYear(candidate: HistoricalCandidate): number {
  const year = Number.parseInt(candidate.date.slice(0, 4), 10)
  return Number.isFinite(year) ? year : 0
}

function sourceName(candidate: HistoricalCandidate): string {
  try {
    return new URL(candidate.source_url).hostname.replace(/^www\./, "")
  } catch {
    return "source"
  }
}

function playerLabel(candidate: HistoricalCandidate): string {
  return `${candidate.white} vs ${candidate.black}`
}

function paginationPages(current: number, total: number): number[] {
  const start = Math.max(1, Math.min(current - 2, total - 4))
  const end = Math.min(total, start + 4)
  return Array.from({ length: end - start + 1 }, (_, index) => start + index)
}

function CandidateBadges({ candidate }: { candidate: HistoricalCandidate }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Badge variant="secondary" className="capitalize">{candidate.difficulty_band}</Badge>
      <Badge variant="outline" className="capitalize">{candidate.provenance_confidence} provenance</Badge>
    </div>
  )
}

function SourceLink({ candidate, compact = false }: { candidate: HistoricalCandidate; compact?: boolean }) {
  return (
    <a
      href={candidate.source_url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex max-w-full items-center gap-1.5 font-medium text-violet-700 hover:underline dark:text-violet-300"
      aria-label={`Open source for ${playerLabel(candidate)}`}
    >
      <span className="truncate">{sourceName(candidate)}</span>
      <ExternalLink className="size-3.5 shrink-0" />
      {compact ? <span className="sr-only">Open source</span> : null}
    </a>
  )
}

function CandidateCard({ candidate }: { candidate: HistoricalCandidate }) {
  const contextUrl = candidate.historical_context_url || candidate.source_url
  return (
    <Card className="historical-candidate-row overflow-hidden">
      <CardContent className="space-y-4 pt-5">
        <div className="flex items-start justify-between gap-3">
          <CandidateBadges candidate={candidate} />
          <span className="shrink-0 font-mono text-xs text-muted-foreground">{candidateYear(candidate) || "—"}</span>
        </div>
        <div>
          <h2 className="font-semibold leading-snug">{candidate.white} <span className="font-normal text-muted-foreground">vs</span> {candidate.black}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{candidate.event}</p>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">{candidate.why_famous}</p>
        {candidate.themes.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {candidate.themes.slice(0, 4).map((theme) => <Badge key={theme} variant="outline" className="font-normal">{theme}</Badge>)}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-xs">
          <SourceLink candidate={candidate} compact />
          {contextUrl !== candidate.source_url ? (
            <a href={contextUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline">
              Historical context <ExternalLink className="size-3" />
            </a>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

export function HistoricalCandidates() {
  const [bank, setBank] = useState<HistoricalCandidateBank | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const deferredQuery = useDeferredValue(query)
  const [difficulty, setDifficulty] = useState<DifficultyFilter>("all")
  const [provenance, setProvenance] = useState<ProvenanceFilter>("all")
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({ key: "year", direction: "desc" })
  const [page, setPage] = useState(1)

  const load = useCallback(() => {
    setError(null)
    void loadHistoricalCandidates().then(setBank).catch((reason) => setError(String(reason)))
  }, [])

  useEffect(load, [load])

  const candidates = useMemo(() => {
    if (!bank) return []
    const needle = deferredQuery.trim().toLocaleLowerCase()
    const filtered = bank.items.filter((candidate) => {
      if (difficulty !== "all" && candidate.difficulty_band !== difficulty) return false
      if (provenance !== "all" && candidate.provenance_confidence !== provenance) return false
      if (!needle) return true
      return [
        candidate.id,
        candidate.white,
        candidate.black,
        candidate.event,
        candidate.date,
        candidate.why_famous,
        candidate.line_provenance,
        sourceName(candidate),
        ...candidate.themes,
      ].some((value) => value.toLocaleLowerCase().includes(needle))
    })
    const direction = sort.direction === "asc" ? 1 : -1
    return filtered.toSorted((a, b) => {
      let comparison = 0
      if (sort.key === "players") comparison = playerLabel(a).localeCompare(playerLabel(b))
      else if (sort.key === "event") comparison = a.event.localeCompare(b.event)
      else if (sort.key === "year") comparison = candidateYear(a) - candidateYear(b)
      else if (sort.key === "difficulty") comparison = DIFFICULTY_ORDER[a.difficulty_band] - DIFFICULTY_ORDER[b.difficulty_band]
      else if (sort.key === "provenance") comparison = PROVENANCE_ORDER[a.provenance_confidence] - PROVENANCE_ORDER[b.provenance_confidence]
      else comparison = sourceName(a).localeCompare(sourceName(b))
      return comparison * direction || candidateYear(b) - candidateYear(a) || a.id.localeCompare(b.id)
    })
  }, [bank, deferredQuery, difficulty, provenance, sort.direction, sort.key])

  const totalPages = Math.max(1, Math.ceil(candidates.length / PAGE_SIZE))
  const activePage = Math.min(page, totalPages)
  const pageItems = useMemo(() => {
    const start = (activePage - 1) * PAGE_SIZE
    return candidates.slice(start, start + PAGE_SIZE)
  }, [activePage, candidates])
  const visibleStart = candidates.length === 0 ? 0 : (activePage - 1) * PAGE_SIZE + 1
  const visibleEnd = Math.min(activePage * PAGE_SIZE, candidates.length)
  const filterCount = Number(difficulty !== "all") + Number(provenance !== "all") + Number(Boolean(query.trim()))

  const resetFilters = () => {
    setQuery("")
    setDifficulty("all")
    setProvenance("all")
    setPage(1)
  }

  const toggleSort = (key: SortKey) => {
    setSort((current) => ({
      key,
      direction: current.key === key ? (current.direction === "asc" ? "desc" : "asc") : key === "year" ? "desc" : "asc",
    }))
    setPage(1)
  }

  if (error) return (
    <div className="mx-auto max-w-md rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
      <div className="font-medium text-destructive">Could not load the historical candidate bank</div>
      <p className="mt-1 text-sm text-muted-foreground">{error}</p>
      <Button variant="outline" size="sm" className="mt-4" onClick={load}>Try again</Button>
    </div>
  )

  if (!bank) return (
    <div className="space-y-4 py-20" aria-label="Loading historical candidate bank">
      <div className="mx-auto h-5 w-48 animate-pulse rounded bg-muted" />
      <div className="mx-auto h-52 max-w-5xl animate-pulse rounded-xl bg-muted/60" />
    </div>
  )

  return (
    <div className="space-y-6">
      <header className="grid gap-5 border-b border-border/70 pb-7 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <Link to="/woodpecker" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="size-4" /> Woodpecker track
          </Link>
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-violet-700 dark:text-violet-300">
            <Landmark className="size-4" /> Historical curation lab
          </div>
          <h1 className="text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Historical candidate bank</h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Browse famous positions drawn from World Championships, Candidates events, major tournaments, and landmark human–computer games before they enter a scored suite.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="h-7 px-2.5">{bank.candidate_count.toLocaleString()} candidates</Badge>
          <Badge variant="secondary" className="h-7 px-2.5">0 leaderboard points</Badge>
        </div>
      </header>

      <Card className="overflow-hidden border-amber-500/25 bg-amber-500/[0.04] dark:bg-amber-400/[0.04]">
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-[auto_1fr] sm:items-start">
          <div className="grid size-10 place-items-center rounded-xl bg-amber-500/10 text-amber-800 dark:text-amber-300"><LockKeyhole className="size-5" /></div>
          <div>
            <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">Candidate metadata only</h2><Badge variant="outline">not scored</Badge></div>
            <p className="mt-1.5 max-w-4xl text-sm leading-relaxed text-muted-foreground">
              Legal replay is only the first gate. These records do not affect model rankings until best-defense and alternate-branch review is complete. Solution moves, engine lines, and grading keys are not exposed in this browser.
            </p>
          </div>
        </CardContent>
      </Card>

      <section aria-label="Historical candidate filters" className="flex flex-col gap-3 rounded-xl border bg-card p-3 shadow-xs sm:flex-row sm:flex-wrap sm:items-center">
        <label className="relative min-w-0 flex-1 sm:min-w-64 sm:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <span className="sr-only">Search historical candidates</span>
          <Input
            value={query}
            onChange={(event) => { setQuery(event.target.value); setPage(1) }}
            placeholder="Search players, event, year, theme…"
            className="pl-9"
          />
        </label>
        <Select value={difficulty} onValueChange={(value) => { setDifficulty(value as DifficultyFilter); setPage(1) }}>
          <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All difficulties</SelectItem>
            <SelectItem value="easy">Easy</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="hard">Hard</SelectItem>
          </SelectContent>
        </Select>
        <Select value={provenance} onValueChange={(value) => { setProvenance(value as ProvenanceFilter); setPage(1) }}>
          <SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All provenance</SelectItem>
            <SelectItem value="high">High confidence</SelectItem>
            <SelectItem value="medium">Medium confidence</SelectItem>
            <SelectItem value="contested">Contested</SelectItem>
          </SelectContent>
        </Select>
        {filterCount > 0 ? <Button variant="ghost" size="sm" onClick={resetFilters}><FilterX /> Clear {filterCount}</Button> : null}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>{candidates.length.toLocaleString()} {candidates.length === 1 ? "candidate" : "candidates"}</span>
        <span>{visibleStart.toLocaleString()}–{visibleEnd.toLocaleString()} shown</span>
      </div>

      <div className="grid gap-3 md:hidden">
        {pageItems.map((candidate) => <CandidateCard key={candidate.id} candidate={candidate} />)}
      </div>

      <Card className="hidden overflow-hidden md:block">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTableHead label="Players" active={sort.key === "players"} direction={sort.direction} onSort={() => toggleSort("players")} />
                <SortableTableHead label="Event" active={sort.key === "event"} direction={sort.direction} onSort={() => toggleSort("event")} />
                <SortableTableHead label="Year" active={sort.key === "year"} direction={sort.direction} align="right" onSort={() => toggleSort("year")} />
                <SortableTableHead label="Difficulty" active={sort.key === "difficulty"} direction={sort.direction} onSort={() => toggleSort("difficulty")} />
                <SortableTableHead label="Provenance" active={sort.key === "provenance"} direction={sort.direction} onSort={() => toggleSort("provenance")} />
                <SortableTableHead label="Source" active={sort.key === "source"} direction={sort.direction} onSort={() => toggleSort("source")} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageItems.map((candidate) => (
                <TableRow key={candidate.id} className="historical-candidate-row align-top">
                  <TableCell className="min-w-56 py-4">
                    <div className="font-medium">{candidate.white} <span className="font-normal text-muted-foreground">vs</span> {candidate.black}</div>
                    <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">{candidate.why_famous}</p>
                    {candidate.themes.length > 0 ? <div className="mt-2 flex flex-wrap gap-1">{candidate.themes.slice(0, 3).map((theme) => <Badge key={theme} variant="outline" className="font-normal">{theme}</Badge>)}</div> : null}
                  </TableCell>
                  <TableCell className="min-w-44 py-4 text-sm text-muted-foreground">{candidate.event}</TableCell>
                  <TableCell className="py-4 text-right font-mono text-xs tabular-nums text-muted-foreground">{candidateYear(candidate) || "—"}</TableCell>
                  <TableCell className="py-4"><Badge variant="secondary" className="capitalize">{candidate.difficulty_band}</Badge></TableCell>
                  <TableCell className="py-4"><Badge variant="outline" className="capitalize">{candidate.provenance_confidence}</Badge></TableCell>
                  <TableCell className="max-w-52 py-4 text-xs"><SourceLink candidate={candidate} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {candidates.length === 0 ? (
        <Card><CardContent className="py-14 text-center"><Archive className="mx-auto size-7 text-muted-foreground" /><div className="mt-3 font-medium">No candidates match those filters</div><p className="mt-1 text-sm text-muted-foreground">Try a player surname, tournament, year, or theme.</p><Button variant="outline" size="sm" className="mt-4" onClick={resetFilters}>Clear filters</Button></CardContent></Card>
      ) : null}

      {totalPages > 1 ? (
        <nav aria-label="Historical candidate pages" className="flex flex-wrap items-center justify-center gap-1.5 border-t pt-5">
          <Button variant="outline" size="sm" disabled={activePage === 1} onClick={() => { setPage((current) => Math.max(1, current - 1)); window.scrollTo({ top: 0, behavior: "smooth" }) }}>Previous</Button>
          {paginationPages(activePage, totalPages).map((number) => (
            <Button key={number} variant={number === activePage ? "secondary" : "ghost"} size="icon-sm" aria-current={number === activePage ? "page" : undefined} onClick={() => { setPage(number); window.scrollTo({ top: 0, behavior: "smooth" }) }}>{number}</Button>
          ))}
          <Button variant="outline" size="sm" disabled={activePage === totalPages} onClick={() => { setPage((current) => Math.min(totalPages, current + 1)); window.scrollTo({ top: 0, behavior: "smooth" }) }}>Next</Button>
        </nav>
      ) : null}
    </div>
  )
}
