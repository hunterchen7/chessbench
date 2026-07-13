"""Round-robin tournament: structural correctness (engine-free) and that a
stronger engine earns a higher game-Elo (engine-gated)."""

import pytest

from chessbench.agents import FirstLegalAgent, RandomAgent
from chessbench.conditions import Condition
from chessbench.core.engine import EngineConfig, find_stockfish
from chessbench.tasks.games import GameConfig
from chessbench.tasks.tournament import TournamentEntry, round_robin


def test_round_robin_structure():
    entries = [
        TournamentEntry("rand0", RandomAgent(seed=0)),
        TournamentEntry("rand1", RandomAgent(seed=1)),
        TournamentEntry("firstlegal", FirstLegalAgent()),
    ]
    res = round_robin(entries, games_per_pair=2, condition=Condition(), config=GameConfig(max_plies=40))
    assert len(res.standings) == 3
    assert len(res.games) == 3 * 2  # 3 pairs, 2 games each
    # every player has a rating and the right number of games
    for s in res.standings:
        assert s.rating is not None
        assert s.games == 4  # plays each of the other two twice
    # crosstable is symmetric in counts
    for (a, b), (w, d, ll) in res.crosstable.items():
        assert res.crosstable[(b, a)] == (ll, d, w)


def test_distinct_labels_required():
    with pytest.raises(ValueError, match="distinct labels"):
        round_robin(
            [TournamentEntry("x", RandomAgent()), TournamentEntry("x", RandomAgent())],
            games_per_pair=1, condition=Condition(),
        )


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
        res = round_robin(entries, games_per_pair=2, condition=Condition(), config=GameConfig(max_plies=80))
    assert res.standings[0].label == "stockfish"
    top = res.standings[0].rating
    assert top is not None and top.rating > res.standings[-1].rating.rating
