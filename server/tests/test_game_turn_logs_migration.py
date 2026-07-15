from __future__ import annotations

import sqlite3
import unittest
from pathlib import Path


SERVER = Path(__file__).resolve().parents[1]
MIGRATIONS = SERVER / "migrations"


class GameTurnOrdinalMigrationTest(unittest.TestCase):
    def test_existing_rows_survive_and_repeated_ply_attempt_pairs_are_allowed(
        self,
    ) -> None:
        db = sqlite3.connect(":memory:")
        db.execute("PRAGMA foreign_keys = ON")
        for migration in sorted(MIGRATIONS.glob("000[1-5]_*.sql")):
            db.executescript(migration.read_text(encoding="utf-8"))

        db.execute(
            """INSERT INTO games
               (game_id, tid, idx, white, black, result, termination, plies,
                pgn, start_fen, moves_json, updated)
               VALUES ('t#0', 't', 0, 'w', 'b', '1-0', 'checkmate', 2,
                       '', NULL, '[]', '2026-01-01')"""
        )
        db.executemany(
            """INSERT INTO game_turn_logs_v2
               (game_id, ply, attempt, color, system_prompt, prompt, raw_response,
                parsed_move, legal, explanation, prompt_tokens, completion_tokens,
                reasoning_tokens, cost_usd, created_at, response_format_valid,
                response_format_error)
               VALUES ('t#0', ?, ?, ?, NULL, ?, ?, ?, ?, NULL, ?, ?, ?, ?,
                       '2026-01-01', ?, ?)""",
            [
                (1, 0, "white", "p1", "e2e4", "e2e4", 1, 10, 2, 1, 0.01, 1, None),
                (2, 0, "black", "p2", "bad", None, 0, 11, 3, 2, 0.02, 0, "bad JSON"),
                (2, 1, "black", "p3", "e7e5", "e7e5", 1, 12, 4, 3, 0.03, 1, None),
            ],
        )

        db.executescript(
            (MIGRATIONS / "0006_game_turn_ordinals.sql").read_text(encoding="utf-8")
        )

        rows = db.execute(
            """SELECT turn_ordinal, ply, attempt, color, prompt, raw_response,
                      parsed_move, legal, prompt_tokens, completion_tokens,
                      reasoning_tokens, cost_usd, response_format_valid,
                      response_format_error
               FROM game_turn_logs_v2 ORDER BY turn_ordinal"""
        ).fetchall()
        self.assertEqual(
            [row[:4] for row in rows],
            [(0, 1, 0, "white"), (1, 2, 0, "black"), (2, 2, 1, "black")],
        )
        self.assertEqual(
            rows[1][4:], ("p2", "bad", None, 0, 11, 3, 2, 0.02, 0, "bad JSON")
        )

        # A later move envelope may reuse both board ply and retry index.  Its
        # global ordinal, rather than that semantic pair, is the row identity.
        db.execute(
            """INSERT INTO game_turn_logs_v2
               (game_id, turn_ordinal, ply, attempt, color, raw_response, legal, created_at)
               VALUES ('t#0', 3, 2, 0, 'white', 'forfeit', 0, '2026-01-02')"""
        )
        self.assertEqual(
            db.execute("SELECT COUNT(*) FROM game_turn_logs_v2").fetchone()[0], 4
        )
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute(
                """INSERT INTO game_turn_logs_v2
                   (game_id, turn_ordinal, ply, attempt, color, raw_response, legal, created_at)
                   VALUES ('t#0', 3, 9, 9, 'white', 'duplicate ordinal', 0, '2026-01-02')"""
            )


if __name__ == "__main__":
    unittest.main()
