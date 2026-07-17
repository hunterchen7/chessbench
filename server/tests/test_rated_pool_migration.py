"""The adaptive pool is indexed independently from fixed corpus membership."""

from __future__ import annotations

import sqlite3
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "migrations" / "0009_rated_puzzle_pool.sql"


class RatedPoolMigrationTest(unittest.TestCase):
    def test_rating_and_category_random_pivot_queries(self) -> None:
        db = sqlite3.connect(":memory:")
        db.execute("PRAGMA foreign_keys = ON")
        db.executescript(MIGRATION.read_text(encoding="utf-8"))
        db.execute(
            "INSERT INTO rated_puzzle_pools VALUES (?, ?, ?, ?, ?, 1, ?, ?)",
            ("sha256:pool", "rated-v1", "1.0.0", 3, "{}", "now", "now"),
        )
        rows = [
            ("a", 1400, 80, 95, 1000, 10, '{"id":"a"}'),
            ("b", 1550, 75, 96, 2000, 20, '{"id":"b"}'),
            ("c", 1800, 70, 97, 3000, 30, '{"id":"c"}'),
        ]
        db.executemany(
            "INSERT INTO rated_puzzles VALUES ('sha256:pool', ?, ?, ?, ?, ?, ?, ?)",
            rows,
        )
        db.executemany(
            "INSERT INTO rated_puzzle_tags VALUES ('sha256:pool', ?, ?, ?, ?)",
            [
                ("a", "family:forks", 1400, 10),
                ("b", "family:quiet_moves", 1550, 20),
                ("c", "family:forks", 1800, 30),
            ],
        )

        general = db.execute(
            """SELECT puzzle_id FROM rated_puzzles
               WHERE content_hash=? AND rating BETWEEN ? AND ? AND random_key>=?
               ORDER BY random_key LIMIT 1""",
            ("sha256:pool", 1300, 1700, 11),
        ).fetchone()
        themed = db.execute(
            """SELECT p.puzzle_id FROM rated_puzzle_tags t
               JOIN rated_puzzles p USING(content_hash, puzzle_id)
               WHERE p.content_hash=? AND t.tag=? AND t.rating BETWEEN ? AND ?
                 AND t.random_key>=? ORDER BY t.random_key LIMIT 1""",
            ("sha256:pool", "family:forks", 1300, 1900, 11),
        ).fetchone()
        self.assertEqual(general, ("b",))
        self.assertEqual(themed, ("c",))

        db.execute("DELETE FROM rated_puzzle_pools WHERE content_hash='sha256:pool'")
        self.assertEqual(db.execute("SELECT COUNT(*) FROM rated_puzzles").fetchone(), (0,))
        self.assertEqual(db.execute("SELECT COUNT(*) FROM rated_puzzle_tags").fetchone(), (0,))


if __name__ == "__main__":
    unittest.main()
