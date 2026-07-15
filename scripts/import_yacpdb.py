#!/usr/bin/env python3
"""Fetch a private, provenance-rich YACPDB candidate catalog."""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
from datetime import datetime, timezone

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from chessbench.sources.yacpdb import QUERIES, iter_candidates  # noqa: E402
from chessbench.types import StipulationKind  # noqa: E402

KINDS: tuple[StipulationKind, ...] = tuple(QUERIES)  # type: ignore[assignment]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--per-kind", type=int, default=75)
    parser.add_argument("--max-pages", type=int, default=50)
    parser.add_argument("--kind", action="append", choices=KINDS)
    parser.add_argument(
        "--out",
        type=pathlib.Path,
        default=pathlib.Path("data/private/yacpdb/catalog.json"),
    )
    args = parser.parse_args()
    if args.out.exists():
        catalog = json.loads(args.out.read_text(encoding="utf-8"))
        catalog["fetched"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    else:
        catalog = {
            "schema": "chessbench.private_source_catalog.v1",
            "source": "https://www.yacpdb.org/",
            "fetched": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "rights_status": "private-research-pending-review",
            "categories": {},
        }
    categories = catalog["categories"]
    assert isinstance(categories, dict)
    selected_kinds = tuple(args.kind) if args.kind else KINDS
    for kind in selected_kinds:
        records: list[dict[str, object]] = []
        pages: set[int] = set()
        upstream_total = 0
        for entry, page, total in iter_candidates(
            kind, maximum=args.per_kind, max_pages=args.max_pages
        ):
            records.append(entry)
            pages.add(page)
            upstream_total = total
        categories[kind] = {
            "query": QUERIES[kind],
            "upstream_total": upstream_total,
            "pages_read": sorted(pages),
            "retained": len(records),
            "records": records,
        }
        print(f"{kind}: retained {len(records)} of {upstream_total:,}")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(catalog, indent=1, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"private catalog -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
