#!/usr/bin/env python3
"""Source and VALIDATE a large composed/esoteric problem set.

Grows ``data/composed_problems.json`` from the original 8 seed problems to ~60
real, solver-validated problems spanning every genre (directmate, selfmate,
reflexmate, helpmate, series-directmate, series-helpmate, proof game, study) and
several difficulty tiers.

Nothing here is trusted on faith: **every** problem is checked before it is added
to the file, using the project's own solver *and*, for the brute-force-discovered
genres (selfmate / helpmate / reflexmate), a second INDEPENDENT verifier written
from scratch in this file -- both must agree or the build ``assert``s out.

Where each problem comes from:
  * directmate #1/#2/#3  -- converted from Lichess mate puzzles in
    ``data/sample_puzzles.csv``; kept only if ``verify_directmate`` confirms the
    stored key forces mate in the stipulated number of moves.
  * selfmate s#1/s#2, helpmate h#2/h#3, reflexmate r#1 -- DISCOVERED by brute
    force over random sparse legal positions (see ``scripts`` history); the
    surviving positions are pinned here as constants and re-validated on every
    build by both the independent and the project solvers.
  * series ser-#2/#3/#4 and ser-h#2/#3/#4 -- constructed rook/pawn journeys,
    validated with the series verifiers.
  * proof games -- short real opening sequences; the reached position is the
    target, validated with ``verify_proofgame``.
  * studies -- well-known theoretical wins/draws (KQ, KR, KBN, KRR, KQ-vs-KR, KP
    win, KP rook-pawn / opposition draws); validated as a legal position whose
    Stockfish evaluation is decisive (win) or balanced (draw).

    python scripts/source_composed.py --out data/composed_problems.json
"""

from __future__ import annotations

import argparse
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

import chess  # noqa: E402

from chessbench.solvers import proofgame, series, stipulations  # noqa: E402
from chessbench.tasks.composed import ComposedProblem, save_composed  # noqa: E402
from chessbench.tasks.puzzles import load_puzzles  # noqa: E402

try:  # studies need Stockfish for their eval-based validation; degrade gracefully.
    from chessbench.core.engine import Engine, EngineConfig, find_stockfish
except Exception:  # pragma: no cover - engine import should always succeed
    Engine = EngineConfig = None  # type: ignore

    def find_stockfish():  # type: ignore
        return None


ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_SAMPLE = ROOT / "data" / "sample_puzzles.csv"

# Study eval thresholds (side-to-move POV centipawns, Stockfish @ 200k nodes).
WIN_MIN_CP = 150
DRAW_MAX_CP = 130
STUDY_NODES = 200_000


# --------------------------------------------------------------------------- #
# Independent verifiers (a SECOND opinion, deliberately not importing the       #
# project solver's logic) used to cross-check discovered problems.              #
# --------------------------------------------------------------------------- #


def _mates(board: chess.Board, move: chess.Move) -> bool:
    board.push(move)
    try:
        return board.is_checkmate()
    finally:
        board.pop()


def indep_directmate(board: chess.Board, n: int, key: chess.Move) -> bool:
    """Independent forced-mate check for the attacker (mate in <= n)."""
    if key not in board.legal_moves:
        return False
    board.push(key)
    try:
        if board.is_checkmate():
            return n >= 1
        return n >= 2 and _indep_all_defenses_lose(board, n - 1)
    finally:
        board.pop()


def _indep_all_defenses_lose(board: chess.Board, n: int) -> bool:
    defenses = list(board.legal_moves)
    if not defenses:
        return False  # defender not to move-less by mate here => stalemate, no mate
    for d in defenses:
        board.push(d)
        try:
            if not _indep_attacker_mates(board, n):
                return False
        finally:
            board.pop()
    return True


def _indep_attacker_mates(board: chess.Board, n: int) -> bool:
    if n <= 0:
        return False
    for m in board.legal_moves:
        board.push(m)
        try:
            if board.is_checkmate():
                return True
            if _indep_all_defenses_lose(board, n - 1):
                return True
        finally:
            board.pop()
    return False


def indep_selfmate(board: chess.Board, n: int, key: chess.Move) -> bool:
    """Independent selfmate check: attacker forces the defender to mate it."""
    if key not in board.legal_moves:
        return False
    board.push(key)
    try:
        return _indep_defender_compelled(board, n - 1)
    finally:
        board.pop()


