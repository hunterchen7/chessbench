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
from contextlib import ExitStack
from pathlib import Path
from typing import TYPE_CHECKING

from .conditions import Condition, ContextMode, Legality, Notation, PromptStyle, Representation
from .report import format_report
from .tasks.puzzles import load_puzzles
from .tasks.runner import run_puzzles

if TYPE_CHECKING:
    from .agents import Agent
    from .core.engine import Engine
    from .models import Model
    from .tasks.composed import ComposedSolver

DEFAULT_DATA = Path(__file__).resolve().parent.parent / "data" / "sample_puzzles.csv"
DEFAULT_COMPOSED = Path(__file__).resolve().parent.parent / "data" / "composed_problems.json"


def _build_agent(args: argparse.Namespace, stack: ExitStack) -> Agent:
    from .agents import FirstLegalAgent, LLMAgent, RandomAgent, StockfishAgent

    if args.agent == "random":
        return RandomAgent(seed=args.seed)
    if args.agent == "first_legal":
        return FirstLegalAgent()
    if args.agent == "stockfish":
        from .core.engine import EngineConfig

        return stack.enter_context(StockfishAgent(config=EngineConfig(nodes=args.nodes)))
    if args.agent == "anthropic":
        from .models import AnthropicModel

        return LLMAgent(AnthropicModel(args.model or "claude-opus-4-8"))
    if args.agent == "openai":
        from .models import OpenAIModel

        return LLMAgent(OpenAIModel(args.model or "gpt-4.1"))
    if args.agent == "openrouter":
        from .models import OpenRouterModel

        return LLMAgent(OpenRouterModel(args.model or "openai/gpt-4o-mini"))
    raise SystemExit(f"unknown agent: {args.agent}")


def cmd_puzzles(args: argparse.Namespace) -> int:
    condition = Condition(
        legality=Legality(args.legality),
        representation=Representation(args.representation),
        notation=Notation(args.notation),
        prompt_style=PromptStyle(args.prompt_style),
        retry_attempts=args.retry_attempts,
        otb_illegal_limit=args.otb_limit, explain=args.explain,
        temperature=args.temperature,
    )
    if args.suite:
        from .suite import load_suite

        suite = load_suite(args.suite)
        puzzles = suite.puzzles()
        print(f"suite: {suite.name} v{suite.version} [{suite.visibility}] {suite.content_hash} ({len(puzzles)} puzzles)")
    else:
        puzzles = load_puzzles(args.data, limit=args.limit)
        print(f"loaded {len(puzzles)} puzzles from {args.data}")
    print(f"condition: {condition.slug()} (temp={condition.temperature})\n")

    with ExitStack() as stack:
        agent = _build_agent(args, stack)
        report, _ = run_puzzles(agent, puzzles, condition, log_path=args.log, progress_every=args.progress)

    print(format_report(report))
    return 0


def _build_player(spec: str, model_id: str | None, args: argparse.Namespace, stack: ExitStack) -> Agent:
    from .agents import FirstLegalAgent, LLMGameAgent, RandomAgent, StockfishAgent
    from .core.engine import EngineConfig

    if spec == "random":
        return RandomAgent(seed=args.seed)
    if spec == "first_legal":
        return FirstLegalAgent()
    if spec == "stockfish":
        cfg = EngineConfig(nodes=args.sf_nodes, skill_level=args.sf_skill)
        return stack.enter_context(StockfishAgent(config=cfg))
    cond = _condition_from_args(args)
    if spec == "anthropic":
        from .models import AnthropicModel

        return LLMGameAgent(AnthropicModel(model_id or "claude-opus-4-8"), cond)
    if spec == "openai":
        from .models import OpenAIModel

        return LLMGameAgent(OpenAIModel(model_id or "gpt-4.1"), cond)
    if spec == "openrouter":
        from .models import OpenRouterModel

        return LLMGameAgent(OpenRouterModel(model_id or "openai/gpt-4o-mini"), cond)
    raise SystemExit(f"unknown player: {spec}")


def _condition_from_args(args: argparse.Namespace) -> Condition:
    return Condition(
        legality=Legality(args.legality),
        representation=Representation(args.representation),
        notation=Notation(args.notation),
        prompt_style=PromptStyle(args.prompt_style),
        context_mode=ContextMode(args.context_mode),
        retry_attempts=args.retry_attempts,
        otb_illegal_limit=args.otb_limit, explain=args.explain,
        temperature=args.temperature,
    )


def cmd_play(args: argparse.Namespace) -> int:
    from .tasks.games import GameConfig, play_match

    condition = _condition_from_args(args)
    config = GameConfig(max_plies=args.max_plies)
    print(f"condition: {condition.game_slug()} (temp={condition.temperature})")
    print(f"{args.white} (White-start) vs {args.black}, {args.games} game(s), cap {args.max_plies} plies\n")

    with ExitStack() as stack:
        a = _build_player(args.white, args.white_model, args, stack)
        b = _build_player(args.black, args.black_model, args, stack)
        res = play_match(a, b, args.games, condition, config)

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


