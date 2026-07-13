import type { Env, RunDoc, TournamentDoc } from "./types"

/** Run D1 statements in transactional chunks (keeps each batch well within limits). */
async function batchChunked(env: Env, stmts: D1PreparedStatement[], size = 50): Promise<void> {
  for (let i = 0; i < stmts.length; i += size) {
    await env.DB.batch(stmts.slice(i, i + size))
  }
}

/** A run's stable id: model × condition × suite (the grain of a run cell). Suite
 * is included so scoring the same model+condition on two suites does not collide. */
export function runId(doc: RunDoc): string {
  return `${doc.model}__${doc.condition?.slug ?? "unknown"}__${doc.suite?.name ?? "nosuite"}`
}

/**
 * Ingest a run document (the exact shape from store.py): upsert the run header,
 * the position bank, and one answer row per puzzle. Idempotent — re-ingesting a
 * run replaces its rows.
 */
export async function ingestRun(env: Env, doc: RunDoc): Promise<{ run_id: string; items: number }> {
  const slug = doc.condition?.slug ?? "unknown"
  const id = runId(doc)
  const temperature = typeof doc.condition?.temperature === "number" ? doc.condition.temperature : null
  const suite = doc.suite?.name ?? null

  // Run header + wipe any prior answers for this run, in one transaction.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO runs (run_id, model, provider, kind, condition_slug, suite, temperature, created, summary_json, doc_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(run_id) DO UPDATE SET
         model=excluded.model, provider=excluded.provider, kind=excluded.kind,
         condition_slug=excluded.condition_slug, suite=excluded.suite, temperature=excluded.temperature,
         created=excluded.created, summary_json=excluded.summary_json, doc_json=excluded.doc_json`,
    ).bind(
      id, doc.model, doc.provider ?? null, doc.kind ?? "puzzle", slug, suite, temperature,
      doc.created ?? null, JSON.stringify(doc.summary ?? {}), JSON.stringify(doc),
    ),
    env.DB.prepare(`DELETE FROM run_answers WHERE run_id = ?`).bind(id),
  ])

  const items = doc.items ?? []
  const stmts: D1PreparedStatement[] = []
  for (const it of items) {
    if (it.fen) {
      stmts.push(
        env.DB.prepare(
          `INSERT INTO puzzles (puzzle_id, rating, fen, setup_san, solver_is_white, solution_json, solution_first, themes_json, categories_json, game_url)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(puzzle_id) DO UPDATE SET
             rating=excluded.rating, fen=excluded.fen, setup_san=excluded.setup_san,
             solver_is_white=excluded.solver_is_white, solution_json=excluded.solution_json,
             solution_first=excluded.solution_first, themes_json=excluded.themes_json,
             categories_json=excluded.categories_json, game_url=excluded.game_url`,
        ).bind(
          it.puzzle_id, it.rating ?? null, it.fen, it.setup_san ?? null,
          it.solver_is_white ? 1 : 0, JSON.stringify(it.solution ?? []), it.solution_first ?? null,
          JSON.stringify(it.themes ?? []), JSON.stringify(it.categories ?? {}), it.game_url ?? null,
        ),
      )
    }
    stmts.push(
      env.DB.prepare(
        `INSERT INTO run_answers (run_id, puzzle_id, model, condition_slug, solved, score, first_move_legal, failure_reason, answer_move, answer_explanation, seq_elo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(run_id, puzzle_id) DO UPDATE SET
           model=excluded.model, condition_slug=excluded.condition_slug, solved=excluded.solved,
           score=excluded.score, first_move_legal=excluded.first_move_legal, failure_reason=excluded.failure_reason,
           answer_move=excluded.answer_move, answer_explanation=excluded.answer_explanation, seq_elo=excluded.seq_elo`,
      ).bind(
        id, it.puzzle_id, doc.model, slug, it.solved ? 1 : 0, it.score ?? 0,
        it.first_move_legal ? 1 : 0, it.failure_reason ?? null, it.answer_move ?? null,
        it.answer_explanation ?? null, typeof it.seq_elo === "number" ? it.seq_elo : null,
      ),
    )
  }
  await batchChunked(env, stmts, 40)
  return { run_id: id, items: items.length }
}

export async function ingestTournament(env: Env, doc: TournamentDoc, tid: string): Promise<{ tid: string }> {
  const slug = doc.condition?.slug ?? "unknown"
  const standings = doc.standings ?? []
  const winner = standings[0]?.label ?? null
  await env.DB.prepare(
    `INSERT INTO tournaments (tid, created, condition_slug, n_players, n_games, winner, doc_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tid) DO UPDATE SET
       created=excluded.created, condition_slug=excluded.condition_slug, n_players=excluded.n_players,
       n_games=excluded.n_games, winner=excluded.winner, doc_json=excluded.doc_json`,
  ).bind(tid, doc.created ?? null, slug, standings.length, (doc.games ?? []).length, winner, JSON.stringify(doc)).run()
  return { tid }
}
