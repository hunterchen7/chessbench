#!/usr/bin/env python3
"""Search for original sparse compositions and certify them with Popeye.

Popeye is a solver, not a composition generator.  ChessBench supplies the
deterministic candidate search; Popeye rejects unsolved/cooked candidates and
the native verifier independently checks the admitted key or line.
"""

from __future__ import annotations

import argparse
import hashlib
import pathlib
import random
import subprocess
import sys
from dataclasses import asdict

import chess

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from chessbench.corpus import Corpus, CorpusSource, save_corpus, save_corpus_manifest  # noqa: E402
from chessbench.solvers import proofgame, stipulations  # noqa: E402
from chessbench.solvers.popeye import certify  # noqa: E402
from chessbench.suite import freeze_composed_suite, save_suite, save_suite_manifest  # noqa: E402
from chessbench.tasks.composed import ComposedProblem  # noqa: E402
from chessbench.types import StipulationKind  # noqa: E402

SEARCH_KINDS: tuple[StipulationKind, ...] = (
    "directmate",
    "selfmate",
    "reflexmate",
    "helpmate",
)
LENGTHS: dict[StipulationKind, int] = {
    "directmate": 2,
    "selfmate": 2,
    "reflexmate": 2,
    "helpmate": 2,
}


def _random_board(rng: random.Random, kind: StipulationKind) -> chess.Board | None:
    board = chess.Board(None)
    squares = list(chess.SQUARES)
    rng.shuffle(squares)
    white_king = squares.pop()
    black_king = next(
        (square for square in squares if chess.square_distance(white_king, square) > 1),
        None,
    )
    if black_king is None:  # pragma: no cover - 64-square board guarantees one
        return None
    squares.remove(black_king)
    board.set_piece_at(white_king, chess.Piece(chess.KING, chess.WHITE))
    board.set_piece_at(black_king, chess.Piece(chess.KING, chess.BLACK))

    # Officer-only positions make every geometric placement equally meaningful
    # and avoid accidental illegal pawn histories in generated compositions.
    walks = [chess.QUEEN, chess.ROOK, chess.ROOK, chess.BISHOP, chess.KNIGHT]
    if kind in {"selfmate", "reflexmate"}:
        white_count, black_count = rng.randint(3, 6), rng.randint(3, 6)
    elif kind == "helpmate":
        # Sparse helpmates are far less likely to contain thousands of duals.
        white_count, black_count = rng.randint(1, 3), rng.randint(1, 3)
    else:
        white_count, black_count = rng.randint(2, 5), rng.randint(1, 4)
    for color, count in ((chess.WHITE, white_count), (chess.BLACK, black_count)):
        for _ in range(count):
            if not squares:
                return None
            board.set_piece_at(squares.pop(), chess.Piece(rng.choice(walks), color))

    board.turn = chess.BLACK if kind == "helpmate" else chess.WHITE
    board.castling_rights = chess.BB_EMPTY
    board.ep_square = None
    if not board.is_valid() or board.is_check() or board.is_game_over():
        return None
    return board


def _admit(
    board: chess.Board,
    kind: StipulationKind,
    *,
    popeye_bin: pathlib.Path,
    seed: int,
    candidate_index: int,
) -> ComposedProblem | None:
    n = LENGTHS[kind]
    certificate = certify(
        board.fen(en_passant="fen"), kind, n, executable=popeye_bin, timeout_seconds=3
    )
    if not certificate.solved:
        return None
    if kind in {"directmate", "selfmate", "reflexmate"}:
        if not certificate.unique_key:
            return None
        key = chess.Move.from_uci(certificate.keys[0])
        if kind == "directmate":
            valid = stipulations.verify_directmate(board, n, key)
        elif kind == "selfmate":
            valid = stipulations.verify_selfmate(board, n, key)
        else:
            valid = stipulations.verify_reflexmate(board, n, key)
        solution = [key.uci()] if valid else []
    else:
        if certificate.solution_count != 1:
            return None
        solution = next(
            (
                line
                for line in certificate.solutions
                if stipulations.verify_helpmate_line(
                    board, n, [chess.Move.from_uci(token) for token in line]
                )
            ),
            [],
        )
    if not solution:
        return None
    position_hash = hashlib.sha256(
        board.fen(en_passant="fen").encode("utf-8")
    ).hexdigest()
    return ComposedProblem(
        id=f"chessbench-gen-{kind}-{position_hash[:12]}",
        fen=board.fen(en_passant="fen"),
        kind=kind,
        n=n,
        solution=solution,
        themes=["computer-generated", "sparse"],
        source="chessbench-generator-v1",
        provenance={
            "generator": "sparse-officer-search-v1",
            "seed": seed,
            "candidate_index": candidate_index,
            "position_sha256": position_hash,
        },
        certification={"popeye": certificate.as_dict(), "native_verifier": True},
    )


