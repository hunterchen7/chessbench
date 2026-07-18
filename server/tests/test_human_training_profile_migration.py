"""Saved human training ratings have unique case-insensitive handles."""

from __future__ import annotations

import sqlite3
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class HumanTrainingProfileMigrationTest(unittest.TestCase):
    def test_profiles_are_one_per_uid_and_handle(self) -> None:
        db = sqlite3.connect(":memory:")
        db.executescript(
            (ROOT / "migrations" / "0014_human_training_profiles.sql").read_text()
        )
        row = (
            "uid-1", "Knight", 1500.0, 500.0, 0.09, 0, 0, "{}",
            "now", "now", 1,
        )
        db.execute(
            "INSERT INTO human_training_profiles VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            row,
        )
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute(
                "INSERT INTO human_training_profiles VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                ("uid-2", "knight", *row[2:]),
            )

        indexes = db.execute(
            "SELECT name FROM sqlite_master WHERE type='index'"
        ).fetchall()
        self.assertIn(("idx_human_training_rating",), indexes)


if __name__ == "__main__":
    unittest.main()
