import { HashRouter, Route, Routes } from "react-router-dom"
import { DataProvider } from "@/lib/useData"
import { Layout } from "@/components/Layout"
import { Leaderboard } from "@/pages/Leaderboard"
import { ModelDetail } from "@/pages/ModelDetail"
import { Puzzles } from "@/pages/Puzzles"
import { PuzzleDetail } from "@/pages/PuzzleDetail"
import { Games } from "@/pages/Games"
import { TournamentDetail } from "@/pages/TournamentDetail"

export default function App() {
  return (
    <DataProvider>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Leaderboard />} />
            <Route path="model/:model" element={<ModelDetail />} />
            <Route path="puzzles" element={<Puzzles />} />
            <Route path="puzzles/:id" element={<PuzzleDetail />} />
            <Route path="games" element={<Games />} />
            <Route path="games/:file" element={<TournamentDetail />} />
          </Route>
        </Routes>
      </HashRouter>
    </DataProvider>
  )
}
