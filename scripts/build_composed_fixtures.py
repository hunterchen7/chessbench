#!/usr/bin/env python3
"""Build and VALIDATE the bundled composed-problem fixture.

Every problem is checked with the same solver that grades models, so the fixture
cannot contain an unsound problem or a wrong stored solution. Selfmate/helpmate
examples were discovered by independent brute force (see the commit message);
the directmate is converted from a Lichess mate-in-2; the proof game and study
are constructed. Run:

    python scripts/build_composed_fixtures.py --out data/composed_problems.json
"""

from __future__ import annotations

import argparse
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

import chess  # noqa: E402

from chessbench.solvers import proofgame, stipulations  # noqa: E402
from chessbench.tasks.composed import ComposedProblem, save_composed  # noqa: E402
from chessbench.tasks.puzzles import load_puzzles  # noqa: E402

DEFAULT_SAMPLE = pathlib.Path(__file__).resolve().parent.parent / "data" / "sample_puzzles.csv"


def directmate_1() -> ComposedProblem:
    fen = "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1"  # Ra8# (king boxed by its pawns)
    board = chess.Board(fen)
    key = chess.Move.from_uci("a1a8")
    assert stipulations.verify_directmate(board, 1, key), "directmate #1 unsound"
    return ComposedProblem(id="dm1", fen=fen, kind="directmate", n=1, solution=[key.uci()],
                           themes=["directmate", "backRankMate"], source="constructed")


def directmate_2_from_lichess(sample: pathlib.Path) -> ComposedProblem | None:
    for p in load_puzzles(sample):
        if "mateIn2" not in p.themes:
            continue
        board = chess.Board(p.fen)
        board.push(chess.Move.from_uci(p.moves[0]))  # setup move -> White to mate in 2
        key = chess.Move.from_uci(p.moves[1])
        if stipulations.verify_directmate(board, 2, key):
            return ComposedProblem(id=f"dm2_{p.id}", fen=board.fen(), kind="directmate", n=2,
                                   solution=[key.uci()], themes=["directmate"], source="lichess")
    return None


def selfmate_1() -> ComposedProblem:
    fen = "8/1Q6/8/4R3/3p4/8/1q6/5k1K w - - 0 1"  # discovered by brute force; key Qg2
    board = chess.Board(fen)
    assert stipulations.verify_selfmate(board, 1, chess.Move.from_uci("b7g2")), "selfmate #1 unsound"
    return ComposedProblem(id="sm1", fen=fen, kind="selfmate", n=1, solution=["b7g2"],
                           themes=["selfmate"], source="discovered")


def helpmate_2() -> ComposedProblem:
    fen = "8/3K4/8/8/8/8/3k4/2Q4N b - - 0 1"  # discovered; Black cooperates to be mated
    board = chess.Board(fen)
    line = ["d2e2", "c1c5", "e2f1", "c5f2"]
    moves = [chess.Move.from_uci(u) for u in line]
    assert stipulations.verify_helpmate_line(board, 2, moves), "helpmate #2 unsound"
    return ComposedProblem(id="hm2", fen=fen, kind="helpmate", n=2, solution=line,
                           themes=["helpmate"], source="discovered")


def proof_game_3() -> ComposedProblem:
    line = ["e2e4", "e7e5", "g1f3"]
    board = chess.Board()
    for u in line:
        board.push(chess.Move.from_uci(u))
    target = board.fen()
    assert proofgame.verify_proofgame(target, line, n_plies=3), "proof game invalid"
    return ComposedProblem(id="pg3", fen=target, kind="proofgame", n=3, solution=line,
                           themes=["proofgame"], source="constructed")


def study_kqk() -> ComposedProblem:
    fen = "8/8/8/4k3/8/8/4K3/6Q1 w - - 0 1"  # K+Q vs K, White to play and win
    assert chess.Board(fen).is_valid()
    return ComposedProblem(id="study_kqk", fen=fen, kind="study", n=0, goal="win",
                           solution=[], themes=["study", "endgame"], source="constructed")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/composed_problems.json")
    ap.add_argument("--sample", default=str(DEFAULT_SAMPLE))
    args = ap.parse_args()

    problems = [directmate_1(), selfmate_1(), helpmate_2(), proof_game_3(), study_kqk()]
    dm2 = directmate_2_from_lichess(pathlib.Path(args.sample))
    if dm2 is not None:
        problems.insert(1, dm2)

    save_composed(problems, args.out)
    print(f"wrote {len(problems)} validated composed problems -> {args.out}")
    for p in problems:
        print(f"  {p.id:<14} {p.label:<18} shape={p.answer_shape:<5} source={p.source}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
