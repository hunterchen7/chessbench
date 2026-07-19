import { useEffect, useMemo } from "react"
import { matchPath, useLocation } from "react-router-dom"
import type { RatedSessionProtocol, RunIndexEntry } from "@/lib/data"
import { modeInfo } from "@/lib/format"
import { reasoningLabel } from "@/lib/modelReasoning"
import { useData } from "@/lib/useData"

const APP_NAME = "ChessBench"

function decode(value: string | undefined) {
  if (!value) return ""
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function runTitle(run: RunIndexEntry) {
  const model = run.model_variant.display_name
  const reasoning = reasoningLabel(run.model_variant)
  const ratedProtocol = run.protocol?.kind === "adaptive_glicko2"
    ? run.protocol as RatedSessionProtocol
    : null
  if (ratedProtocol) {
    return `${model} · ${reasoning} · Seed ${ratedProtocol.selection.seed}`
  }
  const method = modeInfo(run.condition)?.name
  return [model, method, reasoning].filter(Boolean).join(" · ")
}

export function DocumentTitle() {
  const { pathname, search } = useLocation()
  const { runs, tournaments } = useData()
  const title = useMemo(() => {
    const params = new URLSearchParams(search)
    const modelMatch = matchPath("/model/:model", pathname)
    if (modelMatch) {
      const modelKey = decode(modelMatch.params.model)
      const modelRuns = runs
        .filter((run) => run.model_variant.key === modelKey)
        .toSorted((a, b) => b.created.localeCompare(a.created))
      const requestedRun = params.get("run")
      const run = modelRuns.find((candidate) => candidate.run_id === requestedRun) ?? modelRuns[0]
      const model = run?.model_variant.display_name ?? (modelKey || "Model")
      const subject = run ? runTitle(run) : model
      const answer = params.get("answer")
      return answer ? `Puzzle ${answer} · ${subject}` : subject
    }

    if (pathname === "/compare") {
      const selected = params.getAll("run").flatMap((id) => {
        const run = runs.find((candidate) => candidate.run_id === id)
        return run ? [run.model_variant.display_name] : []
      })
      const names = [...new Set(selected)]
      if (names.length === 2) return `${names[0]} vs ${names[1]}`
      if (selected.length === 1) return `Compare ${names[0]}`
      return selected.length > 1 ? `Compare ${selected.length} runs` : "Compare model runs"
    }

    if (pathname === "/puzzles") return params.get("view") === "fixed" ? "Fixed puzzle leaderboard" : "Adaptive puzzle leaderboard"
    if (pathname === "/puzzles/browse") return "Puzzle pool"
    if (pathname === "/puzzles/play") {
      const seed = params.get("seed")
      return seed == null ? "Play a seeded run" : `Play seed ${seed}`
    }

    const puzzleMatch = matchPath("/puzzles/:id", pathname)
    if (puzzleMatch) {
      const id = decode(puzzleMatch.params.id)
      const seed = params.get("source") === "train" ? params.get("seed") : null
      return seed == null ? `Puzzle ${id}` : `Puzzle ${id} · Seed ${seed}`
    }

    if (pathname === "/games") return "Stateful games"
    const gameMatch = matchPath("/games/:file/:game", pathname)
    const tournamentMatch = gameMatch ?? matchPath("/games/:file", pathname)
    if (tournamentMatch) {
      const file = decode(tournamentMatch.params.file)
      const tournament = tournaments.find((candidate) => candidate.file === file)
      const matchName = (tournament?.file ?? file).replace(/\.json$/, "")
      return gameMatch ? `${matchName} · Game ${gameMatch.params.game}` : matchName
    }

    if (pathname === "/esoteric") return "Esoteric chess"
    const esotericMatch = matchPath("/esoteric/:id", pathname)
    if (esotericMatch) return `Esoteric problem ${decode(esotericMatch.params.id)}`
    if (pathname === "/methodology") return "Methodology"
    if (pathname === "/") return "Leaderboard"
    return "Page not found"
  }, [pathname, search, runs, tournaments])

  useEffect(() => {
    document.title = `${title} · ${APP_NAME}`
  }, [title])

  return null
}
