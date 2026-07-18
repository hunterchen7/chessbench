import { Chess } from "chess.js"

export interface RatedPuzzleMetadata {
  puzzle_id: string
  rating: number
  rating_deviation?: number
  popularity?: number
  plays?: number
}

export interface RatedPuzzleSummary {
  puzzle_id: string
  rating: number
  rating_deviation?: number
  popularity?: number
  plays?: number
  themes: string[]
  categories: Record<string, string[]>
}

const DIFFICULTY_TIERS = [
  ["beginner", 1000],
  ["novice", 1400],
  ["intermediate", 1800],
  ["advanced", 2200],
  ["expert", 2600],
] as const

const CATEGORY_THEMES: Record<string, ReadonlySet<string>> = {
  phase: new Set([
    "opening", "middlegame", "endgame", "rookEndgame", "bishopEndgame", "pawnEndgame",
    "knightEndgame", "queenEndgame", "queenRookEndgame",
  ]),
  goal: new Set(["mate", "crushing", "advantage", "equality"]),
  length: new Set(["oneMove", "short", "long", "veryLong"]),
  mate_pattern: new Set([
    "anastasiaMate", "arabianMate", "backRankMate", "bodenMate", "doubleBishopMate",
    "dovetailMate", "hookMate", "killBoxMate", "smotheredMate", "vukovicMate",
    "cornerMate", "epauletteMate", "swallowstailMate", "mateIn1", "mateIn2", "mateIn3",
    "mateIn4", "mateIn5",
  ]),
  motif: new Set([
    "advancedPawn", "attackingF2F7", "attraction", "capturingDefender", "clearance",
    "defensiveMove", "deflection", "discoveredAttack", "doubleCheck", "exposedKing", "fork",
    "hangingPiece", "interference", "intermezzo", "kingsideAttack", "pin", "promotion",
    "queensideAttack", "quietMove", "sacrifice", "skewer", "trappedPiece", "underPromotion",
    "xRayAttack", "zugzwang", "enPassant", "castling", "zwischenzug",
  ]),
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

function finiteNumber(value: unknown, fallback = 0): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function optionalNumber(...values: unknown[]): number | undefined {
  const value = values.find((candidate) => candidate != null)
  return value == null ? undefined : finiteNumber(value)
}

function difficultyTier(rating: number): string {
  return DIFFICULTY_TIERS.find(([, upper]) => rating < upper)?.[0] ?? "master"
}

function puzzleCategories(raw: unknown, themes: string[], rating: number): Record<string, string[]> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const categories = Object.fromEntries(
      Object.entries(raw as Record<string, unknown>)
        .map(([dimension, values]) => [dimension, stringArray(values)])
        .filter(([, values]) => values.length),
    )
    if (categories.tier?.length) return categories
  }

  const categories: Record<string, string[]> = { tier: [difficultyTier(rating)] }
  for (const theme of themes) {
    for (const [dimension, members] of Object.entries(CATEGORY_THEMES)) {
      if (members.has(theme)) (categories[dimension] ??= []).push(theme)
    }
  }
  return categories
}

export function ratedPuzzleSummary(
  payload: Record<string, unknown>,
  metadata?: RatedPuzzleMetadata,
): RatedPuzzleSummary {
  const rating = finiteNumber(metadata?.rating ?? payload.rating)
  const themes = stringArray(payload.themes)
  return {
    puzzle_id: String(metadata?.puzzle_id ?? payload.puzzle_id ?? payload.id ?? ""),
    rating,
    rating_deviation: optionalNumber(metadata?.rating_deviation, payload.rating_deviation),
    popularity: optionalNumber(metadata?.popularity, payload.popularity),
    plays: optionalNumber(metadata?.plays, payload.plays, payload.nb_plays),
    themes,
    categories: puzzleCategories(payload.categories, themes, rating),
  }
}

export function ratedPuzzlePosition(
  payload: Record<string, unknown>,
  metadata?: RatedPuzzleMetadata,
): Record<string, unknown> {
  const summary = ratedPuzzleSummary(payload, metadata)
  const storedSolution = stringArray(payload.solution)
  const moves = stringArray(payload.moves)
  const alreadyNormalized = Array.isArray(payload.solution) && typeof payload.solver_is_white === "boolean"
  let fen = String(payload.fen ?? "")
  let setupSan = payload.setup_san == null ? undefined : String(payload.setup_san)
  let solverIsWhite = Boolean(payload.solver_is_white)
  let solution = storedSolution

  if (!alreadyNormalized && fen && moves.length) {
    const board = new Chess(fen)
    const setup = moves[0]
    const played = board.move({
      from: setup.slice(0, 2),
      to: setup.slice(2, 4),
      promotion: setup.slice(4) || undefined,
    })
    fen = board.fen()
    setupSan = played.san
    solverIsWhite = board.turn() === "w"
    solution = moves.slice(1)
  }

  const difficulty = String(payload.difficulty_band ?? "")
  return {
    ...summary,
    fen,
    setup_san: setupSan,
    solver_is_white: solverIsWhite,
    solution,
    solution_first: solution[0] ?? null,
    game_url: payload.game_url == null ? undefined : String(payload.game_url),
    source: payload.source == null ? undefined : String(payload.source),
    difficulty_band: ["easy", "medium", "hard"].includes(difficulty) ? difficulty : "",
  }
}
