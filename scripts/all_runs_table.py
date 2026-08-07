#!/usr/bin/env python3
"""Every benchmark run as one table: rating, deviation, solve rate, tokens, cost.

Reads the local DB only. Rating comes from summary_json once a run finishes; an
in-flight run has no rating there yet and shows "-" rather than a stale or
invented number.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sqlite3

REPO = pathlib.Path(__file__).resolve().parent.parent


def rating_of(summary: str | None) -> tuple[float | None, float | None, int | None, float | None]:
    if not summary:
        return None, None, None, None
    try:
        doc = json.loads(summary) or {}
    except json.JSONDecodeError:
        return None, None, None, None
    block = doc.get("puzzle_performance_rating") or {}
    return (
        block.get("rating"),
        block.get("rating_deviation"),
        doc.get("solved"),
        doc.get("solve_rate"),
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--suite", default=None, help="limit to one suite")
    ap.add_argument("--sort", default="rating", choices=["rating", "cost", "model"])
    ap.add_argument("--min-items", type=int, default=0)
    args = ap.parse_args()

    con = sqlite3.connect(f"file:{REPO/'runs/chessbench.db'}?mode=ro", uri=True)
    sql = """SELECT variant_key, suite_name, status, completed_items, total_items,
                    cost_usd, prompt_tokens, completion_tokens, reasoning_tokens,
                    summary_json, json_extract(protocol_json,'$.selection.seed') AS seed
             FROM benchmark_run"""
    params: tuple = ()
    if args.suite:
        sql += " WHERE suite_name=?"
        params = (args.suite,)
    rows = []
    for (vk, suite, status, done, total, cost, ptok, ctok, rtok, summary, seed) in con.execute(sql, params):
        if done < args.min_items:
            continue
        rating, rd, solved, rate = rating_of(summary)
        name = vk.split("--")[0]
        effort = next(
            (p[2:].removesuffix("-captured") for p in vk.split("--") if p.startswith("r-")),
            "-",
        )
        rows.append({
            "model": name, "effort": effort, "seed": seed, "suite": suite or "-",
            "status": status, "done": done, "total": total, "rating": rating, "rd": rd,
            "solved": solved, "rate": rate,
            "tokens": int((ptok or 0) + (ctok or 0)), "reasoning": int(rtok or 0),
            "cost": cost or 0.0,
        })

    keys = {
        "rating": lambda r: (-(r["rating"] or -1), r["model"]),
        "cost": lambda r: -r["cost"],
        "model": lambda r: (r["model"], r["effort"], str(r["seed"])),
    }
    rows.sort(key=keys[args.sort])

    hdr = (f"{'model':26} {'effort':8} {'sd':>3} {'suite':20} {'done':>7} "
           f"{'rating':>7} {'RD':>5} {'solved':>7} {'tokens':>11} {'reasoning':>11} {'cost':>8}  status")
    print(hdr)
    print("-" * len(hdr))
    for r in rows:
        solved = f"{r['solved']}/{r['done']}" if r["solved"] is not None else "-"
        rating = f"{r['rating']:.0f}" if r["rating"] else "-"
        rd = f"{r['rd']:.0f}" if r["rd"] else "-"
        seed = str(r["seed"]) if r["seed"] is not None else "-"
        prog = f"{r['done']}/{r['total']}"
        cost = "$" + format(r["cost"], ".2f")
        print(
            f"{r['model'][:26]:26} {r['effort'][:8]:8} {seed:>3} "
            f"{r['suite'][:20]:20} {prog:>7} {rating:>7} {rd:>5} {solved:>7} "
            f"{r['tokens']:>11,} {r['reasoning']:>11,} {cost:>8}  {r['status']}"
        )
    print(f"\n{len(rows)} runs · {sum(r['done'] for r in rows):,} puzzles · "
          f"{sum(r['tokens'] for r in rows):,} tokens · ${sum(r['cost'] for r in rows):,.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
