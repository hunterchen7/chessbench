import { cloneElement, isValidElement, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode, type UIEvent } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Database, Gauge, RotateCcw } from "lucide-react"
import {
  DEFAULT_RATED_PUZZLE_QUERY,
  RATED_PUZZLE_PAGE_SIZE,
  RATED_PUZZLE_TIERS,
  loadRatedPuzzlePage,
  ratedPuzzleQueryFromSearchParams,
  ratedPuzzleQueryParams,
  type RatedPuzzleDirection,
  type RatedPuzzleListItem,
  type RatedPuzzlePage,
  type RatedPuzzleQuery,
  type RatedPuzzleSort,
} from "@/lib/data"
import { humanStore } from "@/lib/human"
import { formatRatingDeviation } from "@/lib/format"
import { orderAfterColumnDrop, usePersistentColumnOrder, type ColumnDropSide } from "@/lib/usePersistentColumnOrder"
import { useData } from "@/lib/useData"
import { cn } from "@/lib/utils"
import { PuzzleNav } from "@/components/PuzzleNav"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const PAGE_SIZE = RATED_PUZZLE_PAGE_SIZE
const ROW_HEIGHT = 68
const HEADER_HEIGHT = 44
const OVERSCAN_ROWS = 8
const INITIAL_SKELETON_ROWS = Array.from({ length: 5 }, (_, index) => index)
const RATED_COLUMN_WIDTHS = ["72px", "minmax(160px,1fr)", "100px", "90px", "minmax(250px,1.5fr)", "110px", "100px", "90px"]
const RATED_COLUMN_DRAG_TYPE = "application/x-chessbench-rated-column"
const QUERY_PARAM_KEYS = ["sort", "direction", "tier", "theme", "id_prefix", "min_rating", "max_rating"]
let sessionRatedPages = new Map<number, RatedPuzzlePage>()
let sessionRatedPoolHash: string | null = null
let sessionAllPuzzles: RatedPuzzleListItem[] | null = null
let sessionAllPuzzlesPoolHash: string | null = null
const sessionSortedPuzzles = new Map<string, RatedPuzzleListItem[]>()

interface FilterDraft {
  tier: string
  theme: string
  idPrefix: string
  minRating: string
  maxRating: string
}

function pageForIndex(index: number) {
  return Math.floor(index / PAGE_SIZE) + 1
}

function rowLabel(index: number) {
  return (index + 1).toLocaleString()
}

function filterDraft(query: RatedPuzzleQuery): FilterDraft {
  return {
    tier: query.tier ?? "all",
    theme: query.theme ?? "",
    idPrefix: query.id_prefix ?? "",
    minRating: query.min_rating == null ? "" : String(query.min_rating),
    maxRating: query.max_rating == null ? "" : String(query.max_rating),
  }
}

function hasFilters(query: RatedPuzzleQuery): boolean {
  return Boolean(query.tier || query.theme || query.id_prefix || query.min_rating != null || query.max_rating != null)
}

function compareRatedPuzzles(a: RatedPuzzleListItem, b: RatedPuzzleListItem, sort: RatedPuzzleSort): number {
  if (sort === "puzzle_id") return a.puzzle_id.localeCompare(b.puzzle_id)
  const left = sort === "rating" ? a.rating : sort === "rating_deviation" ? a.rating_deviation ?? 0 : sort === "popularity" ? a.popularity ?? 0 : a.plays ?? 0
  const right = sort === "rating" ? b.rating : sort === "rating_deviation" ? b.rating_deviation ?? 0 : sort === "popularity" ? b.popularity ?? 0 : b.plays ?? 0
  return left - right || a.puzzle_id.localeCompare(b.puzzle_id)
}

function ratedPuzzleHref(puzzleId: string, index: number, query: RatedPuzzleQuery): string {
  const params = ratedPuzzleQueryParams(query)
  params.set("source", "rated")
  params.set("index", String(index))
  return `/puzzles/${encodeURIComponent(puzzleId)}?${params}`
}

function ratedBrowserHref(query: RatedPuzzleQuery): string {
  const params = ratedPuzzleQueryParams(query)
  params.set("view", "rated")
  return `/puzzles/browse?${params}`
}

