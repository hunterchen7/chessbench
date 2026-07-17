"""Adaptive sessions retain versioned protocol and final rating summaries."""

from __future__ import annotations

import sqlite3
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class RatedSessionsMigrationTest(unittest.TestCase):
    def test_run_protocol_and_summary_columns_are_added(self) -> None:
        db = sqlite3.connect(":memory:")
        db.executescript((ROOT / "migrations" / "0003_points_platform.sql").read_text())
        db.executescript((ROOT / "migrations" / "0010_rated_sessions.sql").read_text())
        columns = {
            row[1] for row in db.execute("PRAGMA table_info(benchmark_runs_v2)")
        }
        self.assertIn("protocol_json", columns)
        self.assertIn("summary_json", columns)


if __name__ == "__main__":
    unittest.main()
