#!/usr/bin/env python3
"""Build review, selection, duplicate, and distribution artifacts.

Candidate and non-public records are written beneath ``data/private`` by
default.  Only explicitly approved, rights-cleared records can appear in the
public artifact.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from chessbench.esoteric_curation import (  # noqa: E402
    artifact_document,
    distribution_report,
    duplicate_and_anticipation_report,
    load_curation_records,
    safe_status_report,
    select_curation_records,
)


def _write(path: pathlib.Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=1, ensure_ascii=False) + "\n", encoding="utf-8"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("inputs", nargs="+", type=pathlib.Path)
    parser.add_argument("--public-per-genre", type=int, default=50)
    parser.add_argument("--reserve-per-genre", type=int, default=10)
    parser.add_argument(
        "--private-out-dir",
        type=pathlib.Path,
        default=pathlib.Path("data/private/esoteric/benchmark-v2"),
    )
    parser.add_argument(
        "--public-out",
        type=pathlib.Path,
        default=pathlib.Path("corpora/curation/esoteric-benchmark-v2-public.json"),
    )
    parser.add_argument(
        "--status-out",
        type=pathlib.Path,
        default=pathlib.Path(
            "corpora/manifests/esoteric-benchmark-v2-curation-status.json"
        ),
        help="membership-free aggregate progress report safe to commit",
    )
    parser.add_argument(
        "--fail-on-target-gap",
        action="store_true",
        help="return nonzero unless every genre meets both public and reserve quotas",
    )
    args = parser.parse_args()

    if args.public_per_genre < 1 or args.reserve_per_genre < 0:
        parser.error(
            "quotas must be non-negative and public-per-genre must be positive"
        )
    private_parts = {part.lower() for part in args.private_out_dir.parts}
    if "private" not in private_parts:
        parser.error(
            "candidate/review artifacts must be written beneath a private directory"
        )

    records: list[dict[str, object]] = []
    for path in args.inputs:
        records.extend(load_curation_records(path))
    partitions = select_curation_records(
        records,
        public_per_genre=args.public_per_genre,
        reserve_per_genre=args.reserve_per_genre,
    )
    report = distribution_report(
        partitions,
        public_target=args.public_per_genre,
        reserve_target=args.reserve_per_genre,
    )
    duplicate_report = duplicate_and_anticipation_report(records)

    _write(
        args.private_out_dir / "candidate-pool.json",
        artifact_document("candidate_pool", records),
    )
    for name in ("reserved_private", "rejected", "pending", "invalid"):
        _write(
            args.private_out_dir / f"{name.replace('_', '-')}.json",
            artifact_document(name, partitions[name]),
        )
    _write(
        args.private_out_dir / "duplicate-and-anticipation-report.json",
        duplicate_report,
    )
    _write(args.private_out_dir / "distribution-report.json", report)
    _write(args.status_out, safe_status_report(report))
    _write(
        args.public_out,
        artifact_document("accepted_public", partitions["accepted_public"]),
    )

    exact = report["exact_counts"]
    assert isinstance(exact, dict)
    print(
        "candidate_pool={candidate_pool} accepted_public={accepted_public} "
        "reserved_private={reserved_private} rejected={rejected} pending={pending} "
        "invalid={invalid}".format(**exact)
    )
    print(f"targets_met={report['targets_met']}")
    return 1 if args.fail_on_target_gap and not report["targets_met"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
