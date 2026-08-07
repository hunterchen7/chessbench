"""Idempotent delivery of durable local benchmark runs to Cloudflare D1."""

from __future__ import annotations

import base64
import copy
import hashlib
import json
import urllib.error
import urllib.request
from collections.abc import Callable

from .database import BenchmarkStore

PostDocument = Callable[[str, str, str, dict[str, object]], dict[str, object]]

RUN_ITEM_PAYLOAD_INLINE_BYTES = 512 * 1024
RUN_ITEM_PAYLOAD_CHUNK_BYTES = 128 * 1024
RUN_ITEM_PAYLOAD_BATCH_RAW_BYTES = 32 * 1024 * 1024
# Prefer smaller published audits so one Worker request stays reliable.
RUN_ITEM_PAYLOAD_PUBLISH_TARGET_BYTES = 8 * 1024 * 1024
RUN_ITEM_PAYLOAD_ENCODING = "json-utf8-base64-v1"
_MAX_PUBLISH_STRING_BYTES = 256 * 1024


class CloudflareHTTPError(OSError):
    """An ingest response that preserves the Worker's safe diagnostic body."""

    def __init__(self, status: int, reason: str, body: str) -> None:
        detail = body.strip() or reason
        super().__init__(f"HTTP {status}: {detail}")
        self.status = status
        self.body = body


def _payload_bytes(payload: dict[str, object]) -> bytes:
    return json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")


def _drop_keys(value: object, keys: frozenset[str]) -> None:
    if isinstance(value, dict):
        for key in keys:
            value.pop(key, None)
        for child in value.values():
            _drop_keys(child, keys)
    elif isinstance(value, list):
        for child in value:
            _drop_keys(child, keys)


def _truncate_long_strings(value: object, *, max_bytes: int) -> None:
    if isinstance(value, dict):
        for key, child in list(value.items()):
            if isinstance(child, str):
                encoded = child.encode("utf-8")
                if len(encoded) > max_bytes:
                    half = max_bytes // 2
                    digest = hashlib.sha256(encoded).hexdigest()
                    prefix = encoded[:half].decode("utf-8", "replace")
                    suffix = encoded[-half:].decode("utf-8", "replace")
                    value[key] = (
                        prefix
                        + f"\n...[publish truncated; bytes={len(encoded)}; "
                        + f"sha256={digest}]...\n"
                        + suffix
                    )
            else:
                _truncate_long_strings(child, max_bytes=max_bytes)
    elif isinstance(value, list):
        for child in value:
            _truncate_long_strings(child, max_bytes=max_bytes)


def compact_run_item_payload_for_publish(
    payload: dict[str, object],
    *,
    max_bytes: int = RUN_ITEM_PAYLOAD_PUBLISH_TARGET_BYTES,
    hard_max_bytes: int = RUN_ITEM_PAYLOAD_BATCH_RAW_BYTES,
) -> dict[str, object]:
    """Return a D1-bounded copy. Local SQLite keeps the full audit payload."""
    payload_bytes = _payload_bytes(payload)
    if len(payload_bytes) <= max_bytes:
        return payload

    compacted = copy.deepcopy(payload)
    stages: list[tuple[str, Callable[[dict[str, object]], None]]] = [
        (
            "drop_provider_response_raw",
            lambda doc: _drop_keys(doc, frozenset({"provider_response_raw"})),
        ),
        (
            "drop_request_payload",
            lambda doc: _drop_keys(doc, frozenset({"request_payload"})),
        ),
        (
            "drop_provider_response",
            lambda doc: _drop_keys(doc, frozenset({"provider_response"})),
        ),
        (
            "drop_reasoning_details",
            lambda doc: _drop_keys(doc, frozenset({"reasoning_details"})),
        ),
        (
            "truncate_long_strings",
            lambda doc: _truncate_long_strings(
                doc, max_bytes=_MAX_PUBLISH_STRING_BYTES
            ),
        ),
    ]
    applied: list[str] = []
    original_bytes = len(payload_bytes)
    for name, apply in stages:
        apply(compacted)
        applied.append(name)
        payload_bytes = _payload_bytes(compacted)
        if len(payload_bytes) <= max_bytes:
            compacted["publish_compaction"] = {
                "original_bytes": original_bytes,
                "published_bytes": len(payload_bytes),
                "stages": applied,
            }
            return compacted

    if len(payload_bytes) <= hard_max_bytes:
        compacted["publish_compaction"] = {
            "original_bytes": original_bytes,
            "published_bytes": len(payload_bytes),
            "stages": applied,
        }
        return compacted

    raise ValueError(
        f"run item payload is {original_bytes} bytes; "
        f"still {len(payload_bytes)} after publish compaction; "
        f"maximum is {hard_max_bytes}"
    )


def run_item_delivery_documents(
    item: dict[str, object],
) -> list[tuple[str, dict[str, object]]]:
    """Return an inline delivery or idempotent chunks followed by its item row."""
    payload = item.get("payload")
    if not isinstance(payload, dict):
        return [("ingest/run/item", item)]
    publish_payload = compact_run_item_payload_for_publish(payload)
    payload_bytes = _payload_bytes(publish_payload)
    delivery_item = (
        item
        if publish_payload is payload
        else {**item, "payload": publish_payload}
    )
    if len(payload_bytes) <= RUN_ITEM_PAYLOAD_INLINE_BYTES:
        return [("ingest/run/item", delivery_item)]

    digest = hashlib.sha256(payload_bytes).hexdigest()
    chunks = [
        payload_bytes[offset : offset + RUN_ITEM_PAYLOAD_CHUNK_BYTES]
        for offset in range(0, len(payload_bytes), RUN_ITEM_PAYLOAD_CHUNK_BYTES)
    ]
    run_id = str(item["run_id"])
    item_id = str(item["item_id"])
    # Small chunked payloads go in one request. Near the 32 MiB ceiling, post
    # chunks individually so the Worker stays under request/CPU limits.
    deliveries: list[tuple[str, dict[str, object]]] = []
    if len(payload_bytes) <= RUN_ITEM_PAYLOAD_CHUNK_BYTES * 32:
        deliveries.append(
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
                            "payload_chunk": base64.b64encode(chunk).decode(
                                "ascii"
                            ),
                        }
                        for index, chunk in enumerate(chunks)
                    ],
                },
            )
        )
    else:
        for index, chunk in enumerate(chunks):
            deliveries.append(
                (
                    "ingest/run/item/chunk",
                    {
                        "run_id": run_id,
                        "item_id": item_id,
                        "payload_sha256": digest,
                        "chunk_index": index,
                        "chunk_count": len(chunks),
                        "payload_chunk": base64.b64encode(chunk).decode("ascii"),
                    },
                )
            )
    final_item = {
        key: value for key, value in delivery_item.items() if key != "payload"
    }
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
        with urllib.request.urlopen(request, timeout=300) as response:
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
    finish: bool = True,
) -> tuple[int, int]:
    """Deliver one run, optionally leaving the remote row live and running."""
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
    if finish and failed == 0:
        post_document(
            api, token, "ingest/run/finish", store.run_finish_document(run_id)
        )
    return sent, failed
