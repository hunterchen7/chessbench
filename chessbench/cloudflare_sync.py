"""Idempotent delivery of durable local benchmark runs to Cloudflare D1."""

from __future__ import annotations

import base64
import hashlib
import json
import urllib.error
import urllib.request
from collections.abc import Callable

from .database import BenchmarkStore

PostDocument = Callable[[str, str, str, dict[str, object]], dict[str, object]]

RUN_ITEM_PAYLOAD_INLINE_BYTES = 512 * 1024
RUN_ITEM_PAYLOAD_CHUNK_BYTES = 128 * 1024
RUN_ITEM_PAYLOAD_BATCH_RAW_BYTES = 16 * 1024 * 1024
RUN_ITEM_PAYLOAD_ENCODING = "json-utf8-base64-v1"


class CloudflareHTTPError(OSError):
    """An ingest response that preserves the Worker's safe diagnostic body."""

    def __init__(self, status: int, reason: str, body: str) -> None:
        detail = body.strip() or reason
        super().__init__(f"HTTP {status}: {detail}")
        self.status = status
        self.body = body


def run_item_delivery_documents(
    item: dict[str, object],
) -> list[tuple[str, dict[str, object]]]:
    """Return an inline delivery or idempotent chunks followed by its item row."""
    payload = item.get("payload")
    if not isinstance(payload, dict):
        return [("ingest/run/item", item)]
    payload_bytes = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    if len(payload_bytes) <= RUN_ITEM_PAYLOAD_INLINE_BYTES:
        return [("ingest/run/item", item)]
    if len(payload_bytes) > RUN_ITEM_PAYLOAD_BATCH_RAW_BYTES:
        raise ValueError(
            f"run item payload is {len(payload_bytes)} bytes; "
            f"maximum is {RUN_ITEM_PAYLOAD_BATCH_RAW_BYTES}"
        )

    digest = hashlib.sha256(payload_bytes).hexdigest()
    chunks = [
        payload_bytes[offset : offset + RUN_ITEM_PAYLOAD_CHUNK_BYTES]
        for offset in range(0, len(payload_bytes), RUN_ITEM_PAYLOAD_CHUNK_BYTES)
    ]
    run_id = str(item["run_id"])
    item_id = str(item["item_id"])
    deliveries: list[tuple[str, dict[str, object]]] = [
        (
            "ingest/run/item/chunks",
            {
                "run_id": run_id,
                "item_id": item_id,
                "payload_sha256": digest,
                "chunk_count": len(chunks),
                "chunks": [
                    {
                        "chunk_index": index,
                        "payload_chunk": base64.b64encode(chunk).decode("ascii"),
                    }
                    for index, chunk in enumerate(chunks)
                ],
            },
        )
    ]
    final_item = {key: value for key, value in item.items() if key != "payload"}
    final_item["payload_chunks"] = {
        "version": 1,
        "encoding": RUN_ITEM_PAYLOAD_ENCODING,
        "sha256": digest,
        "byte_length": len(payload_bytes),
        "chunk_count": len(chunks),
    }
    deliveries.append(("ingest/run/item", final_item))
    return deliveries


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
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        # urllib's default string drops the response body, which is where the
        # Worker explains validation and D1 failures. The body cannot contain
        # the bearer token because it is supplied only as a request header.
        body = exc.read().decode("utf-8", errors="replace")
        raise CloudflareHTTPError(exc.code, str(exc.reason), body) from exc


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
            for path, document in run_item_delivery_documents(item):
                post_document(api, token, path, document)
        except (
            urllib.error.URLError,
            TimeoutError,
            OSError,
            ValueError,
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