def _build_composed_solver(spec: str, model_id: str | None, seed: int) -> ComposedSolver:
    from .tasks.composed import LLMComposedSolver, OracleComposedSolver, RandomComposedSolver

    if spec == "oracle":
        return OracleComposedSolver()
    if spec == "random":
        return RandomComposedSolver(seed=seed)
    if spec in ("anthropic", "openai", "openrouter"):
        return LLMComposedSolver(_build_model(spec, model_id))
    raise SystemExit(f"unknown solver: {spec}")


def cmd_composed(args: argparse.Namespace) -> int:
    from .core.engine import Engine, EngineConfig
    from .solvers import grade_study
    from .tasks.composed import grade_composed, load_composed

    condition = Condition(
        legality=Legality(args.legality),
        representation=Representation(args.representation),
        notation=Notation(args.notation),
        prompt_style=PromptStyle(args.prompt_style),
        retry_attempts=args.retry_attempts,
        otb_illegal_limit=args.otb_limit, explain=args.explain,
        temperature=args.temperature,
    )
    problems = load_composed(args.data)
    solver = _build_composed_solver(args.solver, args.model, args.seed)
    print(f"solver: {solver.name} | condition: {condition.slug()}")
    print(f"problems: {len(problems)} from {args.data}\n")

    by_kind: dict[str, list[bool]] = {}
    needs_engine = any(p.answer_shape == "play" for p in problems)

    with ExitStack() as stack:
        engine = stack.enter_context(Engine(EngineConfig(nodes=args.sf_nodes))) if needs_engine else None
        study_agent = _build_study_agent(args, engine, stack)
        for p in problems:
            if p.answer_shape == "play":
                assert engine is not None
                res = grade_study(study_agent, p.fen, p.goal or "win", engine, condition)
                solved, detail = res.solved, res.outcome
            else:
                r = grade_composed(solver, p, condition)
                solved, detail = r.solved, r.detail
            by_kind.setdefault(p.kind, []).append(solved)
            print(f"  {p.id:<14} {p.label:<20} {'SOLVED' if solved else 'failed':<7} {detail}")

    print("\nby stipulation:")
    total = solved_total = 0
    for kind, outs in sorted(by_kind.items()):
        s, n = sum(outs), len(outs)
        total += n
        solved_total += s
        print(f"  {kind:<18} {s}/{n}")
    print(f"  {'TOTAL':<18} {solved_total}/{total}")
    return 0


def _build_study_agent(args: argparse.Namespace, engine: "Engine | None", stack: ExitStack) -> Agent:
    from .agents import LLMGameAgent, RandomAgent, StockfishAgent

    spec = args.solver
    if spec == "random":
        return RandomAgent(seed=args.seed)
    if spec in ("oracle", "stockfish"):
        return StockfishAgent(engine=engine)  # oracle stand-in for interactive studies
    return LLMGameAgent(_build_model(spec, args.model))


def _build_model(spec: str, model_id: str | None) -> "Model":
    from .models import AnthropicModel, OpenAIModel, OpenRouterModel

    if spec == "anthropic":
        return AnthropicModel(model_id or "claude-opus-4-8")
    if spec == "openai":
        return OpenAIModel(model_id or "gpt-4.1")
    if spec == "openrouter":
        return OpenRouterModel(model_id or "openai/gpt-4o-mini")
    raise SystemExit(f"unknown model provider: {spec}")


def cmd_suite_build(args: argparse.Namespace) -> int:
    from .suite import build_puzzle_suite, save_suite
    from .tasks.puzzles import load_puzzles

    source = load_puzzles(args.source)
    suite = build_puzzle_suite(
        source, name=args.name, version=args.version, visibility=args.visibility,
        source_label=args.source_label, per_bucket=args.per_bucket, seed=args.seed,
    )
    save_suite(suite, args.out)
    ratings = sorted(int(it["rating"]) for it in suite.items)  # type: ignore[call-overload]
    print(f"built suite '{suite.name}' v{suite.version} [{suite.visibility}] -> {args.out}")
    print(f"  {len(suite.items)} puzzles, ratings {ratings[0]}-{ratings[-1]}, {suite.content_hash}")
    if suite.visibility == "private":
        print("  NOTE: private suite -- keep it out of the public repo (suites/private/ is gitignored).")
    return 0


def _elo_cell(est) -> str:
    if est is None:
        return "n/a"
    if not est.bounded:
        return f"{'≥' if est.rating >= 2000 else '≤'}{est.rating:.0f}"
    lo, hi = est.ci95()
    return f"{est.rating:.0f}±{(hi - lo) / 2:.0f}"


