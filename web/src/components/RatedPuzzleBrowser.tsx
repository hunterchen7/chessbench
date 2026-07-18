import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type UIEvent } from "react"
import { Link } from "react-router-dom"
import { ChevronLeft, ChevronRight, Database, Gauge, LoaderCircle, RotateCcw } from "lucide-react"
import { loadRatedPuzzlePage, type RatedPuzzlePage } from "@/lib/data"
import { humanStore } from "@/lib/human"
import { useData } from "@/lib/useData"
import { PuzzleNav } from "@/components/PuzzleNav"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

const PAGE_SIZE = 200
const ROW_HEIGHT = 68
const HEADER_HEIGHT = 44
const OVERSCAN_ROWS = 8
const MAX_CACHED_PAGES = 9

function pageForIndex(index: number) {
  return Math.floor(index / PAGE_SIZE) + 1
}

function rowLabel(index: number) {
  return (index + 1).toLocaleString()
}

export function RatedPuzzleBrowser() {
  const { apiBase } = useData()
  const viewportRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<number | null>(null)
  const pendingScrollTopRef = useRef(0)
  const cacheRef = useRef(new Map<number, RatedPuzzlePage>())
  const poolHashRef = useRef<string | null>(null)
  const controllersRef = useRef(new Map<number, AbortController>())
  const centerPageRef = useRef(1)
  const [pages, setPages] = useState(() => new Map<number, RatedPuzzlePage>())
  const [loadingPages, setLoadingPages] = useState(() => new Set<number>())
  const [failedPages, setFailedPages] = useState(() => new Set<number>())
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(680)
  const [pageInput, setPageInput] = useState("1")
  const pool = pages.get(1)?.pool ?? pages.values().next().value?.pool
  const totalItems = pool?.items ?? 0
  const totalPages = totalItems ? Math.ceil(totalItems / PAGE_SIZE) : 0
  const currentPage = totalPages
    ? Math.min(totalPages, pageForIndex(Math.max(0, Math.floor((scrollTop - HEADER_HEIGHT) / ROW_HEIGHT))))
    : 1
  centerPageRef.current = currentPage

  const replaceCache = useCallback((next: Map<number, RatedPuzzlePage>) => {
    cacheRef.current = next
    setPages(next)
  }, [])

  const loadPage = useCallback((page: number) => {
    if (!apiBase || page < 1 || cacheRef.current.has(page) || controllersRef.current.has(page)) return
    const controller = new AbortController()
    controllersRef.current.set(page, controller)
    setLoadingPages((current) => new Set(current).add(page))
    setFailedPages((current) => {
      if (!current.has(page)) return current
      const next = new Set(current)
      next.delete(page)
      return next
    })

    void loadRatedPuzzlePage(apiBase, page, PAGE_SIZE, controller.signal).then((result) => {
      const poolChanged = poolHashRef.current != null && poolHashRef.current !== result.pool.content_hash
      poolHashRef.current = result.pool.content_hash
      const next = poolChanged ? new Map<number, RatedPuzzlePage>() : new Map(cacheRef.current)
      next.delete(page)
      next.set(page, result)
      while (next.size > MAX_CACHED_PAGES) {
        const removable = [...next.keys()]
          .filter((candidate) => candidate !== page)
          .toSorted((a, b) => Math.abs(b - centerPageRef.current) - Math.abs(a - centerPageRef.current))[0]
        if (removable == null) break
        next.delete(removable)
      }
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
      setLoadingPages((current) => {
        const next = new Set(current)
        next.delete(page)
        return next
      })
    })
  }, [apiBase, replaceCache])

  useEffect(() => {
    replaceCache(new Map())
    poolHashRef.current = null
    setFailedPages(new Set())
    setLoadingPages(new Set())
    for (const controller of controllersRef.current.values()) controller.abort()
    controllersRef.current.clear()
    if (apiBase) loadPage(1)
  }, [apiBase, loadPage, replaceCache])

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

  const firstIndex = totalItems
    ? Math.max(0, Math.floor(Math.max(0, scrollTop - HEADER_HEIGHT) / ROW_HEIGHT) - OVERSCAN_ROWS)
    : 0
  const lastIndex = totalItems
    ? Math.min(totalItems - 1, Math.ceil((Math.max(0, scrollTop - HEADER_HEIGHT) + viewportHeight) / ROW_HEIGHT) + OVERSCAN_ROWS)
    : -1

  useEffect(() => {
    if (!totalItems || lastIndex < firstIndex) return
    const firstPage = pageForIndex(firstIndex)
    const lastPage = pageForIndex(lastIndex)
    const wanted = new Set<number>()
    for (let page = Math.max(1, firstPage - 1); page <= Math.min(totalPages, lastPage + 1); page++) wanted.add(page)
    const canceled = new Set<number>()
    for (const [page, controller] of controllersRef.current) {
      if (!wanted.has(page)) {
        controller.abort()
        controllersRef.current.delete(page)
        canceled.add(page)
      }
    }
    if (canceled.size) setLoadingPages((current) => new Set([...current].filter((page) => !canceled.has(page))))
    wanted.forEach(loadPage)
  }, [firstIndex, lastIndex, loadPage, totalItems, totalPages])

  useEffect(() => {
    setPageInput(String(currentPage))
  }, [currentPage])

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

  if (!apiBase) return <Card className="border-dashed"><CardContent className="py-16 text-center"><Database className="mx-auto size-8 text-muted-foreground" /><h1 className="mt-4 text-xl font-semibold">Rated pool unavailable offline</h1><p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">The 100,000-puzzle pool lives in D1 and is intentionally not bundled into the static site. Connect the ChessBench API to browse it.</p></CardContent></Card>

  if (!pool && failedPages.has(1)) return <Card className="border-destructive/30"><CardContent className="py-16 text-center"><h1 className="text-xl font-semibold text-destructive">Could not load the rated puzzle pool</h1><p className="mt-2 text-sm text-muted-foreground">The D1 page request failed before pool metadata was available.</p><Button variant="outline" className="mt-5" onClick={() => loadPage(1)}><RotateCcw /> Try again</Button></CardContent></Card>

  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-5 border-b border-border/70 pb-6">
      <div>
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300"><Gauge className="size-4" /> Adaptive rating pool</div>
        <h1 className="text-3xl font-bold tracking-tight">Rated puzzle browser</h1>
        <p className="mt-1 max-w-3xl text-muted-foreground">Move through the complete calibrated pool in rating order. Rows are fetched from D1 in pages and rendered only when they approach the viewport.</p>
      </div>
      <PuzzleNav count={totalItems || undefined} leaderboardTo="/puzzles" browserTo="/puzzles/browse?view=rated" />
    </div>

    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b bg-muted/15 px-4 py-3">
        <div className="min-w-0">
          <div className="font-medium">{pool ? `${pool.name} · v${pool.version}` : "Loading active pool…"}</div>
          <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{pool?.content_hash.replace("sha256:", "") ?? "Reading pool identity from D1"}</div>
        </div>
        {pool ? <Badge variant="secondary" className="tabular-nums">{totalItems.toLocaleString()} puzzles</Badge> : <LoaderCircle className="size-4 animate-spin text-muted-foreground" />}
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
        <div className="relative min-w-[980px]" style={{ height: totalItems ? HEADER_HEIGHT + totalItems * ROW_HEIGHT : 420 }} role="table" aria-rowcount={totalItems + 1}>
          <div className="sticky top-0 z-20 grid h-11 grid-cols-[72px_minmax(160px,1fr)_100px_90px_minmax(250px,1.5fr)_110px_90px] items-center border-b bg-card/95 px-3 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur" role="row">
            <div className="text-right" role="columnheader">#</div><div className="pl-4" role="columnheader">Puzzle</div><div className="text-right" role="columnheader">Rating</div><div className="text-right" role="columnheader">RD</div><div className="pl-5" role="columnheader">Themes</div><div className="text-right" role="columnheader">Lichess plays</div><div className="text-center" role="columnheader">You</div>
          </div>
          {visibleIndices.map((index) => {
            const pageNumber = pageForIndex(index)
            const page = pages.get(pageNumber)
            const puzzle = page?.puzzles[index % PAGE_SIZE]
            const failed = failedPages.has(pageNumber)
            return <div key={index} className="absolute left-0 grid w-full grid-cols-[72px_minmax(160px,1fr)_100px_90px_minmax(250px,1.5fr)_110px_90px] items-center border-b px-3 text-sm" style={{ height: ROW_HEIGHT, transform: `translateY(${HEADER_HEIGHT + index * ROW_HEIGHT}px)` }} role="row" aria-rowindex={index + 2}>
              <div className="text-right font-mono text-[11px] text-muted-foreground" role="cell">{rowLabel(index)}</div>
              {puzzle ? <>
                <div className="min-w-0 pl-4" role="cell"><Link to={`/puzzles/${encodeURIComponent(puzzle.puzzle_id)}?source=rated&index=${index}`} className="font-mono font-medium hover:underline">{puzzle.puzzle_id}</Link><div className="mt-1 truncate text-[10px] capitalize text-muted-foreground">{puzzle.categories.tier?.[0] ?? "calibrated"}</div></div>
                <div className="text-right font-mono font-semibold tabular-nums" role="cell">{puzzle.rating.toLocaleString()}</div>
                <div className="text-right font-mono text-xs tabular-nums text-muted-foreground" role="cell">±{puzzle.rating_deviation ?? "—"}</div>
                <div className="flex min-w-0 gap-1 overflow-hidden pl-5" role="cell">{puzzle.themes.slice(0, 4).map((theme) => <Badge key={theme} variant="outline" className="shrink-0 text-[10px] font-normal">{theme}</Badge>)}</div>
                <div className="text-right font-mono text-xs tabular-nums text-muted-foreground" role="cell">{(puzzle.plays ?? 0).toLocaleString()}</div>
                <div className="text-center text-xs text-muted-foreground" role="cell">{store[puzzle.puzzle_id]?.solved ? "solved" : store[puzzle.puzzle_id] ? "retry" : "—"}</div>
              </> : <div className="col-span-6 pl-4" role="cell">{failed ? <button type="button" className="text-xs text-destructive underline underline-offset-4" onClick={() => loadPage(pageNumber)}>Page failed · retry</button> : <div className="h-4 w-2/3 max-w-xl animate-pulse rounded bg-muted" />}</div>}
            </div>
          })}
          {!totalItems ? <div className="absolute inset-x-0 top-11 grid h-[376px] place-items-center text-sm text-muted-foreground"><span className="inline-flex items-center gap-2"><LoaderCircle className="size-4 animate-spin" /> Loading page 1 from D1…</span></div> : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/10 px-4 py-2 text-[11px] text-muted-foreground"><span>{PAGE_SIZE} rows per API page · {pages.size} cached{loadingPages.size ? ` · ${loadingPages.size} loading` : ""} · {MAX_CACHED_PAGES} page cache limit</span><span className="tabular-nums">Viewing rows {totalItems ? `${rowLabel(firstIndex)}–${rowLabel(lastIndex)}` : "—"} · page {currentPage.toLocaleString()}</span></div>
    </Card>
  </div>
}
