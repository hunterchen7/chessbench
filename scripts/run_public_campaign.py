#!/usr/bin/env python3
"""Run or resume the frozen public Luna/Haiku campaign.

Each cell delegates to a durable ChessBench command. A process interruption,
provider outage, or exhausted credit balance can therefore be handled by
rerunning this script: completed cells skip and partial cells continue at the
first missing item.
"""

from __future__ import annotations

import argparse
import os
import shlex
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from chessbench.campaigns import (  # noqa: E402
    PUBLIC_MODELS,
    CampaignCell,
    openrouter_credit_remaining,
    public_low_reasoning_campaign,
)
from chessbench.env import load_local_env  # noqa: E402
from chessbench.suite import load_suite  # noqa: E402


def _csv(value: str) -> list[str]:
    """Preserve the user-specified execution order while removing duplicates."""
    return list(dict.fromkeys(item.strip() for item in value.split(",") if item.strip()))


def _validate(cells: list[CampaignCell]) -> None:
    seen_suites: set[str] = set()
    for cell in cells:
        if cell.suite in seen_suites:
            continue
        suite = load_suite(ROOT / cell.suite)
        if len(suite.items) != cell.item_count:
            raise RuntimeError(
                f"{cell.suite}: expected {cell.item_count} items, found {len(suite.items)}"
            )
        seen_suites.add(cell.suite)


def _run(command: list[str], *, env: dict[str, str]) -> int:
    return subprocess.run(command, cwd=ROOT, env=env, check=False).returncode


def main() -> int:
    load_local_env(ROOT / ".env")
    parser = argparse.ArgumentParser(
        description="Run/resume the frozen Luna + Haiku public benchmark matrix"
    )
    parser.add_argument("--models", default=",".join(PUBLIC_MODELS))
    parser.add_argument(
        "--tracks", default="standard,woodpecker,esoteric",
        help="comma-separated subset: standard,woodpecker,esoteric",
    )
    parser.add_argument(
        "--response-styles",
        default="move_only,json_rationale",
        help="comma-separated subset: move_only,json_rationale",
    )
    parser.add_argument("--db", default="runs/chessbench.db")
    parser.add_argument("--data-root", default="web/public/data")
    parser.add_argument(
        "--dry-run", action="store_true", help="validate and print commands only"
    )
    parser.add_argument(
        "--continue-on-error",
        action="store_true",
        help="continue to later cells after a provider/cell failure",
    )
    parser.add_argument(
        "--sync",
        action="store_true",
        help="drain durable results to the configured Cloudflare API before exit",
    )
    parser.add_argument(
        "--minimum-credits",
        type=float,
        default=1.0,
        help="refuse to start below this OpenRouter key balance (default: $1)",
    )
    parser.add_argument(
        "--skip-credit-check",
        action="store_true",
        help="skip the read-only OpenRouter key-balance preflight",
    )
    args = parser.parse_args()

    requested_models = tuple(_csv(args.models))
    tracks = set(_csv(args.tracks))
    styles = set(_csv(args.response_styles))
    if not requested_models:
        parser.error("--models must contain at least one registry label")
    allowed_tracks = {"standard", "woodpecker", "esoteric"}
    allowed_styles = {"move_only", "json_rationale"}
    if not tracks or not tracks <= allowed_tracks:
        parser.error(f"--tracks must be a non-empty subset of {sorted(allowed_tracks)}")
    if not styles or not styles <= allowed_styles:
        parser.error(
            f"--response-styles must be a non-empty subset of {sorted(allowed_styles)}"
        )

    cells = [
        cell
        for cell in public_low_reasoning_campaign(requested_models)
        if cell.track in tracks and cell.response_style in styles
    ]
    _validate(cells)
    total_items = sum(cell.item_count for cell in cells)
    print(
        f"public-low-o8192: {len(cells)} durable cells, "
        f"{total_items} model-item evaluations"
    )

    commands = [
        cell.command(db=args.db, data_root=args.data_root) for cell in cells
    ]
    if args.dry_run:
        for cell, command in zip(cells, commands):
            print(f"{cell.key}\n  {shlex.join(command)}")
        return 0

    if args.minimum_credits < 0:
        parser.error("--minimum-credits cannot be negative")
    if not args.skip_credit_check:
        api_key = os.environ.get("OPENROUTER_API_KEY")
        if not api_key:
            print(
                "OPENROUTER_API_KEY is missing; no campaign state was created",
                file=sys.stderr,
            )
            return 2
        try:
            remaining = openrouter_credit_remaining(api_key)
        except RuntimeError as exc:
            print(f"{exc}; no campaign state was created", file=sys.stderr)
            return 2
        if remaining is None:
            print("OpenRouter key limit: unlimited")
        else:
            print(f"OpenRouter key limit remaining: ${remaining:.2f}")
            if remaining < args.minimum_credits:
                print(
                    f"need at least ${args.minimum_credits:.2f} to start; "
                    "no campaign state was created",
                    file=sys.stderr,
                )
                return 2

    env = os.environ.copy()
    failures: list[str] = []
    try:
        for index, (cell, command) in enumerate(zip(cells, commands), 1):
            print(f"\n[{index}/{len(cells)}] {cell.key}", flush=True)
            code = _run(command, env=env)
            if code == 0:
                continue
            failures.append(cell.key)
            print(
                f"cell exited {code}; all completed items remain durable",
                file=sys.stderr,
            )
            if not args.continue_on_error:
                break
    finally:
        export = [
            sys.executable,
            "-m",
            "chessbench",
            "export",
            "--runs-dir",
            str(Path(args.data_root) / "runs"),
            "--out",
            str(Path(args.data_root) / "index.json"),
        ]
        if _run(export, env=env) != 0:
            failures.append("static-export")
        if args.sync:
            sync = [
                sys.executable,
                "scripts/sync_cloudflare.py",
                "--db",
                args.db,
            ]
            if _run(sync, env=env) != 0:
                failures.append("cloudflare-sync")

    if failures:
        print("incomplete cells: " + ", ".join(failures), file=sys.stderr)
        return 1
    print("\npublic campaign complete")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