def cmd_leaderboard(args: argparse.Namespace) -> int:
    """Puzzle-Elo leaderboard on ONE frozen suite. With --legalities it becomes a
    matrix of Elo per setting ("elo using the different settings")."""
    from .agents import LLMAgent, RandomAgent, StockfishAgent
    from .core.engine import EngineConfig, find_stockfish
    from .suite import load_suite

    suite = load_suite(args.suite)
    puzzles = suite.puzzles()
    legalities = [s.strip() for s in (args.legalities or args.legality).split(",") if s.strip()]

    def condition_for(legality: str) -> Condition:
        return Condition(
            legality=Legality(legality), representation=Representation(args.representation),
            notation=Notation(args.notation), prompt_style=PromptStyle(args.prompt_style),
            retry_attempts=args.retry_attempts, otb_illegal_limit=args.otb_limit, explain=args.explain,
            temperature=args.temperature,
        )

    print(f"leaderboard on suite '{suite.name}' {suite.content_hash} "
          f"({len(puzzles)} puzzles, identical for every model)")
    print(f"settings: legality={legalities}, {args.representation}/{args.notation}/{args.prompt_style}\n")

    model_ids = [m.strip() for m in args.models.split(",") if m.strip()]
    # rows[name] = {legality: RatingEstimate, "_solved": solve_rate under first legality}
    rows: dict[str, dict[str, object]] = {}
    with ExitStack() as stack:
        agents: list[Agent] = []
        if args.include_baselines:
            agents.append(RandomAgent())
            if find_stockfish():
                agents.append(stack.enter_context(StockfishAgent(config=EngineConfig(nodes=args.sf_nodes))))
        agents.extend(LLMAgent(_build_model(args.provider, mid)) for mid in model_ids)

        for agent in agents:
            rows[agent.name] = {}
            for legality in legalities:
                print(f"  running {agent.name} [{legality}] ...")
                report, _ = run_puzzles(agent, puzzles, condition_for(legality))
                rows[agent.name][legality] = report.elo
                if legality == legalities[0]:
                    rows[agent.name]["_solved"] = report.solve_rate
                    rows[agent.name]["_legal"] = report.first_move_legal_rate

    order = sorted(rows, key=lambda name: getattr(rows[name][legalities[0]], "rating", 0.0), reverse=True)
    header = f"{'model':<38} " + " ".join(f"{lg:>12}" for lg in legalities) + f" {'solved':>7} {'legal':>7}"
    print("\n" + header)
    print("-" * len(header))
    for name in order:
        cells = " ".join(f"{_elo_cell(rows[name][lg]):>12}" for lg in legalities)
        solved = rows[name].get("_solved", 0.0)
        legal = rows[name].get("_legal", 0.0)
        print(f"{name:<38} {cells} {solved:>6.1%} {legal:>6.1%}")  # type: ignore[str-format]
    print("\npuzzle-Elo = MLE performance rating (rating±half-95%-CI); ≥/≤ = solved all/none")
    return 0


def cmd_tournament(args: argparse.Namespace) -> int:
    """Round-robin among LLMs (+ optional Stockfish anchor) -> game-Elo."""
    from .agents import LLMAgent, RandomAgent, StockfishAgent
    from .core.engine import Engine, EngineConfig, find_stockfish
    from .tasks.games import GameConfig
    from .tasks.tournament import TournamentEntry, format_tournament, round_robin

    condition = _condition_from_args(args)
    config = GameConfig(max_plies=args.max_plies)
    model_ids = [m.strip() for m in args.models.split(",") if m.strip()]
    print(f"tournament: {len(model_ids)} models, {args.games} games/pair, condition {condition.game_slug()}\n")

    with ExitStack() as stack:
        entries = [TournamentEntry(mid, LLMAgent(_build_model(args.provider, mid), condition)) for mid in model_ids]
        if args.include_random:
            entries.append(TournamentEntry("random", RandomAgent(seed=args.seed)))
        if args.anchor_elo is not None and find_stockfish():
            sf = stack.enter_context(StockfishAgent(config=EngineConfig(nodes=args.sf_nodes, skill_level=args.sf_skill)))
            entries.append(TournamentEntry(f"stockfish(sk{args.sf_skill})", sf, fixed_rating=args.anchor_elo))
        result = round_robin(entries, args.games, condition, config)

    print(format_tournament(result))
    if args.pgn_out:
        with open(args.pgn_out, "w", encoding="utf-8") as f:
            f.write(result.pgns())
        print(f"\nwrote {len(result.games)} game PGNs -> {args.pgn_out}")
    return 0


