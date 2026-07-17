"""The rated-pool browser has a stable, indexed page order."""

from __future__ import annotations

import sqlite3
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class RatedPuzzleBrowseMigrationTest(unittest.TestCase):
    def test_rating_order_is_stable_and_covered(self) -> None:
        db = sqlite3.connect(":memory:")
        db.executescript((ROOT / "migrations" / "0009_rated_puzzle_pool.sql").read_text())
        db.executescript((ROOT / "migrations" / "0012_rated_puzzle_browse.sql").read_text())
        db.execute(
            "INSERT INTO rated_puzzle_pools VALUES (?, ?, ?, ?, ?, 1, ?, ?)",
            ("sha256:pool", "rated-v1", "1.0.0", 4, "{}", "now", "now"),
        )
        db.executemany(
            "INSERT INTO rated_puzzles VALUES ('sha256:pool', ?, ?, 75, 90, 1000, ?, '{}')",
            [("z", 1600, 4), ("b", 1500, 3), ("a", 1500, 2), ("c", 1400, 1)],
        )

        page = db.execute(
            """SELECT puzzle_id FROM rated_puzzles
               WHERE content_hash=?
               ORDER BY rating, puzzle_id LIMIT 2 OFFSET 1""",
            ("sha256:pool",),
        ).fetchall()
        plan = db.execute(
            """EXPLAIN QUERY PLAN SELECT puzzle_id FROM rated_puzzles
               WHERE content_hash=? ORDER BY rating, puzzle_id LIMIT 2 OFFSET 1""",
            ("sha256:pool",),
        ).fetchall()

        self.assertEqual(page, [("a",), ("b",)])
        self.assertTrue(any("idx_rated_puzzles_browse" in row[3] for row in plan), plan)
        self.assertFalse(any("TEMP B-TREE" in row[3] for row in plan), plan)


if __name__ == "__main__":
    unittest.main()
