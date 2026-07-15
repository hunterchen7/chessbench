#!/usr/bin/env python3
"""Delete every local result artifact while preserving source corpora and suites."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "web" / "public" / "data"


def clear_children(path: Path, *, keep: set[str] = set()) -> int:
    removed = 0
    if not path.exists():
        return removed
    for child in path.iterdir():
        if child.name in keep:
            continue
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()
        removed += 1
    return removed


def write_json(path: Path, value: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=1) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--yes", action="store_true", help="confirm destructive local result deletion")
    args = parser.parse_args()
    if not args.yes:
        parser.error("pass --yes to confirm deletion")

    removed = 0
    removed += clear_children(DATA / "runs")
    removed += clear_children(DATA / "composed", keep={"index.json"})
    removed += clear_children(DATA / "tournaments", keep={"index.json"})
    removed += clear_children(ROOT / "runs")
    if ROOT.joinpath("webapp").exists():
        shutil.rmtree(ROOT / "webapp")
        removed += 1

    write_json(DATA / "index.json", {"schema": "chessbench.index.v2", "runs": []})
    write_json(DATA / "composed" / "index.json", {"schema": "chessbench.composed_index.v1", "runs": []})
    write_json(DATA / "tournaments" / "index.json", {"schema": "chessbench.tournament_index.v1", "tournaments": []})
    print(f"removed {removed} result artifact(s); public corpora and suites preserved")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