def _add_condition_args(p: argparse.ArgumentParser) -> None:
    p.add_argument("--legality", default="free_form", choices=[e.value for e in Legality])
    p.add_argument("--representation", default="fen_ascii", choices=[e.value for e in Representation])
    p.add_argument("--notation", default="san", choices=[e.value for e in Notation])
    p.add_argument("--prompt-style", dest="prompt_style", default="minimal",
                   choices=[e.value for e in PromptStyle])
    p.add_argument("--retry-attempts", type=int, default=3)
    p.add_argument("--otb-limit", dest="otb_limit", type=int, default=2,
                   help="Nth cumulative illegal move that forfeits under --legality otb")
    p.add_argument("--explain", action="store_true", help="invite an optional explanation with the move")
    p.add_argument("--temperature", type=float, default=0.0)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="chessbench")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("puzzles", help="run the puzzle track")
    p.add_argument("--agent", default="random",
                   choices=["random", "first_legal", "stockfish", "anthropic", "openai", "openrouter"])
    p.add_argument("--model", default=None, help="model id for LLM agents")
    p.add_argument("--data", default=str(DEFAULT_DATA))
    p.add_argument("--suite", default=None, help="run a frozen suite (same items for every model) instead of --data")
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--nodes", type=int, default=200_000, help="Stockfish node limit")
    _add_condition_args(p)
    p.add_argument("--log", default=None, help="write per-puzzle results to this JSONL file")
    p.add_argument("--progress", type=int, default=0, help="print progress every N puzzles")
    p.set_defaults(func=cmd_puzzles)

    g = sub.add_parser("play", help="run the game track (agent vs agent)")
    g.add_argument("--white", default="stockfish",
                   choices=["random", "first_legal", "stockfish", "anthropic", "openai", "openrouter"])
    g.add_argument("--black", default="random",
                   choices=["random", "first_legal", "stockfish", "anthropic", "openai", "openrouter"])
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

    c = sub.add_parser("composed", help="run the composed/esoteric track")
    c.add_argument("--solver", default="oracle",
                   choices=["oracle", "random", "anthropic", "openai", "openrouter"])
    c.add_argument("--model", default=None, help="model id for LLM solvers")
    c.add_argument("--data", default=str(DEFAULT_COMPOSED))
    c.add_argument("--seed", type=int, default=0)
    c.add_argument("--sf-nodes", type=int, default=120_000, help="engine nodes for study adjudication")
    _add_condition_args(c)
    c.set_defaults(func=cmd_composed)

    sb = sub.add_parser("suite", help="build a frozen benchmark suite (identical items for every model)")
    sb.add_argument("--source", required=True, help="puzzle source CSV/JSON to sample from")
    sb.add_argument("--name", required=True)
    sb.add_argument("--version", default="1")
    sb.add_argument("--visibility", default="public", choices=["public", "private"])
    sb.add_argument("--source-label", dest="source_label", default="lichess")
    sb.add_argument("--per-bucket", dest="per_bucket", type=int, default=20)
    sb.add_argument("--seed", type=int, default=0)
    sb.add_argument("--out", required=True)
    sb.set_defaults(func=cmd_suite_build)

    lb = sub.add_parser("leaderboard", help="puzzle-Elo of several models on the SAME suite")
    lb.add_argument("--suite", required=True)
    lb.add_argument("--provider", default="openrouter", choices=["openrouter", "openai", "anthropic"])
    lb.add_argument("--models", required=True, help="comma-separated model ids")
    lb.add_argument("--legalities", default=None,
                    help="comma-separated legality settings to sweep (Elo per setting); defaults to --legality")
    lb.add_argument("--include-baselines", dest="include_baselines", action="store_true",
                    help="also run random + stockfish for reference")
    lb.add_argument("--sf-nodes", type=int, default=200_000)
    _add_condition_args(lb)
    lb.set_defaults(func=cmd_leaderboard)

    t = sub.add_parser("tournament", help="round-robin among LLMs -> game-Elo")
    t.add_argument("--models", required=True, help="comma-separated model ids")
    t.add_argument("--provider", default="openrouter", choices=["openrouter", "openai", "anthropic"])
    t.add_argument("--games", type=int, default=2, help="games per pair (colors alternate)")
    t.add_argument("--max-plies", type=int, default=200)
    t.add_argument("--seed", type=int, default=0)
    t.add_argument("--include-random", dest="include_random", action="store_true", help="add a random baseline")
    t.add_argument("--anchor-elo", dest="anchor_elo", type=float, default=None,
                   help="pin a Stockfish player to this Elo to set an absolute scale")
    t.add_argument("--sf-nodes", type=int, default=100_000)
    t.add_argument("--sf-skill", type=int, default=3)
    t.add_argument("--context-mode", dest="context_mode", default="fresh", choices=[e.value for e in ContextMode])
    t.add_argument("--pgn-out", default=None)
    _add_condition_args(t)
    t.set_defaults(func=cmd_tournament)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