function RatedSortHeader({
  label,
  value,
  query,
  onSort,
}: {
  label: string
  value: RatedPuzzleSort
  query: RatedPuzzleQuery
  onSort: (value: RatedPuzzleSort) => void
}) {
  const active = query.sort === value
  const Icon = active ? query.direction === "asc" ? ArrowUp : ArrowDown : ArrowUpDown
  return <button type="button" onClick={() => onSort(value)} className="group inline-flex min-h-8 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60">{label}<Icon className={active ? "size-3.5 text-foreground" : "size-3.5 opacity-45 group-hover:opacity-90"} /></button>
}

interface GridColumnDragState {
  source: string
  target: string | null
  side: ColumnDropSide | null
}

function gridColumnDragVisual(order: string[], dragState: GridColumnDragState | null, columnKey: string) {
  if (!dragState) return {}
  const preview = dragState.target && dragState.side
    ? orderAfterColumnDrop(order, dragState.source, dragState.target, dragState.side)
    : order
  const currentIndex = order.indexOf(columnKey)
  const previewIndex = preview.indexOf(columnKey)
  return {
    dragging: columnKey === dragState.source,
    dropSide: columnKey === dragState.target ? dragState.side ?? undefined : undefined,
    shift: columnKey === dragState.source || currentIndex === previewIndex ? undefined : previewIndex < currentIndex ? "left" : "right",
  }
}

function ReorderableGridHeader({ columnKey, order, move, dragState, onDragStartColumn, onDragOverColumn, onDropColumn, onDragEndColumn, className, ariaSort, children }: { columnKey: string; order: string[]; move: (source: string, target: string) => void; dragState: GridColumnDragState | null; onDragStartColumn: (source: string) => void; onDragOverColumn: (target: string, side: ColumnDropSide) => void; onDropColumn: () => void; onDragEndColumn: () => void; className?: string; ariaSort?: "ascending" | "descending" | "none"; children: ReactNode }) {
  const dragVisual = gridColumnDragVisual(order, dragState, columnKey)
  const moveByKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!event.altKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return
    const index = order.indexOf(columnKey)
    const target = order[index + (event.key === "ArrowLeft" ? -1 : 1)]
    if (target == null) return
    event.preventDefault()
    move(columnKey, target)
  }
  return <div role="columnheader" aria-sort={ariaSort} draggable tabIndex={0} title="Drag to reorder column · Alt+Left/Right from the keyboard" data-column-dragging={dragVisual.dragging || undefined} data-column-drop-side={dragVisual.dropSide} data-column-shift={dragVisual.shift} className={cn("cursor-grab transition-[background-color,box-shadow,opacity,transform] duration-150 ease-out active:cursor-grabbing data-[column-dragging=true]:scale-[0.98] data-[column-dragging=true]:opacity-35 data-[column-drop-side=before]:bg-primary/[0.10] data-[column-drop-side=before]:shadow-[inset_3px_0_0_var(--primary)] data-[column-drop-side=after]:bg-primary/[0.10] data-[column-drop-side=after]:shadow-[inset_-3px_0_0_var(--primary)] data-[column-shift=left]:-translate-x-1.5 data-[column-shift=right]:translate-x-1.5 motion-reduce:transition-none motion-reduce:transform-none", className)} onKeyDown={moveByKeyboard} onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData(RATED_COLUMN_DRAG_TYPE, columnKey); onDragStartColumn(columnKey) }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; const bounds = event.currentTarget.getBoundingClientRect(); onDragOverColumn(columnKey, event.clientX < bounds.left + bounds.width / 2 ? "before" : "after") }} onDrop={(event) => { event.preventDefault(); onDropColumn() }} onDragEnd={onDragEndColumn}>{children}</div>
}

function orderedCells(order: string[], cells: ReactNode[], dragState?: GridColumnDragState | null) {
  return order.map((key) => {
    const child = cells[Number(key)]
    if (!dragState || !isValidElement<{ className?: string }>(child)) return child
    const dragVisual = gridColumnDragVisual(order, dragState, key)
    return cloneElement(child, {
      "data-column-dragging": dragVisual.dragging || undefined,
      "data-column-drop-side": dragVisual.dropSide,
      "data-column-shift": dragVisual.shift,
      className: cn(child.props.className, "transition-[background-color,box-shadow,opacity,transform] duration-150 ease-out data-[column-dragging=true]:opacity-35 data-[column-drop-side=before]:bg-primary/[0.04] data-[column-drop-side=before]:shadow-[inset_2px_0_0_var(--primary)] data-[column-drop-side=after]:bg-primary/[0.04] data-[column-drop-side=after]:shadow-[inset_-2px_0_0_var(--primary)] data-[column-shift=left]:-translate-x-1.5 data-[column-shift=right]:translate-x-1.5 motion-reduce:transition-none motion-reduce:transform-none"),
    } as Record<string, unknown>)
  })
}

