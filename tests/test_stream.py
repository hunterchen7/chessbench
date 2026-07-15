"""Failure semantics for best-effort live streaming and strict final publish."""

from __future__ import annotations

import pytest

from chessbench.stream import StreamPusher


def test_final_publish_failure_is_actionable_and_resumable(monkeypatch):
    pusher = StreamPusher(
        "https://example.invalid",
        "token",
        "tournament-a",
        condition_slug="condition",
        players=["a", "b"],
        created="2026-01-01T00:00:00+00:00",
    )
    monkeypatch.setattr(pusher, "_post", lambda *_args, **_kwargs: False)

    with pytest.raises(RuntimeError, match="rerun the same --stream command"):
        pusher.push_final({"schema": "chessbench.tournament.v1"})
