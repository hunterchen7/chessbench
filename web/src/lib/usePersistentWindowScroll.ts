import { useEffect, useRef } from "react"

function savedScrollTop(key: string) {
  try {
    const saved = localStorage.getItem(key)
    if (saved == null) return null
    const value = Number(saved)
    return Number.isFinite(value) && value >= 0 ? value : null
  } catch {
    return null
  }
}

function saveScrollTop(key: string, value: number) {
  try {
    localStorage.setItem(key, String(Math.max(0, Math.round(value))))
  } catch {
    // Private browsing or storage policy can make persistence unavailable.
  }
}

export function usePersistentWindowScroll(key: string, ready: boolean) {
  const restoredKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!ready || restoredKeyRef.current === key) return
    const target = savedScrollTop(key)
    if (target == null) {
      restoredKeyRef.current = key
      return
    }

    const previousRestoration = window.history.scrollRestoration
    window.history.scrollRestoration = "manual"
    const startedAt = performance.now()
    let frame = 0
    let observer: ResizeObserver | null = null

    const restore = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const maximum = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
        window.scrollTo({ top: Math.min(target, maximum), behavior: "auto" })
        if (maximum >= target || performance.now() - startedAt > 5_000) {
          restoredKeyRef.current = key
          observer?.disconnect()
          observer = null
        }
      })
    }

    observer = new ResizeObserver(restore)
    observer.observe(document.documentElement)
    restore()
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      window.history.scrollRestoration = previousRestoration
    }
  }, [key, ready])

  useEffect(() => {
    let frame = 0
    const persist = () => {
      if (restoredKeyRef.current !== key) return
      saveScrollTop(key, window.scrollY)
    }
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(persist)
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("pagehide", persist)
    return () => {
      cancelAnimationFrame(frame)
      persist()
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("pagehide", persist)
    }
  }, [key])
}