def _indep_defender_compelled(board: chess.Board, n: int) -> bool:
    defenses = list(board.legal_moves)
    if not defenses:
        return False  # defender stalemated => attacker not mated => fails
    for d in defenses:
        board.push(d)
        try:
            if board.is_checkmate():
                continue  # defender mated the attacker on this line: satisfied
            if not _indep_selfmate_forced(board, n):
                return False
        finally:
            board.pop()
    return True


def _indep_selfmate_forced(board: chess.Board, n: int) -> bool:
    if n <= 0:
        return False
    for m in board.legal_moves:
        board.push(m)
        try:
            if _indep_defender_compelled(board, n - 1):
                return True
        finally:
            board.pop()
    return False


def indep_reflexmate_1(board: chess.Board, key: chess.Move) -> bool:
    """Independent r#1: after the key, the defender is reflex-compelled to mate.

    Sound iff the defender then has at least one legal move and at least one of
    them checkmates the attacker (the reflex rule forces the defender to play a
    mating move, and every such move mates by definition).
    """
    if key not in board.legal_moves:
        return False
    board.push(key)
    try:
        replies = list(board.legal_moves)
        if not replies:
            return False
        return any(_mates(board, r) for r in replies)
    finally:
        board.pop()


def indep_helpmate(board: chess.Board, n: int, line: list[chess.Move]) -> bool:
    """Independent helpmate replay: 2n cooperative plies, no premature game end,
    the last ply is checkmate."""
    if len(line) != 2 * n:
        return False
    work = board.copy()
    for i, mv in enumerate(line):
        if mv not in work.legal_moves:
            return False
        work.push(mv)
        last = i == len(line) - 1
        if last:
            return work.is_checkmate()
        if work.is_game_over():
            return False  # only the final ply may end the game
    return False


# --------------------------------------------------------------------------- #
# Discovered positions (brute-forced over random sparse legal positions).       #
# Each is re-validated below by BOTH the independent and the project solver.    #
# --------------------------------------------------------------------------- #

# selfmate s#1: White forces Black to mate White next move (unique key).
SELFMATE_1 = [
    ("8/8/8/4q2Q/4rk1K/7R/8/8 w - - 0 1", "h5g5"),
    ("6R1/2Q5/2r5/8/8/7k/2q5/7K w - - 0 1", "c7h2"),
    ("k6K/r7/q7/8/6Q1/8/7R/8 w - - 0 1", "g4c8"),
    ("8/8/8/8/8/R6Q/5k1K/4rq2 w - - 0 1", "h3g2"),
    ("5r2/1R6/3q3Q/8/8/8/2k1K3/8 w - - 0 1", "h6d2"),
    ("1q1Rr3/6Q1/8/8/8/8/K1k5/8 w - - 0 1", "g7b2"),
]

# selfmate s#2: genuine two-mover (not also an s#1).
SELFMATE_2 = [
    ("7k/4r3/5R1K/3q4/8/8/8/1Q6 w - - 0 1", "f6f8"),
    ("1q6/8/1Q6/8/8/3r4/k1K5/2R5 w - - 0 1", "c1a1"),
]

# reflexmate r#1: under the reflex rule, Black is forced to mate White.
REFLEXMATE_1 = [
    ("6Q1/5q2/8/8/8/7R/2r5/5k1K w - - 0 1", "h3h5"),
    ("6q1/8/1R6/4Q3/8/1r6/5K2/3k4 w - - 0 1", "f2f1"),
    ("8/2r2k2/K7/8/4q3/8/8/1R4Q1 w - - 0 1", "b1b6"),
    ("8/8/7K/2q5/7k/8/R7/Q6r w - - 0 1", "a1g7"),
]

# helpmate h#2: Black (side to move) cooperates to be mated in 2 (unique line).
HELPMATE_2 = [
    ("8/6Q1/8/8/1K6/8/k2B4/8 b - - 0 1", ["a2b1", "d2c1", "b1a2", "g7b2"]),
    ("2k5/6Q1/6K1/7N/8/8/8/8 b - - 0 1", ["c8d8", "g6f6", "d8e8", "g7e7"]),
    ("8/8/8/8/6Q1/2k5/6B1/5K2 b - - 0 1", ["c3d3", "f1e1", "d3e3", "g4e4"]),
    ("6Q1/8/8/8/1K6/8/1k6/6N1 b - - 0 1", ["b2b1", "b4a3", "b1a1", "g8a2"]),
    ("8/8/8/3k4/8/3B1K2/6Q1/8 b - - 0 1", ["d5e5", "f3f2", "e5f4", "g2g3"]),
]