def _proofgames(count: int, *, seed: int) -> list[ComposedProblem]:
    by_position: dict[str, list[list[str]]] = {}
    start = chess.Board()
    for first in start.legal_moves:
        one = start.copy()
        one.push(first)
        for second in one.legal_moves:
            two = one.copy()
            two.push(second)
            for third in two.legal_moves:
                end = two.copy()
                end.push(third)
                key = " ".join(end.fen(en_passant="fen").split()[:4])
                by_position.setdefault(key, []).append(
                    [first.uci(), second.uci(), third.uci()]
                )
    unique = [
        (position, lines[0])
        for position, lines in by_position.items()
        if len(lines) == 1
    ]
    unique.sort(
        key=lambda item: hashlib.sha256(
            f"proofgame:{seed}:{item[0]}".encode("utf-8")
        ).hexdigest()
    )
    problems: list[ComposedProblem] = []
    for position, line in unique[:count]:
        board = chess.Board()
        for token in line:
            board.push(chess.Move.from_uci(token))
        fen = board.fen(en_passant="fen")
        if not proofgame.verify_proofgame(fen, line, n_plies=3):
            continue
        digest = hashlib.sha256(position.encode("utf-8")).hexdigest()
        problems.append(
            ComposedProblem(
                id=f"chessbench-gen-proofgame-{digest[:12]}",
                fen=fen,
                kind="proofgame",
                n=3,
                solution=line,
                themes=["computer-generated", "unique-exact-length"],
                source="chessbench-generator-v1",
                provenance={
                    "generator": "unique-three-ply-enumerator-v1",
                    "seed": seed,
                },
                certification={"exhaustive_unique_target_at_three_plies": True},
            )
        )
    return problems


def generate(
    *, popeye_bin: pathlib.Path, per_kind: int, seed: int, max_candidates: int
) -> list[ComposedProblem]:
    rng = random.Random(seed)
    problems: list[ComposedProblem] = []
    seen: set[str] = set()
    for kind in SEARCH_KINDS:
        accepted: list[ComposedProblem] = []
        for candidate_index in range(max_candidates):
            board = _random_board(rng, kind)
            if board is None:
                continue
            position = " ".join(board.fen(en_passant="fen").split()[:4])
            if position in seen:
                continue
            try:
                problem = _admit(
                    board,
                    kind,
                    popeye_bin=popeye_bin,
                    seed=seed,
                    candidate_index=candidate_index,
                )
            except subprocess.TimeoutExpired:
                continue
            if problem is None:
                continue
            seen.add(position)
            accepted.append(problem)
            print(f"{kind}: {len(accepted)}/{per_kind} at candidate {candidate_index}")
            if len(accepted) >= per_kind:
                break
        if len(accepted) < per_kind:
            raise RuntimeError(
                f"{kind}: found {len(accepted)} originals after {max_candidates} candidates"
            )
        problems.extend(accepted)
    problems.extend(_proofgames(per_kind, seed=seed))
    if len(problems) != per_kind * (len(SEARCH_KINDS) + 1):
        raise RuntimeError("proofgame enumerator did not produce the requested count")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--popeye", type=pathlib.Path, required=True)
    parser.add_argument("--per-kind", type=int, default=10)
    parser.add_argument("--seed", type=int, default=20260714)
    parser.add_argument("--max-candidates", type=int, default=75_000)
    parser.add_argument(
        "--corpus-out",
        type=pathlib.Path,
        default=pathlib.Path("corpora/private/esoteric-original-mvp-v1.json"),
    )
    parser.add_argument(
        "--suite-out",
        type=pathlib.Path,
        default=pathlib.Path("suites/private/esoteric-original-mvp-v1.json"),
    )
    parser.add_argument(
        "--manifest-dir", type=pathlib.Path, default=pathlib.Path("corpora/manifests")
    )
    args = parser.parse_args()
    problems = generate(
        popeye_bin=args.popeye,
        per_kind=args.per_kind,
        seed=args.seed,
        max_candidates=args.max_candidates,
    )
    source = asdict(
        CorpusSource(
            id="chessbench-generator-v1",
            title="ChessBench deterministic composition search",
            url="https://chessbench.hunterchen.workers.dev",
            license="MIT",
            license_url="https://opensource.org/license/mit",
            snapshot=f"generator-v1 seed {args.seed}",
            notes="Popeye solution/cook certificate plus independent native verification.",
        )
    )
    corpus = Corpus(
        name="esoteric-original-mvp-v1",
        title="ChessBench-generated esoteric MVP",
        version="1.0.0",
        track="esoteric",
        visibility="private",
        description="Fresh sparse compositions plus exhaustively unique three-ply proof games.",
        item_type="composed",
        sources=[source],
        selection={
            "algorithm": "deterministic sparse candidate search certified by Popeye and native verifier",
            "seed": args.seed,
            "per_kind": args.per_kind,
            "kinds": [*SEARCH_KINDS, "proofgame"],
        },
        items=[
            asdict(problem)
            for problem in sorted(problems, key=lambda problem: problem.id)
        ],
    )
    save_corpus(corpus, args.corpus_out)
    suite = freeze_composed_suite(
        corpus.composed_problems(),
        name=corpus.name,
        version=corpus.version,
        visibility="private",
        source_label=f"corpus:{corpus.name}@{corpus.content_hash}",
    )
    save_suite(suite, args.suite_out)
    save_corpus_manifest(corpus, args.manifest_dir / f"{corpus.name}.corpus.json")
    save_suite_manifest(suite, args.manifest_dir / f"{suite.name}.suite.json")
    print(f"private original corpus: {len(corpus.items)} items; {corpus.content_hash}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
