"""Large run-item payload chunks coexist with legacy inline payload_json rows."""

from __future__ import annotations

import sqlite3
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class RunItemPayloadChunksMigrationTest(unittest.TestCase):
    def test_chunk_table_is_migration_safe_and_payload_json_is_preserved(self) -> None:
        db = sqlite3.connect(":memory:")
        db.execute("PRAGMA foreign_keys = ON")
        for migration in sorted((ROOT / "migrations").glob("*.sql")):
            db.executescript(migration.read_text(encoding="utf-8"))

        item_columns = {
            row[1]: row for row in db.execute("PRAGMA table_info(benchmark_items_v2)")
        }
        self.assertIn("payload_json", item_columns)
        self.assertEqual(item_columns["payload_json"][3], 1, "payload_json stays NOT NULL")

        chunk_columns = {
            row[1]
            for row in db.execute(
                "PRAGMA table_info(benchmark_item_payload_chunks)"
            )
        }
        self.assertEqual(
            chunk_columns,
            {
                "run_id",
                "item_id",
                "payload_sha256",
                "chunk_index",
                "chunk_count",
                "payload_chunk",
                "created_at",
                "updated_at",
            },
        )


if __name__ == "__main__":
    unittest.main()
