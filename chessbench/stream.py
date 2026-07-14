"""Stream a tournament into the persistent backend as it plays.

Instead of writing one atomic tournament document at the very end (lost entirely
if the run dies), a StreamPusher POSTs each completed game to `/api/ingest/game`
and snapshots the in-progress board to `/api/live/board` per move. The tournament
is durable after every game and the web viewer can watch it live. All posts are
best-effort: a failed post is logged and ignored, never interrupting the games.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from dataclasses import asdict
from typing import TYPE_CHECKING

import chess

if TYPE_CHECKING:
    from .tasks.games import GameRecord, MoveRecord


def _move_dict(m: MoveRecord) -> dict[str, object]:
    return {
        "ply": m.ply, "color": m.color, "san": m.san, "uci": m.uci,
        "first_attempt_legal": m.first_attempt_legal, "illegal_attempts": m.illegal_attempts,
        "eval_cp": m.eval_cp, "forfeited": m.forfeited,
        "attempts": [asdict(attempt) for attempt in m.attempts],
        "prompt_tokens": sum(a.prompt_tokens for a in m.attempts),
        "completion_tokens": sum(a.completion_tokens for a in m.attempts),
        "reasoning_tokens": sum(a.reasoning_tokens for a in m.attempts),
        "cost_usd": sum(a.cost_usd for a in m.attempts),
    }


def _game_dict(record: GameRecord, idx: int) -> dict[str, object]:
    return {
        "idx": idx, "white": record.white, "black": record.black,
        "result": record.result, "termination": record.termination, "plies": record.plies,
        "pgn": record.pgn, "start_fen": record.start_fen,
        "moves": [_move_dict(m) for m in record.records],
    }


class StreamPusher:
    def __init__(self, base_url: str, token: str, tid: str, *,
                 condition_slug: str, players: list[str], created: str,
                 min_board_interval: float = 0.2) -> None:
        self.base = base_url.rstrip("/")
        self.token = token
        self.tid = tid
        self.condition_slug = condition_slug
        self.players = players
        self.created = created
        self._min_interval = min_board_interval
        self._last_board = 0.0

    def _post(self, path: str, payload: dict[str, object], *, timeout: float = 8.0) -> None:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{self.base}{path}", data=data, method="POST",
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {self.token}",
                     "User-Agent": "chessbench-stream/1.0"},  # non-default UA dodges Cloudflare 1010
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout):
                pass
        except (urllib.error.URLError, TimeoutError, OSError) as e:  # best-effort; never break the games
            print(f"[stream] {path} failed: {type(e).__name__}: {e}", flush=True)

    def on_game(self, record: GameRecord, idx: int) -> None:
        self._last_board = 0.0  # allow the next game's first board snapshot immediately
        self._post("/api/ingest/game", {
            "tid": self.tid, "created": self.created,
            "condition_slug": self.condition_slug, "players": self.players,
            "game": _game_dict(record, idx),
        })

    def push_final(self, doc: dict[str, object]) -> None:
        """Land the final tournament doc (Bradley-Terry standings) so the live view
        flips to the finished, rated table."""
        self._post(f"/api/ingest/tournament?id={self.tid}", doc, timeout=30.0)

    def on_move(self, white: str, black: str, start_fen: str | None, idx: int,
                board: chess.Board, records: list[MoveRecord]) -> None:
        now = time.monotonic()
        if now - self._last_board < self._min_interval:
            return  # throttle: don't flood on instant engine moves
        self._last_board = now
        self._post("/api/live/board", {"tid": self.tid, "game": {
            "white": white, "black": black, "idx": idx, "start_fen": start_fen,
            "fen": board.fen(), "plies": len(records), "moves": [_move_dict(m) for m in records],
        }})