# helpmate h#3: same, 6 cooperative plies (unique line).
HELPMATE_3 = [
    ("4Q3/8/7N/8/6K1/8/8/1k6 b - - 0 1", ["b1c2", "e8h8", "c2d3", "h6f5", "d3e4", "h8d4"]),
    ("7Q/4k3/8/8/8/4N3/8/4K3 b - - 0 1", ["e7f7", "h8f8", "f7g6", "e3f5", "g6h7", "f8g7"]),
    ("7N/3Q4/8/8/8/2k5/8/4K3 b - - 0 1", ["c3c4", "h8f7", "c4b4", "f7d6", "b4a5", "d7b5"]),
    ("8/8/3B4/8/8/7k/K7/4Q3 b - - 0 1", ["h3g4", "d6f8", "g4h3", "e1f1", "h3h2", "f8d6"]),
]

TIER_BY_MATE_N = {1: "beginner", 2: "intermediate", 3: "advanced"}


# --------------------------------------------------------------------------- #
# Seed problems (the original 8, reproduced so the file keeps them).            #
# --------------------------------------------------------------------------- #


def seed_problems(sample: pathlib.Path) -> list[ComposedProblem]:
    out: list[ComposedProblem] = []

    # dm1: constructed back-rank #1.
    fen = "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1"
    board = chess.Board(fen)
    key = chess.Move.from_uci("a1a8")
    assert stipulations.verify_directmate(board, 1, key) and indep_directmate(board, 1, key)
    out.append(ComposedProblem(id="dm1", fen=fen, kind="directmate", n=1, solution=["a1a8"],
                               themes=["directmate", "backRankMate", "beginner"], source="constructed"))

    # sm1: discovered selfmate #1.
    fen = "8/1Q6/8/4R3/3p4/8/1q6/5k1K w - - 0 1"
    board = chess.Board(fen)
    key = chess.Move.from_uci("b7g2")
    assert stipulations.verify_selfmate(board, 1, key) and indep_selfmate(board, 1, key)
    out.append(ComposedProblem(id="sm1", fen=fen, kind="selfmate", n=1, solution=["b7g2"],
                               themes=["selfmate", "intermediate"], source="discovered"))

    # hm2: discovered helpmate #2.
    fen = "8/3K4/8/8/8/8/3k4/2Q4N b - - 0 1"
    board = chess.Board(fen)
    line = ["d2e2", "c1c5", "e2f1", "c5f2"]
    mv = [chess.Move.from_uci(u) for u in line]
    assert stipulations.verify_helpmate_line(board, 2, mv) and indep_helpmate(board, 2, mv)
    out.append(ComposedProblem(id="hm2", fen=fen, kind="helpmate", n=2, solution=line,
                               themes=["helpmate", "intermediate"], source="discovered"))

    # ser_dm2 / ser_hm2: constructed series.
    fen = "7k/5ppp/8/8/8/8/8/R5K1 w - - 0 1"
    line = ["a1a7", "a7a8"]
    assert series.verify_series_directmate(chess.Board(fen), 2, [chess.Move.from_uci(u) for u in line])
    out.append(ComposedProblem(id="ser_dm2", fen=fen, kind="series_directmate", n=2, solution=line,
                               themes=["series", "seriesmover", "intermediate"], source="constructed"))

    fen = "7k/p7/5KQ1/8/8/8/8/8 b - - 0 1"
    line = ["a7a6", "a6a5", "g6g7"]
    assert series.verify_series_helpmate(chess.Board(fen), 2, [chess.Move.from_uci(u) for u in line])
    out.append(ComposedProblem(id="ser_hm2", fen=fen, kind="series_helpmate", n=2, solution=line,
                               themes=["series", "seriesmover", "intermediate"], source="constructed"))

    # pg3: constructed proof game.
    line = ["e2e4", "e7e5", "g1f3"]
    board = chess.Board()
    for u in line:
        board.push(chess.Move.from_uci(u))
    target = board.fen()
    assert proofgame.verify_proofgame(target, line, n_plies=3)
    out.append(ComposedProblem(id="pg3", fen=target, kind="proofgame", n=3, solution=line,
                               themes=["proofgame", "beginner"], source="constructed"))

    # study_kqk: KQ vs K win.
    fen = "8/8/8/4k3/8/8/4K3/6Q1 w - - 0 1"
    assert chess.Board(fen).is_valid()
    out.append(ComposedProblem(id="study_kqk", fen=fen, kind="study", n=0, goal="win", solution=[],
                               themes=["study", "endgame", "beginner"], source="constructed"))
    return out