function ratedPuzzleSkeletonCells(index?: number) {
  return [
    <div key="index" className="flex justify-end" role="cell">{index == null ? <Skeleton className="h-3 w-5" /> : <span className="font-mono text-[11px] text-muted-foreground">{rowLabel(index)}</span>}</div>,
    <div key="puzzle" className="space-y-2 pl-4" role="cell"><Skeleton className="h-4 w-24" /><Skeleton className="h-2.5 w-16" /></div>,
    <div key="rating" className="flex justify-end" role="cell"><Skeleton className="h-4 w-12" /></div>,
    <div key="rd" className="flex justify-end" role="cell"><Skeleton className="h-3 w-9" /></div>,
    <div key="themes" className="flex gap-2 pl-5" role="cell"><Skeleton className="h-5 w-20" /><Skeleton className="h-5 w-16" /></div>,
    <div key="plays" className="flex justify-end" role="cell"><Skeleton className="h-3 w-14" /></div>,
    <div key="popularity" className="flex justify-end" role="cell"><Skeleton className="h-3 w-10" /></div>,
    <div key="you" className="flex justify-center" role="cell"><Skeleton className="h-3 w-8" /></div>,
  ]
}

export function RatedPuzzleBrowser() {
  const { apiBase } = useData()
  const [searchParams, setSearchParams] = useSearchParams()
  const searchKey = searchParams.toString()
  const query = useMemo(() => ratedPuzzleQueryFromSearchParams(new URLSearchParams(searchKey)), [searchKey])
  const queryKey = useMemo(() => ratedPuzzleQueryParams(query).toString(), [query])
  const viewportRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<number | null>(null)
  const pendingScrollTopRef = useRef(0)
  const cacheRef = useRef(sessionRatedPages)
  const poolHashRef = useRef<string | null>(sessionRatedPoolHash)
  const controllersRef = useRef(new Map<number, AbortController>())
  const sortedCacheRef = useRef(sessionSortedPuzzles)
  const sortedCacheSourceRef = useRef<RatedPuzzleListItem[] | null>(sessionAllPuzzles)
  const [pages, setPages] = useState(() => new Map(sessionRatedPages))
  const [failedPages, setFailedPages] = useState(() => new Set<number>())
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(680)
  const [pageInput, setPageInput] = useState("1")
  const [draft, setDraft] = useState<FilterDraft>(() => filterDraft(query))
  const [filterError, setFilterError] = useState<string | null>(null)
  const { order: ratedColumnOrder, move: moveRatedColumn, drop: dropRatedColumn } = usePersistentColumnOrder("rated-puzzle-browser", RATED_COLUMN_WIDTHS.length)
  const [ratedDragState, setRatedDragState] = useState<GridColumnDragState | null>(null)
  const startRatedColumnDrag = useCallback((source: string) => setRatedDragState({ source, target: null, side: null }), [])
  const hoverRatedColumnDrop = useCallback((target: string, side: ColumnDropSide) => setRatedDragState((current) => !current ? current : current.source === target ? { ...current, target: null, side: null } : { ...current, target, side }), [])
  const endRatedColumnDrag = useCallback(() => setRatedDragState(null), [])
  const commitRatedColumnDrop = useCallback(() => {
    if (ratedDragState?.target && ratedDragState.side) dropRatedColumn(ratedDragState.source, ratedDragState.target, ratedDragState.side)
    setRatedDragState(null)
  }, [dropRatedColumn, ratedDragState])
  const pageMetadata = pages.get(1) ?? pages.values().next().value
  const pool = pageMetadata?.pool
  const transportTotalItems = pageMetadata?.pagination.total_items ?? pool?.items ?? 0
  const transportTotalPages = pageMetadata?.pagination.total_pages ?? (transportTotalItems ? Math.ceil(transportTotalItems / PAGE_SIZE) : 0)
  const canonicalQueryKey = ratedPuzzleQueryParams(DEFAULT_RATED_PUZZLE_QUERY).toString()
  const isCanonicalQuery = queryKey === canonicalQueryKey
  const allPuzzles = useMemo(() => {
    if (!transportTotalPages || pages.size < transportTotalPages) return null
    if (sessionAllPuzzles && sessionAllPuzzlesPoolHash === pool?.content_hash) return sessionAllPuzzles
    const items: RatedPuzzleListItem[] = []
    for (let page = 1; page <= transportTotalPages; page++) {
      const chunk = pages.get(page)
      if (!chunk) return null
      items.push(...chunk.puzzles)
    }
    sessionAllPuzzles = items
    sessionAllPuzzlesPoolHash = pool?.content_hash ?? null
    return items
  }, [pages, pool?.content_hash, transportTotalPages])
  const localPuzzles = useMemo(() => {
    if (!allPuzzles) return null
    if (sortedCacheSourceRef.current !== allPuzzles) {
      sortedCacheSourceRef.current = allPuzzles
      sortedCacheRef.current.clear()
    }
    const sortKey = `${query.sort}:${query.direction}`
    let sorted = sortedCacheRef.current.get(sortKey)
    if (!sorted) {
      if (query.sort === "rating" && query.direction === "asc") sorted = allPuzzles
      else {
        const multiplier = query.direction === "asc" ? 1 : -1
        sorted = allPuzzles.toSorted((a, b) => compareRatedPuzzles(a, b, query.sort) * multiplier)
      }
      sortedCacheRef.current.set(sortKey, sorted)
    }
    if (!hasFilters(query)) return sorted
    return sorted.filter((puzzle) =>
      (!query.tier || puzzle.categories?.tier?.includes(query.tier)) &&
      (!query.theme || puzzle.themes.includes(query.theme)) &&
      (!query.id_prefix || puzzle.puzzle_id.toLocaleLowerCase().startsWith(query.id_prefix.toLocaleLowerCase())) &&
      (query.min_rating == null || puzzle.rating >= query.min_rating) &&
      (query.max_rating == null || puzzle.rating <= query.max_rating),
    )
  }, [allPuzzles, query])
  const waitingForLocalView = !isCanonicalQuery && !localPuzzles
  const totalItems = localPuzzles?.length ?? (isCanonicalQuery ? transportTotalItems : 0)
  const totalPages = totalItems ? Math.ceil(totalItems / PAGE_SIZE) : 0
  const currentPage = totalPages
    ? Math.min(totalPages, pageForIndex(Math.max(0, Math.floor((scrollTop - HEADER_HEIGHT) / ROW_HEIGHT))))
    : 1

  const replaceCache = useCallback((next: Map<number, RatedPuzzlePage>) => {
    cacheRef.current = next
    sessionRatedPages = next
    setPages(next)
  }, [])

  const loadPage = useCallback((page: number) => {
    if (!apiBase || page < 1 || cacheRef.current.has(page) || controllersRef.current.has(page)) return
    const controller = new AbortController()
    controllersRef.current.set(page, controller)
    setFailedPages((current) => {
      if (!current.has(page)) return current
      const next = new Set(current)
      next.delete(page)
      return next
    })

    void loadRatedPuzzlePage(apiBase, page, PAGE_SIZE, controller.signal, DEFAULT_RATED_PUZZLE_QUERY, page === 1).then((result) => {
      const poolChanged = poolHashRef.current != null && poolHashRef.current !== result.pool.content_hash
      poolHashRef.current = result.pool.content_hash
      sessionRatedPoolHash = result.pool.content_hash
      if (poolChanged) {
        sessionAllPuzzles = null
        sessionAllPuzzlesPoolHash = null
        sessionSortedPuzzles.clear()
      }
      const next = poolChanged ? new Map<number, RatedPuzzlePage>() : new Map(cacheRef.current)
      next.delete(page)
      next.set(page, result)
      replaceCache(next)
      if (poolChanged) {
        viewportRef.current?.scrollTo({ top: 0 })
        if (page !== 1) loadPage(1)
      }
    }).catch((reason: unknown) => {
      if (reason instanceof DOMException && reason.name === "AbortError") return
      setFailedPages((current) => new Set(current).add(page))
    }).finally(() => {
      if (controllersRef.current.get(page) !== controller) return
      controllersRef.current.delete(page)
    })
  }, [apiBase, replaceCache])

  useEffect(() => {
    setFailedPages(new Set())
    viewportRef.current?.scrollTo({ top: 0 })
    setScrollTop(0)
    if (apiBase) loadPage(1)
  }, [apiBase, loadPage])

  useEffect(() => () => {
    if (frameRef.current != null) cancelAnimationFrame(frameRef.current)
    for (const controller of controllersRef.current.values()) controller.abort()
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const observer = new ResizeObserver(([entry]) => setViewportHeight(entry.contentRect.height))
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  const firstIndex = totalItems && !waitingForLocalView
    ? Math.max(0, Math.floor(Math.max(0, scrollTop - HEADER_HEIGHT) / ROW_HEIGHT) - OVERSCAN_ROWS)
    : 0
  const lastIndex = totalItems && !waitingForLocalView
    ? Math.min(totalItems - 1, Math.ceil((Math.max(0, scrollTop - HEADER_HEIGHT) + viewportHeight) / ROW_HEIGHT) + OVERSCAN_ROWS)
    : -1

  useEffect(() => {
    if (!transportTotalPages) return
    for (let page = 2; page <= transportTotalPages; page++) loadPage(page)
  }, [loadPage, transportTotalPages])

  useEffect(() => {
    setPageInput(String(currentPage))
  }, [currentPage])

  useEffect(() => {
    setDraft(filterDraft(query))
    setFilterError(null)
  }, [queryKey, query])

  const visibleIndices = useMemo(() => lastIndex < firstIndex
    ? []
    : Array.from({ length: lastIndex - firstIndex + 1 }, (_, offset) => firstIndex + offset),
  [firstIndex, lastIndex])
  const store = humanStore()

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    pendingScrollTopRef.current = event.currentTarget.scrollTop
    if (frameRef.current != null) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      setScrollTop(pendingScrollTopRef.current)
    })
  }

  const jumpToPage = (page: number) => {
    if (!totalPages) return
    const target = Math.max(1, Math.min(totalPages, page))
    loadPage(target)
    viewportRef.current?.scrollTo({
      top: HEADER_HEIGHT + (target - 1) * PAGE_SIZE * ROW_HEIGHT,
      behavior: "auto",
    })
  }

  const submitPage = (event: FormEvent) => {
    event.preventDefault()
    jumpToPage(Number(pageInput))
  }

  const changeQuery = useCallback((next: RatedPuzzleQuery) => {
    viewportRef.current?.scrollTo({ top: 0 })
    setScrollTop(0)
    const nextParams = new URLSearchParams(searchParams)
    QUERY_PARAM_KEYS.forEach((key) => nextParams.delete(key))
    ratedPuzzleQueryParams(next).forEach((value, key) => nextParams.set(key, value))
    nextParams.set("view", "rated")
    setSearchParams(nextParams, { replace: true })
  }, [searchParams, setSearchParams])

  const submitFilters = (event: FormEvent) => {
    event.preventDefault()
    const minRating = draft.minRating === "" ? undefined : Number(draft.minRating)
    const maxRating = draft.maxRating === "" ? undefined : Number(draft.maxRating)
    if (minRating != null && maxRating != null && minRating > maxRating) {
      setFilterError("Minimum rating cannot exceed maximum rating.")
      return
    }
    setFilterError(null)
    changeQuery({
      ...query,
      tier: draft.tier === "all" ? undefined : draft.tier as RatedPuzzleQuery["tier"],
      theme: draft.theme.trim() || undefined,
      id_prefix: draft.idPrefix.trim() || undefined,
      min_rating: minRating,
      max_rating: maxRating,
    })
  }

  const clearFilters = () => changeQuery({ sort: query.sort, direction: query.direction })

  const toggleSort = (sort: RatedPuzzleSort) => {
    const direction: RatedPuzzleDirection = query.sort === sort
      ? query.direction === "asc" ? "desc" : "asc"
      : sort === "plays" || sort === "popularity" ? "desc" : "asc"
    changeQuery({ ...query, sort, direction })
  }
  const ratedGridTemplate = ratedColumnOrder.map((key) => RATED_COLUMN_WIDTHS[Number(key)]).join(" ")
  const ariaSortFor = (sort: RatedPuzzleSort) => query.sort === sort ? query.direction === "asc" ? "ascending" as const : "descending" as const : "none" as const
  const ratedHeaderDragProps = { order: ratedColumnOrder, move: moveRatedColumn, dragState: ratedDragState, onDragStartColumn: startRatedColumnDrag, onDragOverColumn: hoverRatedColumnDrop, onDropColumn: commitRatedColumnDrop, onDragEndColumn: endRatedColumnDrag }
  const headerCells = [
    <ReorderableGridHeader key="index" columnKey="0" {...ratedHeaderDragProps} className="text-right">#</ReorderableGridHeader>,
    <ReorderableGridHeader key="puzzle" columnKey="1" {...ratedHeaderDragProps} className="pl-4" ariaSort={ariaSortFor("puzzle_id")}><RatedSortHeader label="Puzzle" value="puzzle_id" query={query} onSort={toggleSort} /></ReorderableGridHeader>,
    <ReorderableGridHeader key="rating" columnKey="2" {...ratedHeaderDragProps} className="flex justify-end" ariaSort={ariaSortFor("rating")}><RatedSortHeader label="Rating" value="rating" query={query} onSort={toggleSort} /></ReorderableGridHeader>,
    <ReorderableGridHeader key="rd" columnKey="3" {...ratedHeaderDragProps} className="flex justify-end" ariaSort={ariaSortFor("rating_deviation")}><RatedSortHeader label="RD" value="rating_deviation" query={query} onSort={toggleSort} /></ReorderableGridHeader>,
    <ReorderableGridHeader key="themes" columnKey="4" {...ratedHeaderDragProps} className="pl-5">Themes</ReorderableGridHeader>,
    <ReorderableGridHeader key="plays" columnKey="5" {...ratedHeaderDragProps} className="flex justify-end" ariaSort={ariaSortFor("plays")}><RatedSortHeader label="Lichess plays" value="plays" query={query} onSort={toggleSort} /></ReorderableGridHeader>,
    <ReorderableGridHeader key="popularity" columnKey="6" {...ratedHeaderDragProps} className="flex justify-end" ariaSort={ariaSortFor("popularity")}><RatedSortHeader label="Popularity" value="popularity" query={query} onSort={toggleSort} /></ReorderableGridHeader>,
    <ReorderableGridHeader key="you" columnKey="7" {...ratedHeaderDragProps} className="text-center">You</ReorderableGridHeader>,
  ]

  if (!apiBase) return <Card className="border-dashed"><CardContent className="py-16 text-center"><Database className="mx-auto size-8 text-muted-foreground" /><h1 className="mt-4 text-xl font-semibold">Rated pool unavailable offline</h1><p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">The full rated pool is available through the live ChessBench API and is not bundled into the static site.</p></CardContent></Card>

  if (!pool && failedPages.has(1)) return <Card className="border-destructive/30"><CardContent className="py-16 text-center"><h1 className="text-xl font-semibold text-destructive">Could not load the rated puzzle pool</h1><p className="mt-2 text-sm text-muted-foreground">The puzzle page request failed before pool metadata was available.</p><Button variant="outline" className="mt-5" onClick={() => loadPage(1)}><RotateCcw /> Try again</Button></CardContent></Card>

  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-5 border-b border-border/70 pb-6">
      <div>
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300"><Gauge className="size-4" /> Adaptive rating pool</div>
        <h1 className="text-3xl font-bold tracking-tight">Rated puzzle browser</h1>
        <p className="mt-1 max-w-3xl text-muted-foreground">Sort and filter the complete calibrated pool. The Worker returns large pages while the browser renders only the rows near the viewport.</p>
      </div>
      <PuzzleNav count={localPuzzles ? totalItems : transportTotalItems || undefined} leaderboardTo="/puzzles" browserTo={ratedBrowserHref(query)} />
    </div>

    <form className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3" onSubmit={submitFilters}>
      <label className="grid gap-1 text-[11px] font-medium text-muted-foreground"><span>Puzzle ID starts with</span><Input value={draft.idPrefix} onChange={(event) => { setDraft((current) => ({ ...current, idPrefix: event.target.value })); setFilterError(null) }} pattern="[A-Za-z0-9_-]*" placeholder="e.g. 00a" className="h-9 w-40 bg-background font-mono" /></label>
      <label className="grid gap-1 text-[11px] font-medium text-muted-foreground"><span>Theme</span><Input value={draft.theme} onChange={(event) => { setDraft((current) => ({ ...current, theme: event.target.value })); setFilterError(null) }} pattern="[A-Za-z0-9_-]*" placeholder="e.g. fork" className="h-9 w-40 bg-background" /></label>
      <label className="grid gap-1 text-[11px] font-medium text-muted-foreground"><span>Tier</span><Select value={draft.tier} onValueChange={(tier) => setDraft((current) => ({ ...current, tier }))}><SelectTrigger className="h-9 w-40 bg-background capitalize"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All tiers</SelectItem>{RATED_PUZZLE_TIERS.map((tier) => <SelectItem key={tier} value={tier} className="capitalize">{tier}</SelectItem>)}</SelectContent></Select></label>
      <label className="grid gap-1 text-[11px] font-medium text-muted-foreground"><span>Min rating</span><Input type="number" min={0} max={4000} value={draft.minRating} onChange={(event) => { setDraft((current) => ({ ...current, minRating: event.target.value })); setFilterError(null) }} placeholder="0" className="h-9 w-28 bg-background font-mono" /></label>
      <label className="grid gap-1 text-[11px] font-medium text-muted-foreground"><span>Max rating</span><Input type="number" min={0} max={4000} value={draft.maxRating} onChange={(event) => { setDraft((current) => ({ ...current, maxRating: event.target.value })); setFilterError(null) }} placeholder="4000" className="h-9 w-28 bg-background font-mono" /></label>
      <Button type="submit" size="sm" className="h-9">Apply filters</Button>
      {hasFilters(query) ? <Button type="button" variant="ghost" size="sm" className="h-9" onClick={clearFilters}>Clear</Button> : null}
      {filterError ? <p className="w-full text-xs text-destructive">{filterError}</p> : null}
    </form>

    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b bg-muted/15 px-4 py-3">
        <div className="min-w-0">
          {pool ? <><div className="font-medium">{pool.name} · v{pool.version}</div><div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{pool.content_hash.replace("sha256:", "")}</div></> : <div className="space-y-2" aria-label="Loading active rated pool"><Skeleton className="h-4 w-56" /><Skeleton className="h-2.5 w-36" /></div>}
        </div>
        {pool ? hasFilters(query) && !localPuzzles ? <Skeleton className="h-5 w-20" /> : <Badge variant="secondary" className="tabular-nums">{hasFilters(query) ? `${totalItems.toLocaleString()} matches` : `${pool.items.toLocaleString()} puzzles`}</Badge> : <Skeleton className="h-5 w-20" />}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="icon-sm" disabled={currentPage <= 1} onClick={() => jumpToPage(currentPage - 1)} aria-label="Previous page"><ChevronLeft /></Button>
          <form className="flex items-center gap-2 text-xs text-muted-foreground" onSubmit={submitPage}>
            <span>Page</span>
            <Input aria-label="Page number" type="number" min={1} max={totalPages || 1} value={pageInput} onChange={(event) => setPageInput(event.target.value)} className="h-8 w-20 bg-background text-center font-mono" />
            <Button type="submit" variant="secondary" size="sm" className="h-8 px-2.5">Go</Button>
            <span>of {totalPages.toLocaleString()}</span>
          </form>
          <Button variant="outline" size="icon-sm" disabled={!totalPages || currentPage >= totalPages} onClick={() => jumpToPage(currentPage + 1)} aria-label="Next page"><ChevronRight /></Button>
        </div>
      </div>

      <div ref={viewportRef} onScroll={onScroll} className="h-[min(70vh,760px)] min-h-[420px] overflow-auto" aria-label="Rated puzzle pool">
        <div className="relative min-w-[1080px]" style={{ height: totalItems ? HEADER_HEIGHT + totalItems * ROW_HEIGHT : 420 }} role="table" aria-rowcount={pageMetadata ? totalItems + 1 : undefined}>
          <div className="sticky top-0 z-20 grid h-11 items-center border-b bg-card/95 px-3 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur" style={{ gridTemplateColumns: ratedGridTemplate }} role="row">{orderedCells(ratedColumnOrder, headerCells)}</div>
          {visibleIndices.map((index) => {
            const pageNumber = pageForIndex(index)
            const page = pages.get(pageNumber)
            const puzzle = localPuzzles?.[index] ?? (isCanonicalQuery ? page?.puzzles[index % PAGE_SIZE] : undefined)
            const failed = failedPages.has(pageNumber)
            const cells = puzzle ? [
              <div key="index" className="text-right font-mono text-[11px] text-muted-foreground" role="cell">{rowLabel(index)}</div>,
              <div key="puzzle" className="min-w-0 pl-4" role="cell"><Link to={ratedPuzzleHref(puzzle.puzzle_id, index, query)} className="font-mono font-medium hover:underline">{puzzle.puzzle_id}</Link><div className="mt-1 truncate text-[10px] capitalize text-muted-foreground">{puzzle.categories?.tier?.[0] ?? "calibrated"}</div></div>,
              <div key="rating" className="text-right font-mono font-semibold tabular-nums" role="cell">{puzzle.rating.toLocaleString()}</div>,
              <div key="rd" className="text-right font-mono text-xs tabular-nums text-muted-foreground" role="cell">±{formatRatingDeviation(puzzle.rating_deviation)}</div>,
              <div key="themes" className="flex min-w-0 gap-1 overflow-hidden pl-5" role="cell">{(puzzle.themes ?? []).slice(0, 4).map((theme) => <Badge key={theme} variant="outline" className="shrink-0 text-[10px] font-normal">{theme}</Badge>)}</div>,
              <div key="plays" className="text-right font-mono text-xs tabular-nums text-muted-foreground" role="cell">{(puzzle.plays ?? 0).toLocaleString()}</div>,
              <div key="popularity" className="text-right font-mono text-xs tabular-nums text-muted-foreground" role="cell">{puzzle.popularity ?? "—"}</div>,
              <div key="you" className="text-center text-xs text-muted-foreground" role="cell">{store[puzzle.puzzle_id]?.solved ? "solved" : store[puzzle.puzzle_id] ? "retry" : "—"}</div>,
            ] : ratedPuzzleSkeletonCells(index)
            return <div key={index} className="absolute left-0 grid w-full items-center border-b px-3 text-sm" style={{ height: ROW_HEIGHT, transform: `translateY(${HEADER_HEIGHT + index * ROW_HEIGHT}px)`, gridTemplateColumns: ratedGridTemplate }} role="row" aria-rowindex={index + 2}>{failed ? <div className="col-span-full pl-4" role="cell"><button type="button" className="text-xs text-destructive underline underline-offset-4" onClick={() => loadPage(pageNumber)}>Page failed · retry</button></div> : orderedCells(ratedColumnOrder, cells, ratedDragState)}</div>
          })}
          {(!pageMetadata || waitingForLocalView) && !failedPages.size ? INITIAL_SKELETON_ROWS.map((index) => <div key={index} className="absolute left-0 grid w-full items-center border-b px-3" style={{ height: ROW_HEIGHT, transform: `translateY(${HEADER_HEIGHT + index * ROW_HEIGHT}px)`, gridTemplateColumns: ratedGridTemplate }} role="row" aria-hidden="true">{orderedCells(ratedColumnOrder, ratedPuzzleSkeletonCells(), ratedDragState)}</div>) : null}
          {waitingForLocalView && failedPages.size ? <div className="absolute inset-x-0 top-11 grid h-[376px] place-items-center text-center"><div><div className="font-medium text-destructive">Some puzzle pages could not be loaded</div><Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => failedPages.forEach(loadPage)}>Retry</Button></div></div> : null}
          {pageMetadata && localPuzzles && !totalItems ? <div className="absolute inset-x-0 top-11 grid h-[376px] place-items-center text-center"><div><div className="font-medium">No puzzles match those filters</div><Button type="button" variant="ghost" size="sm" className="mt-2" onClick={clearFilters}>Clear filters</Button></div></div> : null}
        </div>
      </div>
    </Card>
  </div>
}
