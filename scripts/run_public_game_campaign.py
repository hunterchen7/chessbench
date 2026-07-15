#!/usr/bin/env python3
"""Run or resume the color-balanced Luna/Haiku public game matrix."""

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
    openrouter_credit_remaining,
    public_low_reasoning_game_campaign,
)
from chessbench.env import load_local_env  # noqa: E402


def _csv(value: str) -> set[str]:
    return {item.strip() for item in value.split(",") if item.strip()}


def _run(command: list[str], *, env: dict[str, str]) -> int:
    return subprocess.run(command, cwd=ROOT, env=env, check=False).returncode


def main() -> int:
    load_local_env(ROOT / ".env")
    parser = argparse.ArgumentParser(
        description="Run/resume the Luna + Haiku game response-style matrix"
    )
    parser.add_argument(
        "--response-styles",
        default="move_only,json_rationale",
        help="comma-separated subset: move_only,json_rationale",
    )
    parser.add_argument("--db", default="runs/chessbench.db")
    parser.add_argument("--data-root", default="web/public/data")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--publish",
        action="store_true",
        help="stream/replay every game to the configured Cloudflare API",
    )
    parser.add_argument("--continue-on-error", action="store_true")
    parser.add_argument("--minimum-credits", type=float, default=1.0)
    parser.add_argument("--skip-credit-check", action="store_true")
    args = parser.parse_args()

    styles = _csv(args.response_styles)
    allowed = {"move_only", "json_rationale"}
    if not styles or not styles <= allowed:
        parser.error(f"--response-styles must be a non-empty subset of {sorted(allowed)}")
    if args.minimum_credits < 0:
        parser.error("--minimum-credits cannot be negative")
    if args.publish and (
        not os.environ.get("CHESSBENCH_API")
        or not os.environ.get("CHESSBENCH_INGEST_TOKEN")
    ):
        parser.error(
            "--publish requires CHESSBENCH_API and CHESSBENCH_INGEST_TOKEN"
        )

    cells = [
        cell
        for cell in public_low_reasoning_game_campaign()
        if cell.response_style in styles
    ]
    commands = [
        cell.command(
            db=args.db,
            data_root=args.data_root,
            publish=args.publish,
        )
        for cell in cells
    ]
    print(
        f"public-games-low-o8192: {len(cells)} durable conditions, "
        f"{sum(cell.games_per_pair for cell in cells)} games"
    )
    if args.dry_run:
        for cell, command in zip(cells, commands):
            print(f"{cell.key}\n  {shlex.join(command)}")
        return 0

    if not args.skip_credit_check:
        api_key = os.environ.get("OPENROUTER_API_KEY")
        if not api_key:
            print(
                "OPENROUTER_API_KEY is missing; no game state was created",
                file=sys.stderr,
            )
            return 2
        try:
            remaining = openrouter_credit_remaining(api_key)
        except RuntimeError as exc:
            print(f"{exc}; no game state was created", file=sys.stderr)
            return 2
        if remaining is None:
            print("OpenRouter key limit: unlimited")
        else:
            print(f"OpenRouter key limit remaining: ${remaining:.2f}")
            if remaining < args.minimum_credits:
                print(
                    f"need at least ${args.minimum_credits:.2f} to start; "
                    "no game state was created",
                    file=sys.stderr,
                )
                return 2

    env = os.environ.copy()
    failures: list[str] = []
    for index, (cell, command) in enumerate(zip(cells, commands), 1):
        print(f"\n[{index}/{len(cells)}] {cell.key}", flush=True)
        code = _run(command, env=env)
        if code == 0:
            continue
        failures.append(cell.key)
        if not args.continue_on_error:
            break

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
    if failures:
        print("incomplete game cells: " + ", ".join(failures), file=sys.stderr)
        return 1
    print("\npublic game campaign complete")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
