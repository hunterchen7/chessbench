"""Round-robin tournament structure and points ordering."""

import json
import re

import pytest

from chessbench.agents import FirstLegalAgent, RandomAgent
from chessbench.conditions import Condition
from chessbench.core.engine import EngineConfig, find_stockfish
from chessbench.tasks.games import GameConfig, play_game
from chessbench.tasks.tournament import TournamentEntry, round_robin


def test_round_robin_structure():
    entries = [
        TournamentEntry("rand0", RandomAgent(seed=0)),
        TournamentEntry("rand1", RandomAgent(seed=1)),
        TournamentEntry("firstlegal", FirstLegalAgent()),
    ]
    res = round_robin(
        entries,
        games_per_pair=2,
        condition=Condition(),
        config=GameConfig(max_plies=40),
    )
    assert len(res.standings) == 3
    assert len(res.games) == 3 * 2  # 3 pairs, 2 games each
    # every player has the right number of games
    for s in res.standings:
        assert s.games == 4  # plays each of the other two twice
    # crosstable is symmetric in counts
    for (a, b), (w, d, ll) in res.crosstable.items():
        assert res.crosstable[(b, a)] == (ll, d, w)


def test_tournament_record_export(tmp_path):
    from chessbench.conditions import HEADLINE
    from chessbench.store import TournamentRecord, list_tournaments, save_tournament

    entries = [
        TournamentEntry("rand", RandomAgent(seed=0)),
        TournamentEntry("first", FirstLegalAgent()),
    ]
    result = round_robin(
        entries, games_per_pair=2, condition=HEADLINE, config=GameConfig(max_plies=20)
    )
    rec = TournamentRecord(result, HEADLINE, 20)
    d = rec.to_dict()
    assert d["schema"] == "chessbench.tournament.v1"
    assert d["status"] == "final"
    assert {s["label"] for s in d["standings"]} == {"rand", "first"}
    assert d["games"] and all(
        g["white"] in ("rand", "first") for g in d["games"]
    )  # labels, not agent.name
    path = tmp_path / "t.json"
    save_tournament(rec, path)
    assert "Infinity" not in path.read_text()
    idx = list_tournaments(tmp_path)
    assert len(idx) == 1 and idx[0]["n_games"] == 2
    assert idx[0]["status"] == "final"
    assert idx[0]["condition_slug"] == HEADLINE.slug()
    expected_winner = (
        None
        if result.standings[0].score == result.standings[1].score
        else result.standings[0].label
    )
    assert idx[0]["winner"] == expected_winner


def test_openings_diversify_start_positions():
    from chessbench.conditions import HEADLINE
    from chessbench.openings import opening_fens

    ofens = opening_fens()
    assert len(ofens) >= 5
    entries = [
        TournamentEntry("a", RandomAgent(seed=0)),
        TournamentEntry("b", FirstLegalAgent()),
    ]
    res = round_robin(
        entries,
        games_per_pair=4,
        condition=HEADLINE,
        config=GameConfig(max_plies=8),
        openings=ofens[:2],
    )
    starts = {g.start_fen for g in res.games}
    assert len(starts) == 2  # each opening played from both colors


def test_distinct_labels_required():
    with pytest.raises(ValueError, match="distinct labels"):
        round_robin(
            [TournamentEntry("x", RandomAgent()), TournamentEntry("x", RandomAgent())],
            games_per_pair=1,
            condition=Condition(),
        )


def test_round_robin_resumes_completed_games_by_sequence():
    first = play_game(
        FirstLegalAgent(),
        RandomAgent(seed=1),
        Condition(),
        GameConfig(max_plies=4),
    )
    first.white = "a"
    first.black = "b"
    completed_now: list[int] = []
    result = round_robin(
        [
            TournamentEntry("a", FirstLegalAgent()),
            TournamentEntry("b", RandomAgent(seed=1)),
        ],
        games_per_pair=2,
        condition=Condition(),
        config=GameConfig(max_plies=4),
        completed_games={0: first},
        on_game=lambda _record, sequence: completed_now.append(sequence),
    )
    assert result.games[0] == first
    assert completed_now == [1]


def test_round_robin_rejects_completed_game_from_another_manifest():
    first = play_game(
        FirstLegalAgent(),
        RandomAgent(seed=1),
        Condition(),
        GameConfig(max_plies=2),
    )
    first.white = "wrong"
    first.black = "pairing"
    with pytest.raises(ValueError, match="does not match"):
        round_robin(
            [
                TournamentEntry("a", FirstLegalAgent()),
                TournamentEntry("b", RandomAgent()),
            ],
            games_per_pair=1,
            condition=Condition(),
            config=GameConfig(max_plies=2),
            completed_games={0: first},
        )


def test_tournament_cli_persists_and_resumes_without_replaying_games(
    tmp_path, monkeypatch
):
    from chessbench.__main__ import main
    from chessbench.database import BenchmarkStore
    from chessbench.models.base import ScriptedModel

    calls: list[str] = []

    def build_model(_provider, model_id, **_kwargs):
        def respond(messages):
            latest = messages[-1]["content"]
            calls.append(f"{model_id}:{latest}")
            legal = re.findall(r"\(([a-h][1-8][a-h][1-8][qrbn]?)\)", latest)
            assert legal
            return json.dumps({"move": legal[0], "rationale": f"{model_id} private"})

        return ScriptedModel(respond, name=model_id)

    monkeypatch.setattr("chessbench.__main__._build_model", build_model)
    db = tmp_path / "games.db"
    saved = tmp_path / "games.json"
    argv = [
        "tournament",
        "--models",
        "model/a,model/b",
        "--games",
        "2",
        "--max-plies",
        "2",
        "--mode",
        "2",
        "--reasoning",
        "low",
        "--openings",
        "none",
        "--db",
        str(db),
        "--save",
        str(saved),
    ]
    assert main(argv) == 0
    first_call_count = len(calls)
    assert first_call_count == 4
    assert main(argv) == 0
    assert len(calls) == first_call_count

    with BenchmarkStore(db) as store:
        [run] = store.list_runs()
        assert run["status"] == "completed"
        assert run["completed_items"] == 2
        games = store.load_game_results(str(run["run_id"]))
        assert list(games) == [0, 1]
        assert all(game.start_fen is None for game in games.values())
        assert all(
            move.attempts and move.attempts[0].prompt and move.attempts[0].raw_response
            for game in games.values()
            for move in game.records
        )
    exported = json.loads(saved.read_text())
    assert len(exported["games"]) == 2
    assert all(game["start_fen"] is None for game in exported["games"])


@pytest.mark.skipif(find_stockfish() is None, reason="stockfish not installed")
def test_stockfish_tops_the_table():
    from chessbench.agents import StockfishAgent
    from chessbench.core.engine import Engine

    with Engine(EngineConfig(nodes=60_000, skill_level=3)) as engine:
        entries = [
            TournamentEntry("stockfish", StockfishAgent(engine=engine)),
            TournamentEntry("random", RandomAgent(seed=0)),
            TournamentEntry("firstlegal", FirstLegalAgent()),
        ]
        res = round_robin(
            entries,
            games_per_pair=2,
            condition=Condition(),
            config=GameConfig(max_plies=80),
        )
    assert res.standings[0].label == "stockfish"
    assert res.standings[0].score > res.standings[-1].score
