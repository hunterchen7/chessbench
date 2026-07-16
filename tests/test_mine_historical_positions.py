from __future__ import annotations

import json
import pathlib

import chess
import chess.engine

from scripts.mine_historical_positions import (
    Source,
    apply_deterministic_split,
    document_for_split,
    load_source_catalog,
    mine,
    select_candidates,
)
from scripts.validate_historical_candidates import _validate_documents


class _FakeEngine:
    id = {"name": "Deterministic Fake 1", "author": "tests"}
    options = {"Threads": object(), "Hash": object(), "Clear Hash": object()}

    def __init__(self) -> None:
        self.configurations: list[dict[str, object]] = []
        self.nodes: list[int] = []

    def configure(self, options: dict[str, object]) -> None:
        self.configurations.append(options)

    def analyse(self, board: chess.Board, limit: chess.engine.Limit, *, multipv: int):
        self.nodes.append(limit.nodes or 0)
        infos = []
        for rank, first in enumerate(
            sorted(board.legal_moves, key=lambda move: move.uci())[:multipv], 1
        ):
            replay = board.copy(stack=False)
            pv = [first]
            replay.push(first)
            while len(pv) < 5 and not replay.is_game_over(claim_draw=False):
                move = sorted(replay.legal_moves, key=lambda item: item.uci())[0]
                pv.append(move)
                replay.push(move)
            infos.append(
                {
                    "multipv": rank,
                    "pv": pv,
                    "score": chess.engine.PovScore(
                        chess.engine.Cp(500 - rank * 100), board.turn
                    ),
                }
            )
        return infos


def _write_pgn(path: pathlib.Path) -> None:
    path.write_text(
        """[Event \"Test Championship\"]
[Site \"Toronto\"]
[Date \"2026.07.15\"]
[Round \"1\"]
[White \"Alpha\"]
[Black \"Beta\"]
[Result \"1-0\"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 1-0
""",
        encoding="utf-8",
    )


def test_miner_emits_validator_compatible_deduplicated_candidates(
    tmp_path: pathlib.Path,
):
    pgn = tmp_path / "games.pgn"
    _write_pgn(pgn)
    source = Source(pgn, "https://example.test/games.pgn", "Test games", "championship")
    engine = _FakeEngine()

    document = mine(
        [source, source],
        engine=engine,
        engine_path=pathlib.Path("fakefish"),
        nodes=12_345,
        multipv=3,
        line_plies=5,
        min_ply=1,
        scan_limit=8,
        limit=1,
        per_event=6,
        heldout_count=0,
        quiet_min_top_two_gap_cp=100,
    )
    output = tmp_path / "candidates.json"
    output.write_text(json.dumps(document), encoding="utf-8")
    report = _validate_documents([output])

    assert report["valid"] is True, report["errors"]
    assert document["candidate_count"] == 1
    assert report["unique_positions"] == 1
    assert all(
        item["engine_derived"] is True and item["forced"] is False
        for item in document["candidates"]
    )
    assert all(
        len(item["moves"]) == 5 and item["solver_plies"] == 3
        for item in document["candidates"]
    )
    assert all("not proof" in item["line_note"] for item in document["candidates"])
    assert all(
        item["engine_evidence"]["fixed_nodes"] == 12_345
        for item in document["candidates"]
    )
    assert sum(item["split"] == "held_out" for item in document["candidates"]) == 0
    assert all(
        str(item["split_key"]).startswith("sha256:") for item in document["candidates"]
    )
    assert engine.nodes and set(engine.nodes) == {12_345}
    assert {"Threads": 1, "Hash": 64} in engine.configurations
    assert {"Clear Hash": None} in engine.configurations


def test_selection_is_deterministic_and_honors_band_category_event_caps():
    candidates = []
    for band in ("easy", "medium", "hard"):
        for category in ("world", "open"):
            for event in ("Event A", "Event B"):
                for number in range(3):
                    candidates.append(
                        {
                            "id": f"{band}-{category}-{event}-{number}",
                            "difficulty_band": band,
                            "source_category": category,
                            "event": event,
                            "white": "Alpha",
                            "black": "Beta",
                            "date": "2026-01-01",
                        }
                    )

    kwargs = {
        "limit": 9,
        "band_quotas": {"easy": 3, "medium": 3, "hard": 3},
        "category_quotas": {"world": 5, "open": 5},
        "event_quotas": {"Event A": 4},
        "per_event": 5,
    }
    selected = select_candidates(reversed(candidates), **kwargs)
    again = select_candidates(candidates, **kwargs)

    assert selected == again
    assert len(selected) == 9
    assert {
        band: sum(item["difficulty_band"] == band for item in selected)
        for band in ("easy", "medium", "hard")
    } == {
        "easy": 3,
        "medium": 3,
        "hard": 3,
    }
    assert sum(item["event"] == "Event A" for item in selected) <= 4
    assert all(
        sum(item["source_category"] == category for item in selected) <= 5
        for category in ("world", "open")
    )


def test_selection_rejects_incomplete_historical_headers():
    complete = {
        "id": "complete",
        "difficulty_band": "hard",
        "source_category": "world",
        "event": "World Championship",
        "white": "Alpha",
        "black": "Beta",
        "date": "1927-01-01",
    }
    incomplete = {**complete, "id": "incomplete", "white": "?"}
    assert select_candidates([incomplete, complete], limit=2) == [complete]


def test_source_catalog_accepts_list_and_sources_object(tmp_path: pathlib.Path):
    pgn = tmp_path / "games.pgn"
    _write_pgn(pgn)
    item = {
        "pgn": "games.pgn",
        "source_url": "https://example.test/archive",
        "name": "Archive",
        "category": "world-championship",
    }
    for payload in ([item], {"sources": [item]}):
        catalog = tmp_path / "sources.json"
        catalog.write_text(json.dumps(payload), encoding="utf-8")
        sources = load_source_catalog(catalog)
        assert sources == [
            Source(pgn, "https://example.test/archive", "Archive", "world-championship")
        ]


def test_split_is_by_source_game_and_public_document_has_no_heldout_items():
    candidates = [
        {
            "id": f"candidate-{number}",
            "fen": f"fen-{number}",
            "setup_uci": "a2a3",
            "source_game_fingerprint": f"game-{number}",
        }
        for number in range(5)
    ]
    split = apply_deterministic_split(candidates, heldout_count=2)
    document = {"candidate_count": 5, "candidates": split}
    public = document_for_split(document, "public")
    heldout = document_for_split(document, "held_out")

    assert public["candidate_count"] == 3
    assert heldout["candidate_count"] == 2
    assert all(item["split"] == "public" for item in public["candidates"])
    assert all(item["split"] == "held_out" for item in heldout["candidates"])
    assert {item["source_game_fingerprint"] for item in public["candidates"]}.isdisjoint(
        {item["source_game_fingerprint"] for item in heldout["candidates"]}
    )
