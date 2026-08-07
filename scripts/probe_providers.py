#!/usr/bin/env python3
"""Head-to-head provider reliability probe.

The rated campaign keeps dying on `provider returned no visible content
(finish=None)`, which is a stream that ended without a finish reason. That is a
provider/transport property, not a model property, so pick the provider on
measured evidence instead of price alone. Runs N identical high-reasoning puzzle
requests against each pinned provider and reports success rate, latency and
tokens.
"""
from __future__ import annotations

import argparse
import pathlib
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from chessbench.models import ModelError, OpenRouterModel  # noqa: E402
from chessbench.variants import ProviderRoute  # noqa: E402

PROMPT = (
    "You are a chess engine. Find the single best move for the side to move.\n\n"
    "FEN: r6k/pp2r2p/4Rp1Q/3p4/8/1N1P2b1/PqP3PP/7K w - - 0 25\n"
    "Side to move: White\n\nReply with the move in UCI."
)


def load_env() -> None:
    import os

    path = pathlib.Path(__file__).resolve().parent.parent / ".env"
    for line in path.read_text().splitlines():
        if "=" in line and not line.strip().startswith("#"):
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def probe(model: str, provider: str, effort: str, cap: int, n: int) -> dict[str, object]:
    lat: list[float] = []
    toks: list[int] = []
    errs: list[str] = []
    for _ in range(n):
        route = ProviderRoute(
            only=(provider,), allow_fallbacks=False, require_parameters=True
        )
        client = OpenRouterModel(
            model,
            reasoning_effort=effort,
            timeout=900,
            provider_preferences=route.to_request(),
        )
        start = time.time()
        try:
            out = client.generate(PROMPT, max_tokens=cap)
            lat.append(time.time() - start)
            toks.append(int((client.last_usage or {}).get("completion_tokens", 0) or 0))
            if not out.strip():
                errs.append("empty-but-no-error")
        except ModelError as exc:  # provider/transport failure
            errs.append(str(exc)[:70])
        except Exception as exc:  # noqa: BLE001 - surface unexpected client errors too
            errs.append(f"{type(exc).__name__}: {exc}"[:70])
    return {
        "provider": provider,
        "ok": len(lat),
        "fail": len(errs),
        "median_s": statistics.median(lat) if lat else None,
        "median_tok": statistics.median(toks) if toks else None,
        "errors": errs,
    }


def main() -> int:
    load_env()
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="deepseek/deepseek-v4-flash")
    ap.add_argument("--providers", default="baidu,streamlake,alibaba,deepseek")
    ap.add_argument("--effort", default="high")
    ap.add_argument("--cap", type=int, default=262144)
    ap.add_argument("--n", type=int, default=3)
    args = ap.parse_args()

    providers = [p.strip() for p in args.providers.split(",") if p.strip()]
    print(f"probing {args.model} · effort={args.effort} · cap={args.cap} · n={args.n}", flush=True)
    with ThreadPoolExecutor(max_workers=len(providers)) as pool:
        results = list(
            pool.map(lambda p: probe(args.model, p, args.effort, args.cap, args.n), providers)
        )

    results.sort(key=lambda r: (-int(r["ok"] or 0), r["median_s"] or 9e9))
    print(f"\n{'provider':14} {'ok':>3} {'fail':>5} {'median_s':>9} {'median_tok':>11}")
    for r in results:
        ms = f"{r['median_s']:.0f}" if r["median_s"] else "-"
        mt = f"{r['median_tok']:.0f}" if r["median_tok"] else "-"
        print(f"  {r['provider']:12} {r['ok']:>3} {r['fail']:>5} {ms:>9} {mt:>11}")
    for r in results:
        for e in r["errors"]:
            print(f"    {r['provider']}: {e}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
