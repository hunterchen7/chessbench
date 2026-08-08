#!/usr/bin/env python3
"""Keep rated runs alive until they reach their puzzle minimum.

Rated runs die on transient provider faults -- most often `provider returned no
visible content (finish=None)`, a stream that ended without a finish reason.
`rate-model` resumes a partial run in place, so the recovery is simply to launch
it again; what was missing is something that does that unattended.

Unlike scripts/supervise_adaptive_runs.py, the run set here is data, not a
hard-coded TARGETS tuple, so the same supervisor drives any campaign.

Usage:
    python3 scripts/keepalive.py --spec runs/keepalive-<campaign>.json [--max-restarts 20]

Spec: {"defaults": {...}, "runs": [{"label": ..., "model": ..., "reasoning": ...,
       "seed": 0, "max_output_tokens": 0, "provider_only": ["alibaba"], ...}]}
Any defaults key is overridable per run.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timezone

REPO = pathlib.Path(__file__).resolve().parent.parent


def now() -> str:
    return datetime.now(timezone.utc).strftime("%FT%TZ")


def load_env() -> None:
    for line in (REPO / ".env").read_text().splitlines():
        if "=" in line and not line.strip().startswith("#"):
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def build_cmd(run: dict, defaults: dict) -> list[str]:
    cfg = {**defaults, **run}
    cmd = [
        sys.executable, "-m", "chessbench", "rate-model",
        "--model", str(cfg["model"]),
        "--reasoning", str(cfg["reasoning"]),
        "--seed", str(cfg.get("seed", 0)),
        "--target-rd", str(cfg.get("target_rd", 77)),
        "--min-puzzles", str(cfg.get("min_puzzles", 50)),
        "--max-puzzles", str(cfg.get("max_puzzles", 100)),
        "--max-output-tokens", str(cfg.get("max_output_tokens", 0)),
        "--request-timeout", str(cfg.get("request_timeout", 1800)),
        "--request-total-timeout", str(cfg.get("request_total_timeout", 7200)),
        "--capture-reasoning", "--live-sync-every", str(cfg.get("live_sync_every", 5)),
        "--db", str(cfg.get("db", "runs/chessbench.db")),
        "--out-dir", str(cfg.get("out_dir", "runs/exports")),
        "--progress", "1",
    ]
    for provider in cfg.get("provider_only", []) or []:
        cmd += ["--provider-only", str(provider)]
    for provider in cfg.get("provider_order", []) or []:
        cmd += ["--provider-order", str(provider)]
    if cfg.get("no_provider_fallbacks", True) and cfg.get("provider_only"):
        cmd.append("--no-provider-fallbacks")
    if cfg.get("require_provider_parameters", True):
        cmd.append("--require-provider-parameters")
    return cmd


def completed(db: pathlib.Path, model: str, reasoning: str, seed: int) -> int:
    """Best-effort progress read; the run row is keyed by variant, not label."""
    if not db.exists():
        return 0
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        row = con.execute(
            "SELECT MAX(completed_items) FROM benchmark_run "
            "WHERE variant_key LIKE ? AND json_extract(protocol_json,'$.selection.seed')=?",
            (f"%{model.replace('.', '-')}--r-{reasoning}%", seed),
        ).fetchone()
        con.close()
        return int(row[0] or 0) if row else 0
    except sqlite3.Error:
        return 0


def supervise(spec_path: pathlib.Path, max_restarts: int, poll: int, max_concurrent: int) -> int:
    spec = json.loads(spec_path.read_text())
    defaults, runs = spec.get("defaults", {}), spec["runs"]
    logdir = REPO / "runs" / "adaptive-supervisor"
    logdir.mkdir(parents=True, exist_ok=True)
    db = REPO / defaults.get("db", "runs/chessbench.db")

    state = {
        r["label"]: {"restarts": 0, "proc": None, "done": False, "run": r} for r in runs
    }
    print(f"[{now()}] keepalive: {len(runs)} run(s), max_restarts={max_restarts}", flush=True)

    while True:
        alive = 0
        # Count live children first: a concurrency cap has to be enforced against
        # what is actually running, not what this pass has launched so far.
        running_now = sum(
            1 for s in state.values()
            if not s["done"] and s["proc"] is not None and s["proc"].poll() is None
        )
        for label, st in state.items():
            if st["done"]:
                continue
            run = st["run"]
            cfg = {**defaults, **run}
            proc = st["proc"]

            if proc is not None and proc.poll() is None:
                alive += 1
                continue

            if max_concurrent and running_now >= max_concurrent:
                # Slot-limited: leave this run for a later pass rather than
                # piling every spec entry onto the provider at once.
                alive += 1
                continue

            done_n = completed(db, str(cfg["model"]), str(cfg["reasoning"]), int(cfg.get("seed", 0)))
            target = int(cfg.get("min_puzzles", 50))
            if done_n >= target:
                st["done"] = True
                print(f"[{now()}] {label}: COMPLETE ({done_n}/{target})", flush=True)
                continue
            if st["restarts"] >= max_restarts:
                st["done"] = True
                print(f"[{now()}] {label}: GAVE UP at {done_n}/{target} after {max_restarts} restarts", flush=True)
                continue

            if proc is not None:
                st["restarts"] += 1
                time.sleep(min(60, 5 * st["restarts"]))  # brief backoff after a fault
            log = logdir / f"{label}.keepalive.log"
            with log.open("a") as fh:
                fh.write(f"\n[{now()}] launch #{st['restarts']} (at {done_n}/{target})\n")
                # Unbuffered: the child's per-puzzle progress line carries the only
                # live rating/RD (summary_json is written at completion), and block
                # buffering to a file otherwise hides it for thousands of tokens.
                st["proc"] = subprocess.Popen(
                    build_cmd(run, defaults),
                    cwd=REPO,
                    stdout=fh,
                    stderr=subprocess.STDOUT,
                    env={**os.environ, "PYTHONUNBUFFERED": "1"},
                )
            print(f"[{now()}] {label}: launch #{st['restarts']} at {done_n}/{target} pid={st['proc'].pid}", flush=True)
            alive += 1
            running_now += 1

        if all(s["done"] for s in state.values()):
            print(f"[{now()}] keepalive: all runs settled", flush=True)
            return 0
        time.sleep(poll)


def main() -> int:
    load_env()
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", required=True)
    ap.add_argument("--max-restarts", type=int, default=20)
    ap.add_argument("--poll", type=int, default=30)
    ap.add_argument("--max-concurrent", type=int, default=0,
                    help="cap simultaneously running children (0 = unlimited)")
    args = ap.parse_args()
    return supervise(pathlib.Path(args.spec), args.max_restarts, args.poll, args.max_concurrent)


if __name__ == "__main__":
    raise SystemExit(main())
