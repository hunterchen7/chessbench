"""Run manifests retain the exact number of model-generated puzzle moves."""

from __future__ import annotations

import sqlite3
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class ModelMoveCostsMigrationTest(unittest.TestCase):
    def test_run_aggregate_has_model_move_counter(self) -> None:
        db = sqlite3.connect(":memory:")
        db.execute("PRAGMA foreign_keys = ON")
        for migration in sorted((ROOT / "migrations").glob("*.sql")):
            db.executescript(migration.read_text(encoding="utf-8"))

        columns = {
            row[1]: row for row in db.execute("PRAGMA table_info(benchmark_runs_v2)")
        }
        self.assertIn("model_moves", columns)
        self.assertEqual(columns["model_moves"][3], 1, "model_moves stays NOT NULL")
        self.assertEqual(columns["model_moves"][4], "0")


if __name__ == "__main__":
    unittest.main()
