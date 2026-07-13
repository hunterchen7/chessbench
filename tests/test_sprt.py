"""SPRT decision math + match loop."""

from chessbench.agents import FirstLegalAgent, RandomAgent
from chessbench.conditions import HEADLINE
from chessbench.sprt import sprt_llr, sprt_match, sprt_status
from chessbench.tasks.games import GameConfig


def test_llr_sign_tracks_who_is_winning():
    assert sprt_llr(20, 0, 0, elo0=0, elo1=20) > 0
    assert sprt_llr(0, 0, 20, elo0=0, elo1=20) < 0


def test_accepts_h1_when_a_dominates():
    assert sprt_status(30, 0, 0, elo0=0, elo1=20).decision == "accept_h1"


def test_accepts_h0_when_a_loses():
    assert sprt_status(0, 0, 30, elo0=0, elo1=20).decision == "accept_h0"


def test_continues_when_ambiguous():
    assert sprt_status(2, 1, 2, elo0=0, elo1=20).decision == "continue"


def test_sprt_match_runs_and_decides_or_caps():
    status, games = sprt_match(
        RandomAgent(seed=0), FirstLegalAgent(), HEADLINE,
        GameConfig(max_plies=12), elo0=0, elo1=40, max_games=8,
    )
    assert status.n == len(games) <= 8
    assert status.decision in ("accept_h0", "accept_h1", "continue")
    assert status.n == status.wins + status.draws + status.losses
