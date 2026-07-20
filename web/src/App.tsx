import { lazy, Suspense } from "react"
import { HashRouter, Route, Routes } from "react-router-dom"
import { DataProvider } from "@/lib/useData"
import { Layout } from "@/components/Layout"
import { AppLoadingSkeleton } from "@/components/LoadingSkeletons"
import { DocumentTitle } from "@/components/DocumentTitle"

const Leaderboard = lazy(() => import("@/pages/Leaderboard").then((m) => ({ default: m.Leaderboard })))
const ModelDetail = lazy(() => import("@/pages/ModelDetail").then((m) => ({ default: m.ModelDetail })))
const RunComparison = lazy(() => import("@/pages/RunComparison").then((m) => ({ default: m.RunComparison })))
const PuzzleLeaderboard = lazy(() => import("@/pages/PuzzleLeaderboard").then((m) => ({ default: m.PuzzleLeaderboard })))
const HumanDetail = lazy(() => import("@/pages/HumanDetail").then((m) => ({ default: m.HumanDetail })))
const PuzzleBrowser = lazy(() => import("@/pages/Puzzles").then((m) => ({ default: m.PuzzleBrowser })))
const PuzzleStart = lazy(() => import("@/pages/PuzzleStart").then((m) => ({ default: m.PuzzleStart })))
const PuzzleDetail = lazy(() => import("@/pages/PuzzleDetail").then((m) => ({ default: m.PuzzleDetail })))
const Games = lazy(() => import("@/pages/Games").then((m) => ({ default: m.Games })))
const TournamentDetail = lazy(() => import("@/pages/TournamentDetail").then((m) => ({ default: m.TournamentDetail })))
const Esoteric = lazy(() => import("@/pages/Esoteric").then((m) => ({ default: m.Esoteric })))
const EsotericDetail = lazy(() => import("@/pages/EsotericDetail").then((m) => ({ default: m.EsotericDetail })))
const Methodology = lazy(() => import("@/pages/Methodology").then((m) => ({ default: m.Methodology })))
const NotFound = lazy(() => import("@/pages/NotFound").then((m) => ({ default: m.NotFound })))

export default function App() {
  return (
    <DataProvider>
      <HashRouter>
        <DocumentTitle />
        <Suspense fallback={<AppLoadingSkeleton />}>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Leaderboard />} />
              <Route path="model/:model" element={<ModelDetail />} />
              <Route path="compare" element={<RunComparison />} />
              <Route path="puzzles" element={<PuzzleLeaderboard />} />
              <Route path="human/:runId" element={<HumanDetail />} />
              <Route path="puzzles/browse" element={<PuzzleBrowser />} />
              <Route path="puzzles/play" element={<PuzzleStart />} />
              <Route path="puzzles/:id" element={<PuzzleDetail />} />
              <Route path="games" element={<Games />} />
              <Route path="games/:file" element={<TournamentDetail />} />
              <Route path="games/:file/:game" element={<TournamentDetail />} />
              <Route path="esoteric" element={<Esoteric />} />
              <Route path="esoteric/:id" element={<EsotericDetail />} />
              <Route path="methodology" element={<Methodology />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </Suspense>
      </HashRouter>
    </DataProvider>
  )
}
