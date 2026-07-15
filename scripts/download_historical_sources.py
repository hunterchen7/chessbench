#!/usr/bin/env python3
"""Download and content-address the historical PGN discovery packs.

Raw PGNs are deliberately ignored by git.  The committed lock file records the
exact bytes used by the miner so a live URL changing in place cannot silently
change a corpus release.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import re
import sys
import tempfile
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEFAULT_CATALOG = ROOT / "data" / "curated" / "historical-source-catalog.json"
DEFAULT_DESTINATION = ROOT / "data" / "sources" / "historical"
DEFAULT_LOCK = ROOT / "data" / "curated" / "historical-source-lock.json"
USER_AGENT = "ChessBench historical-corpus curator/1.0"


def _read_catalog(path: pathlib.Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, list):
        sources = payload
    elif isinstance(payload, dict):
        sources = payload.get("sources", payload.get("source_packs", payload.get("packs")))
    else:
        sources = None
    if not isinstance(sources, list):
        raise ValueError("catalog must be an array or contain a sources array")

    enabled: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, source in enumerate(sources, 1):
        if not isinstance(source, dict):
            raise ValueError(f"source {index} must be an object")
        if source.get("enabled", True) is False:
            continue
        source_id = str(source.get("id", source.get("source_id", ""))).strip()
        url = str(source.get("download_url", "")).strip()
        if not source_id or not re.fullmatch(r"[a-z0-9][a-z0-9-]*", source_id):
            raise ValueError(f"source {index} has an invalid id: {source_id!r}")
        if source_id in seen:
            raise ValueError(f"duplicate source id: {source_id}")
        if urlparse(url).scheme != "https":
            raise ValueError(f"{source_id}: download_url must be HTTPS")
        seen.add(source_id)
        enabled.append(source)
    return enabled


def _filename(source_id: str, url: str) -> str:
    suffixes = pathlib.PurePosixPath(urlparse(url).path).suffixes
    suffix = "".join(suffixes[-2:]) if suffixes[-2:] == [".pgn", ".zst"] else (
        suffixes[-1] if suffixes else ".pgn"
    )
    if suffix.lower() not in {".pgn", ".zip", ".zst", ".pgn.zst"}:
        suffix = ".pgn"
    return f"{source_id}{suffix.lower()}"


def _sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _download(source: dict[str, Any], destination: pathlib.Path) -> dict[str, Any]:
    source_id = str(source.get("id", source.get("source_id")))
    url = str(source["download_url"])
    target = destination / _filename(source_id, url)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})

    with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310 - catalog is validated HTTPS
        with tempfile.NamedTemporaryFile(dir=destination, delete=False) as temporary:
            temporary_path = pathlib.Path(temporary.name)
            while chunk := response.read(1024 * 1024):
                temporary.write(chunk)
        headers = response.headers

    try:
        byte_length = temporary_path.stat().st_size
        if byte_length == 0:
            raise ValueError(f"{source_id}: server returned an empty artifact")
        digest = _sha256(temporary_path)
        expected = str(source.get("expected_sha256", "")).removeprefix("sha256:")
        if expected and digest != expected:
            raise ValueError(
                f"{source_id}: sha256 mismatch (expected {expected}, received {digest})"
            )
        os.replace(temporary_path, target)
    finally:
        temporary_path.unlink(missing_ok=True)

    return {
        "source_id": source_id,
        "download_url": url,
        "landing_url": source.get("landing_url", source.get("context_url", "")),
        "local_file": target.relative_to(ROOT).as_posix(),
        "sha256": digest,
        "byte_length": byte_length,
        "etag": headers.get("ETag", ""),
        "last_modified": headers.get("Last-Modified", ""),
        "retrieved_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
    }


def _verify(lock_path: pathlib.Path) -> tuple[int, list[str]]:
    lock = json.loads(lock_path.read_text(encoding="utf-8"))
    errors: list[str] = []
    verified = 0
    for artifact in lock.get("artifacts", []):
        path = ROOT / str(artifact["local_file"])
        if not path.is_file():
            errors.append(f"missing {path}")
            continue
        digest = _sha256(path)
        if digest != artifact.get("sha256"):
            errors.append(f"checksum mismatch for {path}")
            continue
        verified += 1
    return verified, errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=pathlib.Path, default=DEFAULT_CATALOG)
    parser.add_argument("--destination", type=pathlib.Path, default=DEFAULT_DESTINATION)
    parser.add_argument("--lock", type=pathlib.Path, default=DEFAULT_LOCK)
    parser.add_argument("--limit", type=int, default=0, help="download only the first N enabled packs")
    parser.add_argument(
        "--format",
        action="append",
        default=[],
        dest="formats",
        help="only fetch this archive_format (repeatable, e.g. --format pgn)",
    )
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()

    if args.verify_only:
        verified, errors = _verify(args.lock)
        print(json.dumps({"valid": not errors, "verified": verified, "errors": errors}, indent=2))
        return 1 if errors else 0

    sources = _read_catalog(args.catalog)
    if args.formats:
        formats = set(args.formats)
        sources = [source for source in sources if source.get("archive_format", "pgn") in formats]
    if args.limit:
        sources = sources[: args.limit]
    args.destination.mkdir(parents=True, exist_ok=True)
    artifacts: list[dict[str, Any]] = []
    for position, source in enumerate(sources, 1):
        source_id = str(source.get("id", source.get("source_id")))
        try:
            artifact = _download(source, args.destination)
        except (OSError, ValueError, urllib.error.URLError) as exc:
            print(f"[{position}/{len(sources)}] {source_id}: FAILED: {exc}", file=sys.stderr)
            return 1
        artifacts.append(artifact)
        print(
            f"[{position}/{len(sources)}] {source_id}: "
            f"{artifact['byte_length']:,} bytes sha256:{str(artifact['sha256'])[:12]}"
        )

    lock = {
        "schema_version": "chessbench.historical_source_lock.v1",
        "catalog": args.catalog.relative_to(ROOT).as_posix(),
        "archive_formats": sorted(set(args.formats)) if args.formats else ["all"],
        "artifact_count": len(artifacts),
        "artifacts": artifacts,
    }
    args.lock.parent.mkdir(parents=True, exist_ok=True)
    args.lock.write_text(json.dumps(lock, indent=2) + "\n", encoding="utf-8")
    print(f"locked {len(artifacts)} artifacts -> {args.lock}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
