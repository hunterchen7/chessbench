"""CLI: run the puzzle track.

Examples
--------
Baselines (no API key needed) -- proves the pipeline and grading end to end:
    python -m chessbench puzzles --agent random   --limit 200
    python -m chessbench puzzles --agent stockfish --limit 200 --nodes 200000

An LLM under the headline (free-form, unaided) condition:
    python -m chessbench puzzles --agent anthropic --model claude-opus-4-8 --limit 100

Sweep an ablation axis:
    python -m chessbench puzzles --agent stockfish --legality legal_list --representation fen
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .conditions import Condition, ContextMode, Legality, Notation, PromptStyle, Representation
from .report import format_report
from .tasks.puzzles import load_puzzles
from .tasks.runner import run_puzzles

DEFAULT_DATA = Path(__file__).resolve().parent.parent / "data" / "sample_puzzles.csv"


def _build_agent(args):
    from .agents import FirstLegalAgent, LLMAgent, RandomAgent, StockfishAgent

    if args.agent == "random":
        return RandomAgent(seed=args.seed), None
    if args.agent == "first_legal":
        return FirstLegalAgent(), None
    if args.agent == "stockfish":
        from .core.engine import EngineConfig

        sf = StockfishAgent(config=EngineConfig(nodes=args.nodes)).__enter__()
        return sf, sf  # second value is the closer
    if args.agent == "anthropic":
        from .models import AnthropicModel

        return LLMAgent(AnthropicModel(args.model or "claude-opus-4-8")), None
    if args.agent == "openai":
        from .models import OpenAIModel

        return LLMAgent(OpenAIModel(args.model or "gpt-4.1")), None
    raise SystemExit(f"unknown agent: {args.agent}")


def cmd_puzzles(args) -> int:
    condition = Condition(
        legality=Legality(args.legality),
        representation=Representation(args.representation),
        notation=Notation(args.notation),
        prompt_style=PromptStyle(args.prompt_style),
        retry_attempts=args.retry_attempts,
        temperature=args.temperature,
    )
    puzzles = load_puzzles(args.data, limit=args.limit)
    print(f"loaded {len(puzzles)} puzzles from {args.data}")
    print(f"condition: {condition.slug()} (temp={condition.temperature})\n")

    agent, closer = _build_agent(args)
    try:
        report, _ = run_puzzles(
            agent, puzzles, condition, log_path=args.log, progress_every=args.progress
        )
    finally:
        if closer is not None:
            closer.__exit__(None, None, None)

    print(format_report(report))
    return 0


def _build_player(spec: str, model_id: str | None, args, closers: list):
    from .agents import FirstLegalAgent, LLMGameAgent, RandomAgent, StockfishAgent
    from .core.engine import EngineConfig

    if spec == "random":
        return RandomAgent(seed=args.seed)
    if spec == "first_legal":
        return FirstLegalAgent()
    if spec == "stockfish":
        cfg = EngineConfig(nodes=args.sf_nodes, skill_level=args.sf_skill)
        sf = StockfishAgent(config=cfg).__enter__()
        closers.append(sf)
        return sf
    cond = _condition_from_args(args)
    if spec == "anthropic":
        from .models import AnthropicModel

        return LLMGameAgent(AnthropicModel(model_id or "claude-opus-4-8"), cond)
    if spec == "openai":
        from .models import OpenAIModel

        return LLMGameAgent(OpenAIModel(model_id or "gpt-4.1"), cond)
    raise SystemExit(f"unknown player: {spec}")


def _condition_from_args(args) -> Condition:
    return Condition(
        legality=Legality(args.legality),
        representation=Representation(args.representation),
        notation=Notation(args.notation),
        prompt_style=PromptStyle(args.prompt_style),
        context_mode=ContextMode(args.context_mode),
        retry_attempts=args.retry_attempts,
        temperature=args.temperature,
    )


def cmd_play(args) -> int:
    from .tasks.games import GameConfig, play_match

    condition = _condition_from_args(args)
    config = GameConfig(max_plies=args.max_plies)
    print(f"condition: {condition.game_slug()} (temp={condition.temperature})")
    print(f"{args.white} (White-start) vs {args.black}, {args.games} game(s), cap {args.max_plies} plies\n")

    closers: list = []
    try:
        a = _build_player(args.white, args.white_model, args, closers)
        b = _build_player(args.black, args.black_model, args, closers)
        res = play_match(a, b, args.games, condition, config)
    finally:
        for c in closers:
            c.__exit__(None, None, None)

    print(f"score: {res.a} {res.a_wins}  /  draws {res.draws}  /  {res.b} {res.b_wins}")
    print(f"{res.a} score: {res.a_score:.1%}")
    ed = res.elo_diff()
    print(f"Elo({res.a}) - Elo({res.b}) ~ {ed:+.0f}" if ed is not None else "Elo diff: n/a (shutout)")
    for i, g in enumerate(res.games, 1):
        print(f"  game {i}: {g.result:>7}  {g.termination:<16} {g.plies} plies  "
              f"(illegal-move rate W+B {g.illegal_rate():.1%})")
    if args.pgn_out:
        with open(args.pgn_out, "w", encoding="utf-8") as f:
            f.write("\n\n".join(g.pgn for g in res.games))
        print(f"\nwrote PGNs -> {args.pgn_out}")
    return 0


def _add_condition_args(p) -> None:
    p.add_argument("--legality", default="free_form", choices=[e.value for e in Legality])
    p.add_argument("--representation", default="fen_ascii", choices=[e.value for e in Representation])
    p.add_argument("--notation", default="san", choices=[e.value for e in Notation])
    p.add_argument("--prompt-style", dest="prompt_style", default="minimal",
                   choices=[e.value for e in PromptStyle])
    p.add_argument("--retry-attempts", type=int, default=3)
    p.add_argument("--temperature", type=float, default=0.0)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="chessbench")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("puzzles", help="run the puzzle track")
    p.add_argument("--agent", default="random",
                   choices=["random", "first_legal", "stockfish", "anthropic", "openai"])
    p.add_argument("--model", default=None, help="model id for LLM agents")
    p.add_argument("--data", default=str(DEFAULT_DATA))
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--nodes", type=int, default=200_000, help="Stockfish node limit")
    _add_condition_args(p)
    p.add_argument("--log", default=None, help="write per-puzzle results to this JSONL file")
    p.add_argument("--progress", type=int, default=0, help="print progress every N puzzles")
    p.set_defaults(func=cmd_puzzles)

    g = sub.add_parser("play", help="run the game track (agent vs agent)")
    g.add_argument("--white", default="stockfish",
                   choices=["random", "first_legal", "stockfish", "anthropic", "openai"])
    g.add_argument("--black", default="random",
                   choices=["random", "first_legal", "stockfish", "anthropic", "openai"])
    g.add_argument("--white-model", default=None)
    g.add_argument("--black-model", default=None)
    g.add_argument("--games", type=int, default=1)
    g.add_argument("--max-plies", type=int, default=200)
    g.add_argument("--seed", type=int, default=0)
    g.add_argument("--sf-nodes", type=int, default=100_000, help="node limit for stockfish players")
    g.add_argument("--sf-skill", type=int, default=3, help="Stockfish Skill Level 0-20 for stockfish players")
    g.add_argument("--context-mode", dest="context_mode", default="fresh",
                   choices=[e.value for e in ContextMode])
    _add_condition_args(g)
    g.add_argument("--pgn-out", default=None, help="write game PGNs to this file")
    g.set_defaults(func=cmd_play)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
