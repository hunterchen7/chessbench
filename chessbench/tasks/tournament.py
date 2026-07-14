"""Round-robin tournaments among LLMs (and optional engine anchors) -> game Elo.

Every pair plays `games_per_pair` games with alternating colors; each game is one
observation for the Bradley-Terry fit in `chessbench.rating.tournament_elo`. A
fixed-rating engine anchor (e.g. Stockfish pinned to a known Elo) puts the whole
table on an absolute scale; without one, ratings are centered on `anchor`.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from itertools import combinations

import chess

from ..agents import Agent
from ..conditions import Condition
from ..core.engine import Engine
from ..rating import RatingEstimate, tournament_elo
from .games import GameConfig, GameRecord, MoveRecord, play_game


@dataclass
class TournamentEntry:
    label: str
    agent: Agent
    fixed_rating: float | None = None  # set for engine anchors


@dataclass
class Standing:
    label: str
    wins: int = 0
    draws: int = 0
    losses: int = 0
    illegal_forfeits: int = 0
    rating: RatingEstimate | None = None

    @property
    def games(self) -> int:
        return self.wins + self.draws + self.losses

    @property
    def score(self) -> float:
        return self.wins + 0.5 * self.draws


@dataclass
class TournamentResult:
    standings: list[Standing]
    games: list[GameRecord] = field(default_factory=list)
    # (label_i, label_j) -> i's (wins, draws, losses) against j
    crosstable: dict[tuple[str, str], tuple[int, int, int]] = field(default_factory=dict)

    def pgns(self) -> str:
        return "\n\n".join(g.pgn for g in self.games)


def round_robin(
    entries: list[TournamentEntry],
    games_per_pair: int,
    condition: Condition,
    config: GameConfig | None = None,
    *,
    eval_engine: Engine | None = None,
    openings: list[str] | None = None,
    on_game: Callable[[GameRecord, int], None] | None = None,
    on_move: Callable[[str, str, str | None, int, chess.Board, list[MoveRecord]], None] | None = None,
) -> TournamentResult:
    """`on_game(record, idx)` fires after each completed game; `on_move(white, black,
    start_fen, idx, board, records)` fires after each half-move. Both are best-effort
    hooks used to stream a tournament into a persistent store as it plays."""
    if len({e.label for e in entries}) != len(entries):
        raise ValueError("tournament entries must have distinct labels")
    config = config or GameConfig()
    book: list[str | None] = list(openings) if openings else [None]  # None = standard start

    standings = {e.label: Standing(label=e.label) for e in entries}
    cross: dict[tuple[str, str], list[int]] = {}
    results_for_elo: list[tuple[str, str, float]] = []
    games: list[GameRecord] = []

    def bump(a: str, b: str, wdl_index: int) -> None:
        cross.setdefault((a, b), [0, 0, 0])[wdl_index] += 1

    for a, b in combinations(entries, 2):
        for g in range(games_per_pair):
            white, black = (a, b) if g % 2 == 0 else (b, a)
            start_fen = book[(g // 2) % len(book)]  # each opening played from both colors
            idx = len(games)
            mv = None
            if on_move is not None:
                def mv(board: chess.Board, recs: list[MoveRecord],
                       _w=white.label, _b=black.label, _sf=start_fen, _i=idx) -> None:
                    on_move(_w, _b, _sf, _i, board, recs)
            record = play_game(white.agent, black.agent, condition, config,
                               eval_engine=eval_engine, start_fen=start_fen, on_move=mv)
            record.white, record.black = white.label, black.label  # use entry labels, not agent.name
            games.append(record)
            if on_game is not None:
                on_game(record, idx)
            ws = record.white_score
            results_for_elo.append((white.label, black.label, ws))

            if record.termination == "illegal_forfeit":
                loser = white.label if record.result == "0-1" else black.label
                standings[loser].illegal_forfeits += 1

            if ws == 1.0:
                standings[white.label].wins += 1
                standings[black.label].losses += 1
                bump(white.label, black.label, 0)
                bump(black.label, white.label, 2)
            elif ws == 0.0:
                standings[white.label].losses += 1
                standings[black.label].wins += 1
                bump(white.label, black.label, 2)
                bump(black.label, white.label, 0)
            else:
                standings[white.label].draws += 1
                standings[black.label].draws += 1
                bump(white.label, black.label, 1)
                bump(black.label, white.label, 1)

    fixed = {e.label: e.fixed_rating for e in entries if e.fixed_rating is not None}
    ratings = tournament_elo(results_for_elo, fixed=fixed) if results_for_elo else {}
    for label, est in ratings.items():
        standings[label].rating = est

    ordered = sorted(standings.values(), key=lambda s: (s.score, s.wins), reverse=True)
    crosstable = {k: (v[0], v[1], v[2]) for k, v in cross.items()}
    return TournamentResult(standings=ordered, games=games, crosstable=crosstable)


def format_tournament(result: TournamentResult) -> str:
    lines = [f"{'#':>2} {'player':<38} {'points':>8} {'games':>6} {'W-D-L':>10} {'rate':>6} {'illegal':>7}"]
    lines.append("-" * 84)
    for i, s in enumerate(result.standings, 1):
        wdl = f"{s.wins}-{s.draws}-{s.losses}"
        pct = s.score / s.games if s.games else 0.0
        lines.append(f"{i:>2} {s.label:<38} {s.score:>8.1f} {s.games:>6} {wdl:>10} {pct:>5.0%} {s.illegal_forfeits:>7}")
    return "\n".join(lines)
