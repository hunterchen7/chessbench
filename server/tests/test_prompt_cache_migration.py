from __future__ import annotations

import sqlite3
import unittest
from pathlib import Path


SERVER = Path(__file__).resolve().parents[1]
MIGRATIONS = SERVER / "migrations"


class PromptCacheMigrationTest(unittest.TestCase):
    def test_cache_accounting_columns_exist_at_every_persistence_level(self) -> None:
        db = sqlite3.connect(":memory:")
        db.execute("PRAGMA foreign_keys = ON")
        for migration in sorted(MIGRATIONS.glob("*.sql")):
            db.executescript(migration.read_text(encoding="utf-8"))

        for table in (
            "benchmark_runs_v2",
            "benchmark_items_v2",
            "game_turn_logs_v2",
        ):
            columns = {
                row[1] for row in db.execute(f"PRAGMA table_info({table})").fetchall()
            }
            self.assertTrue(
                {
                    "cache_read_tokens",
                    "cache_write_tokens",
                    "uncached_prompt_tokens",
                    "cache_discount_usd",
                }.issubset(columns)
            )

        game_columns = {
            row[1]
            for row in db.execute("PRAGMA table_info(game_turn_logs_v2)").fetchall()
        }
        self.assertIn("cache_policy", game_columns)
        self.assertIn("cache_session_id", game_columns)


if __name__ == "__main__":
    unittest.main()