# --------------------------------------------------------------------------- #
# Directmates from Lichess.                                                      #
# --------------------------------------------------------------------------- #


def lichess_directmates(sample: pathlib.Path, want1: int = 6, want2: int = 6, want3: int = 3) -> list[ComposedProblem]:
    puzzles = load_puzzles(sample)

    def collect(theme: str, n: int, want: int, time_cap: float | None = None) -> list[ComposedProblem]:
        got: list[ComposedProblem] = []
        for p in puzzles:
            if theme not in p.themes:
                continue
            board = chess.Board(p.fen)
            try:
                board.push(chess.Move.from_uci(p.moves[0]))  # opponent setup move
                key = chess.Move.from_uci(p.moves[1])
            except Exception:
                continue
            t0 = time.time()
            ok = stipulations.verify_directmate(board, n, key)
            dt = time.time() - t0
            if not ok:
                continue
            if time_cap is not None and dt > time_cap:
                continue  # keep test/build fast: skip slow-to-verify #3s
            # Independent cross-check for the cheap ones (#1/#2); #3 is exponential.
            if n <= 2:
                assert indep_directmate(board, n, key), f"indep disagrees on {p.id}"
            tier = TIER_BY_MATE_N[n]
            got.append(ComposedProblem(id=f"dm{n}_{p.id}", fen=board.fen(), kind="directmate", n=n,
                                       solution=[key.uci()], themes=["directmate", f"mateIn{n}", tier],
                                       source="lichess"))
            if len(got) >= want:
                break
        assert len(got) == want, f"only found {len(got)}/{want} verified {theme}"
        return got

    return collect("mateIn1", 1, want1) + collect("mateIn2", 2, want2) + collect("mateIn3", 3, want3, time_cap=0.5)


# --------------------------------------------------------------------------- #
# Discovered selfmate / reflexmate / helpmate.                                  #
# --------------------------------------------------------------------------- #


def discovered_selfmates() -> list[ComposedProblem]:
    out: list[ComposedProblem] = []
    for i, (fen, key) in enumerate(SELFMATE_1):
        board = chess.Board(fen)
        mv = chess.Move.from_uci(key)
        assert board.is_valid()
        assert stipulations.verify_selfmate(board, 1, mv), f"project rejects s#1 {fen}"
        assert indep_selfmate(board, 1, mv), f"indep rejects s#1 {fen}"
        out.append(ComposedProblem(id=f"sm1_{i}", fen=fen, kind="selfmate", n=1, solution=[key],
                                   themes=["selfmate", "intermediate"], source="discovered"))
    for i, (fen, key) in enumerate(SELFMATE_2):
        board = chess.Board(fen)
        mv = chess.Move.from_uci(key)
        assert board.is_valid()
        assert not stipulations.selfmate_keys(board, 1), f"s#2 {fen} is actually an s#1"
        assert stipulations.verify_selfmate(board, 2, mv), f"project rejects s#2 {fen}"
        assert indep_selfmate(board, 2, mv), f"indep rejects s#2 {fen}"
        out.append(ComposedProblem(id=f"sm2_{i}", fen=fen, kind="selfmate", n=2, solution=[key],
                                   themes=["selfmate", "advanced"], source="discovered"))
    return out


def discovered_reflexmates() -> list[ComposedProblem]:
    out: list[ComposedProblem] = []
    for i, (fen, key) in enumerate(REFLEXMATE_1):
        board = chess.Board(fen)
        mv = chess.Move.from_uci(key)
        assert board.is_valid()
        assert stipulations.verify_reflexmate(board, 1, mv), f"project rejects r#1 {fen}"
        assert indep_reflexmate_1(board, mv), f"indep rejects r#1 {fen}"
        out.append(ComposedProblem(id=f"rm1_{i}", fen=fen, kind="reflexmate", n=1, solution=[key],
                                   themes=["reflexmate", "advanced"], source="discovered"))
    return out


