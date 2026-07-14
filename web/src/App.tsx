import { lazy, Suspense } from "react"
import { HashRouter, Route, Routes } from "react-router-dom"
import { DataProvider } from "@/lib/useData"
import { Layout } from "@/components/Layout"

const Leaderboard = lazy(() => import("@/pages/Leaderboard").then((m) => ({ default: m.Leaderboard })))
const ModelDetail = lazy(() => import("@/pages/ModelDetail").then((m) => ({ default: m.ModelDetail })))
const Puzzles = lazy(() => import("@/pages/Puzzles").then((m) => ({ default: m.Puzzles })))
const PuzzleDetail = lazy(() => import("@/pages/PuzzleDetail").then((m) => ({ default: m.PuzzleDetail })))
const Woodpecker = lazy(() => import("@/pages/Woodpecker").then((m) => ({ default: m.Woodpecker })))
const Games = lazy(() => import("@/pages/Games").then((m) => ({ default: m.Games })))
const TournamentDetail = lazy(() => import("@/pages/TournamentDetail").then((m) => ({ default: m.TournamentDetail })))
const Esoteric = lazy(() => import("@/pages/Esoteric").then((m) => ({ default: m.Esoteric })))
const EsotericDetail = lazy(() => import("@/pages/EsotericDetail").then((m) => ({ default: m.EsotericDetail })))
const Methodology = lazy(() => import("@/pages/Methodology").then((m) => ({ default: m.Methodology })))

const Loading = () => <div className="py-20 text-center text-sm text-muted-foreground">Loading view…</div>

export default function App() {
  return (
    <DataProvider>
      <HashRouter>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Leaderboard />} />
              <Route path="model/:model" element={<ModelDetail />} />
              <Route path="puzzles" element={<Puzzles />} />
              <Route path="puzzles/:id" element={<PuzzleDetail />} />
              <Route path="woodpecker" element={<Woodpecker />} />
              <Route path="games" element={<Games />} />
              <Route path="games/:file" element={<TournamentDetail />} />
              <Route path="esoteric" element={<Esoteric />} />
              <Route path="esoteric/:id" element={<EsotericDetail />} />
              <Route path="methodology" element={<Methodology />} />
            </Route>
          </Routes>
        </Suspense>
      </HashRouter>
    </DataProvider>
  )
}
