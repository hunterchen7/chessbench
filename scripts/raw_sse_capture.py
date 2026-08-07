#!/usr/bin/env python3
"""Capture a raw OpenRouter SSE stream, bypassing the chessbench client.

Runs die on `provider returned no visible content (finish=None, native=None)`.
That message is ambiguous: it is what a truncated provider stream looks like,
but it is also what a client-side parsing bug would look like. This sends the
same request body the benchmark sends and reports the stream as received --
event counts, whether any content/reasoning arrived, whether a finish_reason
ever appeared, and whether the stream terminated with [DONE] -- so the two
explanations can be told apart from evidence.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys
import time
import urllib.request

REPO = pathlib.Path(__file__).resolve().parent.parent


def load_env() -> None:
    for line in (REPO / ".env").read_text().splitlines():
        if "=" in line and not line.strip().startswith("#"):
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


PROMPT = (
    "You are a chess engine. Find the single best move for the side to move.\n\n"
    "FEN: r6k/pp2r2p/4Rp1Q/3p4/8/1N1P2b1/PqP3PP/7K w - - 0 25\n"
    "Side to move: White\n\nReply with the move in UCI."
)


def main() -> int:
    load_env()
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="qwen/qwen3.8-max")
    ap.add_argument("--provider", default="alibaba")
    ap.add_argument("--effort", default="xhigh")
    ap.add_argument("--cap", type=int, default=131072)
    ap.add_argument("--dump", default="")
    args = ap.parse_args()

    payload = {
        "model": args.model,
        "messages": [{"role": "user", "content": PROMPT}],
        "temperature": 0.0,
        "stream": True,
        "stream_options": {"include_usage": True},
        "max_tokens": args.cap,
        "reasoning": {"effort": args.effort, "exclude": False},
        "provider": {
            "only": [args.provider],
            "allow_fallbacks": False,
            "require_parameters": True,
        },
    }
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {os.environ['OPENROUTER_API_KEY']}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/chessbench",
            "X-Title": "chessbench",
        },
    )

    stats = {
        "events": 0, "comments": 0, "content_chunks": 0, "reasoning_chunks": 0,
        "finish_reason": None, "native_finish_reason": None, "saw_done": False,
        "usage": None, "error": None, "id": None, "provider": None,
    }
    content: list[str] = []
    raw_lines: list[str] = []
    start = time.time()
    try:
        with urllib.request.urlopen(req, timeout=1800) as resp:
            print(f"HTTP {resp.status} content-type={resp.headers.get('Content-Type')}", flush=True)
            for raw in resp:
                line = raw.decode("utf-8", "replace")
                raw_lines.append(line)
                s = line.rstrip("\r\n")
                if not s:
                    continue
                if s.startswith(":"):
                    stats["comments"] += 1
                    continue
                if not s.startswith("data:"):
                    continue
                body = s[5:].strip()
                if body == "[DONE]":
                    stats["saw_done"] = True
                    continue
                try:
                    ev = json.loads(body)
                except json.JSONDecodeError:
                    continue
                stats["events"] += 1
                for k in ("id", "provider", "usage", "error"):
                    if ev.get(k) is not None:
                        stats[k] = ev[k]
                ch = (ev.get("choices") or [{}])[0]
                if ch.get("finish_reason") is not None:
                    stats["finish_reason"] = ch["finish_reason"]
                if ch.get("native_finish_reason") is not None:
                    stats["native_finish_reason"] = ch["native_finish_reason"]
                delta = ch.get("delta") or ch.get("message") or {}
                if isinstance(delta.get("content"), str) and delta["content"]:
                    stats["content_chunks"] += 1
                    content.append(delta["content"])
                if isinstance(delta.get("reasoning"), str) and delta["reasoning"]:
                    stats["reasoning_chunks"] += 1
    except Exception as exc:  # noqa: BLE001 - the failure itself is the datum
        print(f"\nTRANSPORT EXCEPTION after {time.time()-start:.0f}s: {type(exc).__name__}: {exc}", flush=True)

    print(f"\nelapsed {time.time()-start:.0f}s")
    print(json.dumps(stats, indent=1)[:1200])
    print(f"content ({len(''.join(content))} chars): {''.join(content)[:200]!r}")
    verdict = (
        "PROVIDER TRUNCATION (no finish_reason, no [DONE])"
        if stats["finish_reason"] is None and not stats["saw_done"]
        else "STREAM COMPLETED NORMALLY"
    )
    print(f"VERDICT: {verdict}")
    if args.dump:
        pathlib.Path(args.dump).write_text("".join(raw_lines))
        print(f"raw stream -> {args.dump} ({len(raw_lines)} lines)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