def discovered_helpmates() -> list[ComposedProblem]:
    out: list[ComposedProblem] = []
    for i, (fen, line) in enumerate(HELPMATE_2):
        board = chess.Board(fen)
        mv = [chess.Move.from_uci(u) for u in line]
        assert board.is_valid()
        assert stipulations.verify_helpmate_line(board, 2, mv), f"project rejects h#2 {fen}"
        assert indep_helpmate(board, 2, mv), f"indep rejects h#2 {fen}"
        out.append(ComposedProblem(id=f"hm2_{i}", fen=fen, kind="helpmate", n=2, solution=line,
                                   themes=["helpmate", "intermediate"], source="discovered"))
    for i, (fen, line) in enumerate(HELPMATE_3):
        board = chess.Board(fen)
        mv = [chess.Move.from_uci(u) for u in line]
        assert board.is_valid()
        assert stipulations.verify_helpmate_line(board, 3, mv), f"project rejects h#3 {fen}"
        assert indep_helpmate(board, 3, mv), f"indep rejects h#3 {fen}"
        out.append(ComposedProblem(id=f"hm3_{i}", fen=fen, kind="helpmate", n=3, solution=line,
                                   themes=["helpmate", "advanced"], source="discovered"))
    return out


# --------------------------------------------------------------------------- #
# Constructed series-movers.                                                    #
# --------------------------------------------------------------------------- #


def constructed_series() -> list[ComposedProblem]:
    out: list[ComposedProblem] = []
    series_dm = [
        ("ser_dm3", "7k/5ppp/8/8/8/8/8/1R4K1 w - - 0 1", ["b1a1", "a1a7", "a7a8"], 3, "advanced"),
        ("ser_dm4", "7k/5ppp/8/8/8/8/8/2R3K1 w - - 0 1", ["c1c2", "c2a2", "a2a7", "a7a8"], 4, "expert"),
    ]
    for pid, fen, line, n, tier in series_dm:
        mv = [chess.Move.from_uci(u) for u in line]
        assert series.verify_series_directmate(chess.Board(fen), n, mv), f"bad {pid}"
        out.append(ComposedProblem(id=pid, fen=fen, kind="series_directmate", n=n, solution=line,
                                   themes=["series", "seriesmover", tier], source="constructed"))
    series_hm = [
        ("ser_hm3", "7k/p7/5KQ1/8/8/8/8/8 b - - 0 1", ["a7a6", "a6a5", "a5a4", "g6g7"], 3, "advanced"),
        ("ser_hm4", "7k/p7/5KQ1/8/8/8/8/8 b - - 0 1", ["a7a5", "a5a4", "a4a3", "a3a2", "g6g7"], 4, "expert"),
    ]
    for pid, fen, line, n, tier in series_hm:
        mv = [chess.Move.from_uci(u) for u in line]
        assert series.verify_series_helpmate(chess.Board(fen), n, mv), f"bad {pid}"
        out.append(ComposedProblem(id=pid, fen=fen, kind="series_helpmate", n=n, solution=line,
                                   themes=["series", "seriesmover", tier], source="constructed"))
    return out


# --------------------------------------------------------------------------- #
# Constructed proof games.                                                      #
# --------------------------------------------------------------------------- #


