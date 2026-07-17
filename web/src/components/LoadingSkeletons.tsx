import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return <div className="divide-y">
    {Array.from({ length: rows }, (_, index) => <div key={index} className="grid grid-cols-[minmax(10rem,1fr)_6rem_6rem] items-center gap-4 px-5 py-4">
      <div className="space-y-2"><Skeleton className="h-3.5 w-2/5" /><Skeleton className="h-2.5 w-3/5" /></div>
      <Skeleton className="ml-auto h-4 w-16" />
      <Skeleton className="ml-auto h-4 w-14" />
    </div>)}
  </div>
}

export function DashboardLoadingSkeleton({ label = "Loading dashboard" }: { label?: string }) {
  return <div className="space-y-8" aria-label={label} aria-busy="true">
    <section className="grid gap-6 border-b pb-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-4"><Skeleton className="h-3 w-32" /><Skeleton className="h-12 w-[min(34rem,85%)]" /><Skeleton className="h-4 w-[min(44rem,95%)]" /><Skeleton className="h-4 w-[min(36rem,75%)]" /></div>
      <div className="grid content-end gap-3"><Skeleton className="h-9 w-full" /><div className="flex gap-2"><Skeleton className="h-10 flex-1" /><Skeleton className="h-10 flex-1" /></div></div>
    </section>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }, (_, index) => <Card key={index}><CardContent className="flex items-center gap-4 py-7"><Skeleton className="size-9 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-6 w-20" /><Skeleton className="h-3 w-28" /></div></CardContent></Card>)}
    </section>
    <Card><CardHeader className="space-y-3 border-b"><Skeleton className="h-5 w-44" /><Skeleton className="h-3 w-2/3" /></CardHeader><SkeletonRows /></Card>
  </div>
}

export function AppLoadingSkeleton() {
  return <div className="min-h-screen bg-background" aria-label="Loading ChessBench" aria-busy="true">
    <div className="border-b"><div className="mx-auto flex min-h-16 max-w-[1480px] items-center gap-4 px-4 lg:px-8"><Skeleton className="size-8 rounded-lg" /><Skeleton className="h-5 w-28" /><div className="ml-8 hidden gap-2 md:flex">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-8 w-20" />)}</div><Skeleton className="ml-auto h-9 w-24" /></div></div>
    <main className="mx-auto max-w-[1480px] px-4 py-8 lg:px-8 lg:py-10"><DashboardLoadingSkeleton /></main>
  </div>
}

export function PerformanceHistorySkeleton({ adaptive = false }: { adaptive?: boolean }) {
  return <Card aria-label={`Loading ${adaptive ? "adaptive rating path" : "performance over suite"}`} aria-busy="true">
    <CardHeader className="gap-3 sm:flex sm:flex-row sm:items-end sm:justify-between">
      <div className="flex-1 space-y-2"><Skeleton className="h-5 w-44" /><Skeleton className="h-3 w-full max-w-3xl" /><Skeleton className="h-3 w-3/5 max-w-xl" /></div>
      <div className="flex gap-3"><Skeleton className="h-4 w-20" /><Skeleton className="h-4 w-24" /><Skeleton className="h-4 w-24" /></div>
    </CardHeader>
    <CardContent><div className="mb-3 flex justify-end gap-3"><Skeleton className="h-3 w-28" /><Skeleton className="h-3 w-12" /><Skeleton className="h-3 w-12" /><Skeleton className="h-3 w-12" /></div><Skeleton className="h-72 rounded-xl sm:h-80" /><div className="mt-2 flex justify-between"><Skeleton className="h-3 w-40" /><Skeleton className="h-3 w-56" /></div></CardContent>
  </Card>
}

export function RunDetailsSkeleton() {
  return <div className="grid min-w-0 gap-5 2xl:grid-cols-[360px_minmax(0,1fr)]" aria-label="Loading run details" aria-busy="true">
    <Card><CardHeader><Skeleton className="h-5 w-40" /></CardHeader><CardContent className="space-y-4">{Array.from({ length: 6 }, (_, index) => <div key={index} className="flex justify-between gap-4"><Skeleton className="h-4 w-24" /><Skeleton className="h-4 w-16" /></div>)}</CardContent></Card>
    <Card className="overflow-hidden"><CardHeader className="flex-row items-center justify-between"><div className="space-y-2"><Skeleton className="h-5 w-40" /><Skeleton className="h-3 w-72" /></div><Skeleton className="h-8 w-44" /></CardHeader><SkeletonRows rows={6} /></Card>
  </div>
}

export function BoardDetailSkeleton({ label = "Loading position" }: { label?: string }) {
  return <div className="space-y-6" aria-label={label} aria-busy="true">
    <div className="flex items-end justify-between gap-4 border-b pb-5"><div className="space-y-3"><Skeleton className="h-4 w-28" /><Skeleton className="h-8 w-72" /><Skeleton className="h-3 w-96 max-w-[80vw]" /></div><Skeleton className="h-9 w-32" /></div>
    <div className="grid gap-6 lg:grid-cols-[minmax(0,540px)_1fr]"><Skeleton className="aspect-square w-full rounded-xl" /><Card><CardHeader className="space-y-3"><Skeleton className="h-5 w-40" /><Skeleton className="h-3 w-3/4" /></CardHeader><CardContent className="space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /><Skeleton className="h-10 w-full" /></CardContent></Card></div>
  </div>
}

export function TablePageSkeleton({ label = "Loading results" }: { label?: string }) {
  return <div className="space-y-7" aria-label={label} aria-busy="true"><div className="space-y-3 border-b pb-7"><Skeleton className="h-10 w-64" /><Skeleton className="h-4 w-2/3" /></div><Card><CardHeader><Skeleton className="h-5 w-48" /></CardHeader><SkeletonRows rows={7} /></Card></div>
}
