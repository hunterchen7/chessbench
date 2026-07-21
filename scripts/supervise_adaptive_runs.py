#!/usr/bin/env python3
"""Keep the long-running adaptive model-rating sessions alive.

Launch this once while external execution is available.  The detached supervisor
owns any workers it starts, resumes durable partial runs, and recovers a run
whose previous worker vanished without updating SQLite after its request
deadline plus a grace period.
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import sqlite3
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

# This target list is the exact July 2026 campaign record. It resumes known run
# IDs from the campaign database. It does not initialize runs in a fresh
# database. New canonical runs use RD 77 unless their stored protocol pins a
# historical value. See docs/RATED_SESSIONS.md before a new campaign starts.


@dataclass(frozen=True)
class Target:
    name: str
    run_id: str
    request_timeout: int
    command: tuple[str, ...]


TARGETS = (
    Target(
        "inkling-seed-0",
        "adfd6a958dc94768bf39bec4594b4a3f",
        900,
        (
            sys.executable, "-m", "chessbench", "rate-model",
            "--model", "inkling", "--seed", "0", "--reasoning", "high",
            "--target-rd", "75",
            "--capture-reasoning", "--max-output-tokens", "0",
            "--provider-only", "together", "--no-provider-fallbacks",
            "--require-provider-parameters", "--request-timeout", "900",
            "--live-sync-every", "5",
        ),
    ),
    Target(
        "inkling-seed-1",
        "1a9c25c0ea3b4c9b83fb59528fb94773",
        900,
        (
            sys.executable, "-m", "chessbench", "rate-model",
            "--model", "inkling", "--seed", "1", "--reasoning", "high",
            "--target-rd", "75",
            "--capture-reasoning", "--max-output-tokens", "0",
            "--provider-only", "together", "--no-provider-fallbacks",
            "--require-provider-parameters", "--request-timeout", "900",
            "--live-sync-every", "5",
        ),
    ),
    Target(
        "inkling-seed-2",
        "def8d1247e804e01bb75ec1b379b50ce",
        900,
        (
            sys.executable, "-m", "chessbench", "rate-model",
            "--model", "inkling", "--seed", "2", "--reasoning", "high",
            "--target-rd", "75",
            "--capture-reasoning", "--max-output-tokens", "0",
            "--provider-only", "together", "--no-provider-fallbacks",
            "--require-provider-parameters", "--request-timeout", "900",
            "--live-sync-every", "5",
        ),
    ),
    Target(
        "kimi-k3-seed-0",
        "9e22e756c5204512b54d279ac66db77b",
        1800,
        (
            sys.executable, "-m", "chessbench", "rate-model",
            "--model", "kimi-k3", "--seed", "0", "--reasoning", "max",
            "--target-rd", "75",
            "--capture-reasoning", "--max-output-tokens", "0",
            "--provider-only", "moonshotai", "--no-provider-fallbacks",
            "--request-timeout", "1800", "--live-sync-every", "5",
        ),
    ),
    Target(
        "gemini-3-1-flash-lite-seed-0",
        "ecad19e46302433ebc46a43b2ae48ad5",
        900,
        (
            sys.executable, "-m", "chessbench", "rate-model",
            "--model", "gemini-3.1-flash-lite", "--seed", "0",
            "--reasoning", "high", "--target-rd", "77",
            "--capture-reasoning", "--max-output-tokens", "0",
            "--provider-only", "google-ai-studio", "--no-provider-fallbacks",
            "--require-provider-parameters", "--request-timeout", "900",
            "--live-sync-every", "5",
        ),
    ),
    Target(
        "gemini-3-1-flash-lite-seed-1",
        "0700bd19cdc54346a7539a6c5e0df396",
        900,
        (
            sys.executable, "-m", "chessbench", "rate-model",
            "--model", "gemini-3.1-flash-lite", "--seed", "1",
            "--reasoning", "high", "--target-rd", "77",
            "--capture-reasoning", "--max-output-tokens", "0",
            "--provider-only", "google-ai-studio", "--no-provider-fallbacks",
            "--require-provider-parameters", "--request-timeout", "900",
            "--live-sync-every", "5",
        ),
    ),
    Target(
        "gemini-3-1-flash-lite-seed-2",
        "55bed7739bd347c1b3f1b0fa86cabc87",
        900,
        (
            sys.executable, "-m", "chessbench", "rate-model",
            "--model", "gemini-3.1-flash-lite", "--seed", "2",
            "--reasoning", "high", "--target-rd", "77",
            "--capture-reasoning", "--max-output-tokens", "0",
            "--provider-only", "google-ai-studio", "--no-provider-fallbacks",
            "--require-provider-parameters", "--request-timeout", "900",
            "--live-sync-every", "5",
        ),
    ),
    Target(
        "llama-3-1-8b-instruct-seed-0",
        "f877b21b81134e42935c68e5b7ded280",
        300,
        (
            sys.executable, "-m", "chessbench", "rate-model",
            "--model", "llama-3.1-8b-instruct", "--seed", "0",
            "--target-rd", "77", "--no-capture-reasoning",
            "--max-output-tokens", "0", "--provider-only", "groq",
            "--no-provider-fallbacks", "--require-provider-parameters",
            "--request-timeout", "300", "--live-sync-every", "5",
        ),
    ),
    Target(
        "llama-3-1-8b-instruct-seed-1",
        "866eeac4af4c496b8df4c8f2c479312a",
        300,
        (
            sys.executable, "-m", "chessbench", "rate-model",
            "--model", "llama-3.1-8b-instruct", "--seed", "1",
            "--target-rd", "77", "--no-capture-reasoning",
            "--max-output-tokens", "0", "--provider-only", "groq",
            "--no-provider-fallbacks", "--require-provider-parameters",
            "--request-timeout", "300", "--live-sync-every", "5",
        ),
    ),
    Target(
        "llama-3-1-8b-instruct-seed-2",
        "b8af9cfbf0614b2983fcf15010d1beb1",
        300,
        (
            sys.executable, "-m", "chessbench", "rate-model",
            "--model", "llama-3.1-8b-instruct", "--seed", "2",
            "--target-rd", "77", "--no-capture-reasoning",
            "--max-output-tokens", "0", "--provider-only", "groq",
            "--no-provider-fallbacks", "--require-provider-parameters",
            "--request-timeout", "300", "--live-sync-every", "5",
        ),
    ),
    Target(
        "qwen-2-5-7b-instruct-seed-0",
        "58ba40c1cfe74eaf8c72774602d320e6",
        300,
        (
            sys.executable, "-m", "chessbench", "rate-model",
            "--model", "qwen-2.5-7b-instruct", "--seed", "0",
            "--target-rd", "77", "--no-capture-reasoning",
            "--max-output-tokens", "0", "--provider-only", "together",
            "--no-provider-fallbacks", "--require-provider-parameters",
            "--request-timeout", "300", "--live-sync-every", "5",
        ),
    ),
    Target(
        "qwen-2-5-7b-instruct-seed-1",
        "a6fd2854dc554ba9b798fe50c9b12684",
        300,
        (
            sys.executable, "-m", "chessbench", "rate-model",
            "--model", "qwen-2.5-7b-instruct", "--seed", "1",
            "--target-rd", "77", "--no-capture-reasoning",
            "--max-output-tokens", "0", "--provider-only", "together",
            "--no-provider-fallbacks", "--require-provider-parameters",
            "--request-timeout", "300", "--live-sync-every", "5",
        ),
    ),
    Target(
        "qwen-2-5-7b-instruct-seed-2",
        "b7308123fc344420bafa3a6224d97be8",
        300,
        (
            sys.executable, "-m", "chessbench", "rate-model",
            "--model", "qwen-2.5-7b-instruct", "--seed", "2",
            "--target-rd", "77", "--no-capture-reasoning",
            "--max-output-tokens", "0", "--provider-only", "together",
            "--no-provider-fallbacks", "--require-provider-parameters",
            "--request-timeout", "300", "--live-sync-every", "5",
        ),
    ),
    Target(
        "claude-fable-5-medium-seed-0",
        "a323d23152314ba7b7ecbe69196dde0d",
        1800,
        (
            sys.executable, "-m", "chessbench", "rate-model",
            "--model", "claude-fable-5", "--seed", "0",
            "--reasoning", "medium", "--target-rd", "77",
            "--capture-reasoning", "--max-output-tokens", "0",
            "--provider-only", "google-vertex/global",
            "--no-provider-fallbacks", "--request-timeout", "1800",
            "--live-sync-every", "5",
        ),
    ),
    Target(
        "claude-fable-5-high-seed-0",
        "c3d3be427f2b427e8ef12255b4f9c388",
        1800,
        (
            sys.executable, "-m", "chessbench", "rate-model",
            "--model", "claude-fable-5", "--seed", "0",
            "--reasoning", "high", "--target-rd", "77",
            "--capture-reasoning", "--max-output-tokens", "0",
            "--provider-only", "google-vertex/global",
            "--no-provider-fallbacks", "--request-timeout", "1800",
            "--live-sync-every", "5",
        ),
    ),
    Target(
        "claude-opus-4-8-medium-seed-0",
        "524ac3ef1cd34a658451ee9785c05a30",
        1800,
        (
            sys.executable, "-m", "chessbench", "rate-model",
            "--model", "claude-opus-4.8", "--seed", "0",
            "--reasoning", "medium", "--target-rd", "77",
            "--capture-reasoning", "--max-output-tokens", "0",
            "--provider-only", "google-vertex/global",
            "--no-provider-fallbacks", "--request-timeout", "1800",
            "--live-sync-every", "5",
        ),
    ),
    Target(
        "deepseek-v4-flash-high-seed-0-handoff",
        "f8c5ad84915244d1bea030bc361d9275",
        900,
        (
            sys.executable, "-m", "chessbench", "rate-model",
            "--model", "deepseek-v4-flash", "--seed", "0",
            "--reasoning", "high", "--target-rd", "77",
            "--capture-reasoning", "--max-output-tokens", "0",
            "--provider-order", "deepseek",
            "--provider-order", "alibaba",
            "--provider-order", "novita",
            "--require-provider-parameters", "--request-timeout", "900",
            "--live-sync-every", "5",
        ),
    ),
    Target(
        "deepseek-v4-pro-high-seed-0",
        "fa480a187a2a4b66b96a8e416ff0cd74",
        900,
        (
            sys.executable, "-m", "chessbench", "rate-model",
            "--model", "deepseek-v4", "--seed", "0",
            "--reasoning", "high", "--target-rd", "77",
            "--capture-reasoning", "--max-output-tokens", "0",
            "--provider-only", "deepseek", "--no-provider-fallbacks",
            "--require-provider-parameters", "--request-timeout", "900",
            "--live-sync-every", "5",
        ),
    ),
    Target(
        "mercury-2-high-seed-0",
        "24dbce2a46164420a3c03c9a7d301a30",
        900,
        (
            sys.executable, "-m", "chessbench", "rate-model",
            "--model", "mercury-2", "--seed", "0",
            "--reasoning", "high", "--target-rd", "77",
            "--capture-reasoning", "--max-output-tokens", "0",
            "--provider-only", "inception", "--no-provider-fallbacks",
            "--require-provider-parameters", "--request-timeout", "900",
            "--live-sync-every", "5",
        ),
    ),
    Target(
        "gpt-5-6-terra-seed-1",
        "a9cce923213142c59867fa5a7554b5cc",
        900,
        (
            sys.executable, "-m", "chessbench", "rate-model",
            "--model", "gpt-5.6", "--seed", "1",
            "--reasoning", "high", "--target-rd", "77",
            "--capture-reasoning", "--max-output-tokens", "0",
            "--request-timeout", "900", "--live-sync-every", "5",
        ),
    ),
    Target(
        "gpt-5-6-luna-seed-0",
        "18a2f7bbc149461aba18b8172d954ab6",
        900,
        (
            sys.executable, "-m", "chessbench", "rate-model",
            "--model", "gpt-5.6-luna", "--seed", "0",
            "--reasoning", "high", "--target-rd", "77",
            "--capture-reasoning", "--max-output-tokens", "0",
            "--provider-only", "openai", "--no-provider-fallbacks",
            "--request-timeout", "900", "--live-sync-every", "5",
        ),
    ),
    Target(
        "gpt-5-6-luna-seed-1",
        "217a4d4506a44a628010c432f582439e",
        900,
        (
            sys.executable, "-m", "chessbench", "rate-model",
            "--model", "gpt-5.6-luna", "--seed", "1",
            "--reasoning", "high", "--target-rd", "77",
            "--capture-reasoning", "--max-output-tokens", "0",
            "--provider-only", "openai", "--no-provider-fallbacks",
            "--request-timeout", "900", "--live-sync-every", "5",
        ),
    ),
    Target(
        "gpt-5-4-nano-seed-0",
        "1b8a1c5808fa41ddac86c131bb4213d9",
        900,
        (
            sys.executable, "-m", "chessbench", "rate-model",
            "--model", "gpt-5.4-nano", "--seed", "0",
            "--reasoning", "high", "--target-rd", "77",
            "--capture-reasoning", "--max-output-tokens", "0",
            "--provider-only", "openai", "--no-provider-fallbacks",
            "--request-timeout", "900", "--live-sync-every", "5",
        ),
    ),
    Target(
        "gpt-5-4-nano-seed-1",
        "688041a436ac4aa1a5a829846cb49075",
        900,
        (
            sys.executable, "-m", "chessbench", "rate-model",
            "--model", "gpt-5.4-nano", "--seed", "1",
            "--reasoning", "high", "--target-rd", "77",
            "--capture-reasoning", "--max-output-tokens", "0",
            "--provider-only", "openai", "--no-provider-fallbacks",
            "--request-timeout", "900", "--live-sync-every", "5",
        ),
    ),
    Target(
        "qwen3-8b-high-seed-0",
        "e483873d98fa447c93a2f95dfc14f7bb",
        600,
        (
            sys.executable, "-m", "chessbench", "rate-model",
            "--model", "qwen3-8b", "--seed", "0",
            "--reasoning", "high", "--target-rd", "77",
            "--capture-reasoning", "--max-output-tokens", "0",
            "--provider-only", "alibaba", "--no-provider-fallbacks",
            "--require-provider-parameters", "--request-timeout", "600",
            "--live-sync-every", "5",
        ),
    ),
    Target(
        "qwen3-8b-none-seed-0",
        "b6a2119bc7d840aa956b63ee6024a52e",
        600,
        (
            sys.executable, "-m", "chessbench", "rate-model",
            "--model", "qwen3-8b", "--seed", "0",
            "--reasoning", "none", "--target-rd", "77",
            "--no-capture-reasoning", "--max-output-tokens", "0",
            "--provider-only", "alibaba", "--no-provider-fallbacks",
            "--require-provider-parameters", "--request-timeout", "600",
            "--live-sync-every", "5",
        ),
    ),
    Target(
        "gemini-3-1-pro-preview-high-seed-0",
        "6cd9e3f9552745cba1a1594f7b0b2730",
        900,
        (
            sys.executable, "-m", "chessbench", "rate-model",
            "--model", "gemini-3.1-pro-preview", "--seed", "0",
            "--reasoning", "high", "--target-rd", "77",
            "--capture-reasoning", "--max-output-tokens", "0",
            "--provider-only", "google-ai-studio",
            "--no-provider-fallbacks", "--require-provider-parameters",
            "--request-timeout", "900", "--live-sync-every", "5",
        ),
    ),
    Target(
        "gemini-3-1-pro-preview-high-seed-1",
        "0cf083dada7e49048a03834abf012846",
        900,
        (
            sys.executable, "-m", "chessbench", "rate-model",
            "--model", "gemini-3.1-pro-preview", "--seed", "1",
            "--reasoning", "high", "--target-rd", "77",
            "--capture-reasoning", "--max-output-tokens", "0",
            "--provider-only", "google-ai-studio",
            "--no-provider-fallbacks", "--require-provider-parameters",
            "--request-timeout", "900", "--live-sync-every", "5",
        ),
    ),
)


def parse_time(value: str | None) -> float:
    if not value:
        return 0.0
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def process_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except (OSError, ProcessLookupError):
        return False
    return True


def read_states(db_path: Path) -> dict[str, sqlite3.Row]:
    db = sqlite3.connect(db_path)
    db.row_factory = sqlite3.Row
    marks = ",".join("?" for _ in TARGETS)
    rows = db.execute(
        f"SELECT run_id, status, completed_items, updated_at, error "
        f"FROM benchmark_run WHERE run_id IN ({marks})",
        tuple(target.run_id for target in TARGETS),
    ).fetchall()
    db.close()
    return {str(row["run_id"]): row for row in rows}


def write_state(path: Path, children: dict[str, subprocess.Popen[bytes]]) -> None:
    payload = {
        "supervisor_pid": os.getpid(),
        "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "children": {name: process.pid for name, process in children.items()},
    }
    path.write_text(json.dumps(payload, indent=2) + "\n")


def spawn(target: Target, log_dir: Path) -> subprocess.Popen[bytes]:
    log_path = log_dir / f"{target.name}.log"
    log = log_path.open("ab", buffering=0)
    stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
    log.write(f"\n[{stamp}] supervisor starting worker\n".encode())
    return subprocess.Popen(
        target.command,
        cwd=ROOT,
        stdin=subprocess.DEVNULL,
        stdout=log,
        stderr=subprocess.STDOUT,
        start_new_session=True,
        close_fds=True,
    )


def sync_run(run_id: str, log) -> None:
    subprocess.run(
        [sys.executable, "scripts/sync_cloudflare.py", "--live", "--run", run_id],
        cwd=ROOT,
        stdin=subprocess.DEVNULL,
        stdout=log,
        stderr=subprocess.STDOUT,
        timeout=180,
        check=False,
    )


def supervise(args: argparse.Namespace) -> int:
    db_path = (ROOT / args.db).resolve()
    runtime = (ROOT / args.runtime_dir).resolve()
    runtime.mkdir(parents=True, exist_ok=True)
    pid_path = runtime / "supervisor.json"
    supervisor_log = (runtime / "supervisor.log").open("ab", buffering=0)
    children: dict[str, subprocess.Popen[bytes]] = {}
    retry_after: dict[str, float] = {}
    failures: dict[str, int] = {}
    next_sync = 0.0
    stopping = False

    def stop(_signum, _frame) -> None:
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    while not stopping:
        now = time.time()
        states = read_states(db_path)

        for name, process in list(children.items()):
            code = process.poll()
            if code is None:
                continue
            children.pop(name)
            failures[name] = failures.get(name, 0) + 1
            delay = min(30 * (2 ** (failures[name] - 1)), 300)
            retry_after[name] = now + delay
            supervisor_log.write(
                f"[{datetime.now(timezone.utc).isoformat()}] {name} exited {code}; "
                f"retry in {delay}s\n".encode()
            )

        complete = 0
        for target in TARGETS:
            row = states.get(target.run_id)
            if row is None:
                supervisor_log.write(f"missing run {target.run_id}\n".encode())
                continue
            status = str(row["status"])
            if status == "completed":
                complete += 1
                continue
            if target.name in children:
                continue
            if now < retry_after.get(target.name, 0.0):
                continue

            stale = now - parse_time(row["updated_at"])
            vanished = status == "running" and stale > target.request_timeout + args.grace_seconds
            resumable = status in {"partial", "queued"} or vanished
            if not resumable:
                continue

            children[target.name] = spawn(target, runtime)
            failures.setdefault(target.name, 0)
            supervisor_log.write(
                f"[{datetime.now(timezone.utc).isoformat()}] resumed {target.name} "
                f"at {row['completed_items']} durable items (status={status})\n".encode()
            )

        if now >= next_sync:
            for target in TARGETS:
                row = states.get(target.run_id)
                if row is not None and str(row["status"]) != "completed":
                    sync_run(target.run_id, supervisor_log)
            next_sync = now + args.sync_seconds

        write_state(pid_path, children)
        if complete == len(TARGETS):
            supervisor_log.write(b"all adaptive runs completed\n")
            return 0
        time.sleep(args.poll_seconds)

    write_state(pid_path, children)
    return 0


def launch_daemon(args: argparse.Namespace) -> int:
    runtime = (ROOT / args.runtime_dir).resolve()
    runtime.mkdir(parents=True, exist_ok=True)
    state_path = runtime / "supervisor.json"
    if state_path.exists():
        try:
            pid = int(json.loads(state_path.read_text())["supervisor_pid"])
        except (KeyError, TypeError, ValueError, json.JSONDecodeError):
            pid = 0
        if pid and process_alive(pid):
            print(f"adaptive supervisor already running as pid {pid}")
            return 0

    command = [sys.executable, str(Path(__file__).resolve())]
    for key in ("db", "runtime_dir", "poll_seconds", "sync_seconds", "grace_seconds"):
        command.extend((f"--{key.replace('_', '-')}", str(getattr(args, key))))
    log = (runtime / "launcher.log").open("ab", buffering=0)
    process = subprocess.Popen(
        command,
        cwd=ROOT,
        stdin=subprocess.DEVNULL,
        stdout=log,
        stderr=subprocess.STDOUT,
        start_new_session=True,
        close_fds=True,
    )
    print(f"started adaptive supervisor pid {process.pid}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default="runs/chessbench.db")
    parser.add_argument("--runtime-dir", default="runs/adaptive-supervisor")
    parser.add_argument("--poll-seconds", type=int, default=15)
    parser.add_argument("--sync-seconds", type=int, default=300)
    parser.add_argument("--grace-seconds", type=int, default=180)
    parser.add_argument("--daemon", action="store_true")
    args = parser.parse_args()
    if args.poll_seconds < 1 or args.sync_seconds < 1 or args.grace_seconds < 0:
        parser.error("poll/sync intervals must be positive and grace must be non-negative")
    return launch_daemon(args) if args.daemon else supervise(args)


if __name__ == "__main__":
    raise SystemExit(main())
