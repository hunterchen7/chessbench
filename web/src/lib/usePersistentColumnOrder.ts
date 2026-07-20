import { useCallback, useEffect, useState } from "react"

export type ColumnDropSide = "before" | "after"

export function orderAfterColumnDrop(order: string[], source: string, target: string, side: ColumnDropSide) {
  if (source === target || !order.includes(source) || !order.includes(target)) return order
  const next = order.filter((key) => key !== source)
  const targetIndex = next.indexOf(target)
  next.splice(targetIndex + (side === "after" ? 1 : 0), 0, source)
  return next
}

function normalizedOrder(value: unknown, columnCount: number): string[] {
  const defaults = Array.from({ length: columnCount }, (_, index) => String(index))
  if (!Array.isArray(value)) return defaults
  const saved = value.map(String).filter((key) => defaults.includes(key))
  return [...new Set(saved), ...defaults.filter((key) => !saved.includes(key))]
}

export function usePersistentColumnOrder(reorderableKey: string | undefined, columnCount: number) {
  const [order, setOrder] = useState<string[]>(() => {
    if (!reorderableKey || typeof window === "undefined") return normalizedOrder(null, columnCount)
    try {
      return normalizedOrder(JSON.parse(localStorage.getItem(`chessbench.table-columns.${reorderableKey}.v1`) ?? "null"), columnCount)
    } catch {
      return normalizedOrder(null, columnCount)
    }
  })

  useEffect(() => {
    setOrder((current) => normalizedOrder(current, columnCount))
  }, [columnCount])

  useEffect(() => {
    if (!reorderableKey || !columnCount) return
    localStorage.setItem(`chessbench.table-columns.${reorderableKey}.v1`, JSON.stringify(order))
  }, [columnCount, order, reorderableKey])

  const move = useCallback((source: string, target: string) => {
    setOrder((current) => {
      const from = current.indexOf(source)
      const to = current.indexOf(target)
      if (from < 0 || to < 0 || from === to) return current
      const next = [...current]
      next.splice(to, 0, next.splice(from, 1)[0])
      return next
    })
  }, [])

  const drop = useCallback((source: string, target: string, side: ColumnDropSide) => {
    setOrder((current) => orderAfterColumnDrop(current, source, target, side))
  }, [])

  return { order, move, drop }
}