def constructed_proofgames() -> list[ComposedProblem]:
    specs = [
        ("pg2", ["e2e4", "e7e5"], "beginner"),
        ("pg4", ["e2e4", "e7e5", "g1f3", "b8c6"], "intermediate"),
        ("pg5", ["d2d4", "g8f6", "c2c4", "e7e6", "b1c3"], "intermediate"),
        ("pg6_sicilian", ["e2e4", "c7c5", "g1f3", "d7d6", "d2d4", "c5d4"], "advanced"),
        ("pg6_kia", ["g1f3", "g8f6", "g2g3", "g7g6", "f1g2", "f8g7"], "advanced"),
        ("pg7_ruy", ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6", "b5a4"], "advanced"),
    ]
    out: list[ComposedProblem] = []
    for pid, line, tier in specs:
        board = chess.Board()
        for u in line:
            board.push(chess.Move.from_uci(u))
        target = board.fen()
        n = len(line)
        assert proofgame.verify_proofgame(target, line, n_plies=n), f"bad {pid}"
        out.append(ComposedProblem(id=pid, fen=target, kind="proofgame", n=n, solution=line,
                                   themes=["proofgame", tier], source="constructed"))
    return out


# --------------------------------------------------------------------------- #
# Studies (validated by Stockfish evaluation).                                  #
# --------------------------------------------------------------------------- #

STUDY_SPECS = [
    # (id, fen, goal, extra themes, tier)
    ("study_krk", "8/8/8/4k3/8/8/4K3/7R w - - 0 1", "win", ["KRvK"], "beginner"),
    ("study_kbnk", "8/8/8/8/8/2k5/2N5/1KB5 w - - 0 1", "win", ["KBNvK", "bishopKnightMate"], "advanced"),
    ("study_krrk", "8/8/8/4k3/8/8/8/R3K2R w - - 0 1", "win", ["KRRvK"], "beginner"),
    ("study_kqkr", "8/8/8/3rk3/8/8/4K3/6Q1 w - - 0 1", "win", ["KQvKR"], "advanced"),
    ("study_kpk_win", "8/4P3/4K3/8/8/8/4k3/8 w - - 0 1", "win", ["KPvK", "promotion"], "intermediate"),
    ("study_kpk_draw_rook", "k7/8/K7/P7/8/8/8/8 w - - 0 1", "draw", ["KPvK", "rookPawnDraw"], "intermediate"),
    ("study_kpk_draw_opp", "8/8/8/3k4/8/3PK3/8/8 w - - 0 1", "draw", ["KPvK", "opposition"], "advanced"),
]


def constructed_studies() -> list[ComposedProblem]:
    have_sf = find_stockfish() is not None and Engine is not None
    if not have_sf:
        print("  WARNING: Stockfish not found -- validating studies by legality only (no eval).")
    out: list[ComposedProblem] = []
    engine = None
    try:
        if have_sf:
            engine = Engine(EngineConfig(nodes=STUDY_NODES)).__enter__()
        for pid, fen, goal, extra, tier in STUDY_SPECS:
            board = chess.Board(fen)
            assert board.is_valid(), f"invalid study fen {fen}"
            if engine is not None:
                ev = engine.evaluate(board)  # side-to-move POV centipawns
                if goal == "win":
                    assert ev >= WIN_MIN_CP, f"{pid} not decisive for a win (eval {ev})"
                else:
                    assert abs(ev) <= DRAW_MAX_CP, f"{pid} not balanced for a draw (eval {ev})"
            out.append(ComposedProblem(id=pid, fen=fen, kind="study", n=0, goal=goal, solution=[],
                                       themes=["study", "endgame", *extra, tier], source="constructed"))
    finally:
        if engine is not None:
            engine.__exit__(None, None, None)
    return out


# --------------------------------------------------------------------------- #


def build(sample: pathlib.Path) -> list[ComposedProblem]:
    problems: list[ComposedProblem] = []
    problems += seed_problems(sample)
    problems += lichess_directmates(sample)
    problems += discovered_selfmates()
    problems += discovered_reflexmates()
    problems += discovered_helpmates()
    problems += constructed_series()
    problems += constructed_proofgames()
    problems += constructed_studies()

    seen: set[str] = set()
    for p in problems:
        assert p.id not in seen, f"duplicate id {p.id}"
        seen.add(p.id)
    return problems


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default=str(ROOT / "data" / "composed_problems.json"))
    ap.add_argument("--sample", default=str(DEFAULT_SAMPLE))
    args = ap.parse_args()

    problems = build(pathlib.Path(args.sample))
    save_composed(problems, args.out)

    by_kind: dict[str, int] = {}
    by_tier: dict[str, int] = {}
    tiers = {"beginner", "intermediate", "advanced", "expert"}
    for p in problems:
        by_kind[p.kind] = by_kind.get(p.kind, 0) + 1
        for t in p.themes:
            if t in tiers:
                by_tier[t] = by_tier.get(t, 0) + 1
    print(f"\nwrote {len(problems)} validated composed problems -> {args.out}")
    print("per genre:")
    for kind in sorted(by_kind):
        print(f"  {kind:<18} {by_kind[kind]}")
    print("per tier:")
    for tier in ["beginner", "intermediate", "advanced", "expert"]:
        print(f"  {tier:<18} {by_tier.get(tier, 0)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
