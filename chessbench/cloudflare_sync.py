"""Idempotent delivery of durable local benchmark runs to Cloudflare D1."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from collections.abc import Callable

from .database import BenchmarkStore

PostDocument = Callable[[str, str, str, dict[str, object]], dict[str, object]]


def post(
    api: str, token: str, path: str, document: dict[str, object]
) -> dict[str, object]:
    request = urllib.request.Request(
        f"{api.rstrip('/')}/api/{path}",
        data=json.dumps(document).encode(),
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "chessbench-sync/2",
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def sync_run(
    store: BenchmarkStore,
    api: str,
    token: str,
    run_id: str,
    *,
    post_document: PostDocument = post,
) -> tuple[int, int]:
    """Deliver one run, retaining failed items in the durable local outbox."""
    post_document(api, token, "ingest/run/start", store.run_start_document(run_id))
    sent = 0
    failed = 0
    for item in store.unsynced_item_documents(run_id):
        try:
            post_document(api, token, "ingest/run/item", item)
        except (
            urllib.error.URLError,
            TimeoutError,
            OSError,
            json.JSONDecodeError,
        ) as exc:
            print(f"  {run_id}/{item['item_id']}: {type(exc).__name__}: {exc}")
            failed += 1
            continue
        store.mark_item_synced(run_id, str(item["item_id"]))
        sent += 1
    if failed == 0:
        post_document(
            api, token, "ingest/run/finish", store.run_finish_document(run_id)
        )
    return sent, failed
