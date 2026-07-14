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
from dataclasses import replace
from pathlib import Path
from typing import TYPE_CHECKING

from .conditions import (
    Condition, ContextMode, Legality, Notation, PromptStyle, Representation, mode_condition,
)
from .report import format_report
from .store import RunRecord, SuiteRef, save_run
from .tasks.puzzles import load_puzzles
from .tasks.runner import run_puzzles

if TYPE_CHECKING:
    from .agents import Agent
    from .core.engine import Engine
    from .models import Model
    from .tasks.composed import ComposedSolver

DEFAULT_DATA = Path(__file__).resolve().parent.parent / "data" / "sample_puzzles.csv"
DEFAULT_COMPOSED = Path(__file__).resolve().parent.parent / "data" / "composed_problems.json"


def _base_condition(args: argparse.Namespace) -> Condition:
    """Build a Condition from --mode (preset) or the individual axis flags, then
    layer the always-explicit axes (notation, context, explain, temperature, ...)."""
    if getattr(args, "mode", None):
        cond = mode_condition(int(args.mode))
    else:
        cond = Condition(
            legality=Legality(args.legality),
            representation=Representation(args.representation),
            prompt_style=PromptStyle(args.prompt_style),
        )
    return replace(
        cond,
        notation=Notation(args.notation),
        context_mode=ContextMode(getattr(args, "context_mode", "fresh")),
        retry_attempts=args.retry_attempts,
        otb_illegal_limit=args.otb_limit,
        explain=args.explain,
        temperature=args.temperature,
    )


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
    if args.agent == "openrouter-vision":
        from .agents import VisionAgent
        from .models import OpenRouterModel

        return VisionAgent(OpenRouterModel(args.model or "google/gemma-4-26b-a4b-it:free"))
    raise SystemExit(f"unknown agent: {args.agent}")


def cmd_puzzles(args: argparse.Namespace) -> int:
    condition = _base_condition(args)
    suite_ref = None
    if args.suite:
        from .suite import load_suite

        suite = load_suite(args.suite)
        puzzles = suite.puzzles()
        suite_ref = SuiteRef(suite.name, suite.version, suite.visibility, suite.content_hash)
        print(f"suite: {suite.name} v{suite.version} [{suite.visibility}] {suite.content_hash} ({len(puzzles)} puzzles)")
    else:
        puzzles = load_puzzles(args.data, limit=args.limit)
        print(f"loaded {len(puzzles)} puzzles from {args.data}")
    print(f"condition: {condition.slug()} (temp={condition.temperature})\n")

    with ExitStack() as stack:
        agent = _build_agent(args, stack)
        report, results = run_puzzles(agent, puzzles, condition, log_path=args.log, progress_every=args.progress)

    print(format_report(report))

    if args.save_run:
        model = getattr(agent, "_model", None)
        cost = getattr(model, "total_cost", None)
        record = RunRecord(
            model=args.model or agent.name, provider=args.agent, condition=condition,
            report=report, results=results, puzzles={p.id: p for p in puzzles},
            suite=suite_ref, cost_usd=cost,
        )
        save_run(record, args.save_run)
        print(f"\nsaved run -> {args.save_run}")
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
    return _base_condition(args)


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

    condition = _base_condition(args)
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
        return replace(_base_condition(args), legality=Legality(legality))

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


def cmd_models(args: argparse.Namespace) -> int:
    from .registry import ModelEntry, add_model, load_registry

    if args.models_action == "add":
        add_model(ModelEntry(label=args.label, provider=args.provider, model_id=args.model_id,
                             family=args.family or "", notes=args.notes or ""))
        print(f"registered {args.label} ({args.provider}:{args.model_id})")
        return 0
    for e in load_registry():
        flag = "" if e.enabled else " (disabled)"
        print(f"  {e.label:<22} {e.provider}:{e.model_id}{flag}")
    return 0


def cmd_run_model(args: argparse.Namespace) -> int:
    """Enroll+run: build a registry model, run a suite, save a run record. Skips
    the model×suite×condition cell if its run file already exists (incremental)."""
    from .agents import LLMAgent
    from .registry import get_model
    from .suite import load_suite

    entry = get_model(args.model)
    suite = load_suite(args.suite)
    condition = _base_condition(args)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{entry.label}__{condition.slug()}.json"
    if out.exists() and not args.force:
        print(f"skip (exists): {out}  — use --force to recompute")
        return 0

    print(f"running {entry.label} on suite {suite.name} [{condition.slug()}] ({len(suite.puzzles())} puzzles)...")
    model = _build_model(entry.provider, entry.model_id)
    agent = LLMAgent(model)
    report, results = run_puzzles(agent, suite.puzzles(), condition, progress_every=args.progress)
    print(format_report(report))
    record = RunRecord(
        model=entry.model_id, provider=entry.provider, condition=condition, report=report,
        results=results, puzzles={p.id: p for p in suite.puzzles()},
        suite=SuiteRef(suite.name, suite.version, suite.visibility, suite.content_hash),
        cost_usd=getattr(model, "total_cost", None),
    )
    save_run(record, out)
    print(f"\nsaved run -> {out}")
    return 0


def cmd_category_leaderboard(args: argparse.Namespace) -> int:
    """Per-category rankings from saved run records (offline)."""
    from .leaderboards import category_leaderboard, format_category_leaderboard, load_runs

    runs = load_runs(args.runs_dir)
    if not runs:
        print(f"no run records in {args.runs_dir}")
        return 0
    board = category_leaderboard(runs, min_n=args.min_n, dim=args.dim)
    print(f"per-category leaderboard from {len(runs)} run(s)"
          + (f", dimension '{args.dim}'" if args.dim else "") + "  (* = unbounded Elo)")
    print(format_category_leaderboard(board))
    return 0


def cmd_sprt(args: argparse.Namespace) -> int:
    """A-vs-B with sequential early stopping (SPRT)."""
    from .sprt import sprt_match
    from .tasks.games import GameConfig

    condition = _condition_from_args(args)
    config = GameConfig(max_plies=args.max_plies)
    openings = None
    if args.openings == "book":
        from .openings import opening_fens

        openings = opening_fens()
    print(f"SPRT: {args.a} vs {args.b} | H0 elo<={args.elo0} vs H1 elo>={args.elo1} "
          f"| alpha={args.alpha} beta={args.beta} | max {args.max_games} games\n")
    with ExitStack() as stack:
        a = _build_player(args.a, args.a_model, args, stack)
        b = _build_player(args.b, args.b_model, args, stack)
        status, games = sprt_match(a, b, condition, config, elo0=args.elo0, elo1=args.elo1,
                                   alpha=args.alpha, beta=args.beta, max_games=args.max_games, openings=openings)
    verdict = {"accept_h1": f"{args.a} is stronger (accept H1)",
               "accept_h0": f"no evidence {args.a} is stronger (accept H0)",
               "continue": "inconclusive at max games"}[status.decision]
    print(f"result: {status.wins}-{status.draws}-{status.losses} ({status.score:.1%}) over {status.n} games")
    print(f"LLR {status.llr:+.2f}  (bounds {status.lower:.2f} .. {status.upper:.2f})  ->  {verdict}")
    return 0


def cmd_export(args: argparse.Namespace) -> int:
    """Write data/index.json (puzzle runs) and data/tournaments/index.json (games)."""
    import json

    from .store import json_safe, list_runs, list_tournaments

    runs = list_runs(args.runs_dir)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(json_safe({"schema": "chessbench.index.v1", "runs": runs}), f, indent=1)
    print(f"indexed {len(runs)} run(s) -> {args.out}")

    tdir = Path(args.runs_dir).parent / "tournaments"
    if tdir.is_dir():
        tournaments = list_tournaments(tdir)
        with open(tdir / "index.json", "w", encoding="utf-8") as f:
            json.dump(json_safe({"schema": "chessbench.tournament_index.v1", "tournaments": tournaments}), f, indent=1)
        print(f"indexed {len(tournaments)} tournament(s) -> {tdir / 'index.json'}")
    return 0


def cmd_tournament(args: argparse.Namespace) -> int:
    """Round-robin among LLMs (+ optional Stockfish anchor) -> game-Elo."""
    from .agents import LLMAgent, RandomAgent, StockfishAgent
    from .core.engine import Engine, EngineConfig, find_stockfish
    from .tasks.games import GameConfig
    from .tasks.tournament import TournamentEntry, format_tournament, round_robin

    condition = _condition_from_args(args)
    config = GameConfig(max_plies=args.max_plies, eval_moves=args.eval_moves)
    model_ids = [m.strip() for m in args.models.split(",") if m.strip()]
    print(f"tournament: {len(model_ids)} models, {args.games} games/pair, condition {condition.game_slug()}\n")

    anchor: dict[str, float] | None = None
    with ExitStack() as stack:
        entries = [TournamentEntry(mid, LLMAgent(_build_model(args.provider, mid), condition)) for mid in model_ids]
        if args.include_random:
            entries.append(TournamentEntry("random", RandomAgent(seed=args.seed)))
        eval_engine = None
        if (args.anchor_elo is not None or args.eval_moves) and find_stockfish():
            eng = stack.enter_context(Engine(EngineConfig(nodes=args.sf_nodes, skill_level=args.sf_skill)))
            eval_engine = eng if args.eval_moves else None
            if args.anchor_elo is not None:
                sf = stack.enter_context(StockfishAgent(engine=eng))
                label = f"stockfish(sk{args.sf_skill})"
                entries.append(TournamentEntry(label, sf, fixed_rating=args.anchor_elo))
                anchor = {label: float(args.anchor_elo)}
        openings = None
        if args.openings == "book":
            from .openings import opening_fens

            openings = opening_fens()

        pusher = None
        if args.stream:
            import os
            from datetime import datetime, timezone

            from .stream import StreamPusher

            base, token = os.environ.get("CHESSBENCH_API"), os.environ.get("CHESSBENCH_INGEST_TOKEN")
            if not base or not token:
                raise SystemExit("--stream needs CHESSBENCH_API and CHESSBENCH_INGEST_TOKEN in the env")
            tid = args.tid or (Path(args.save).stem if args.save else "live")
            pusher = StreamPusher(base, token, tid, condition_slug=condition.game_slug(),
                                  players=[e.label for e in entries],
                                  created=datetime.now(timezone.utc).isoformat(timespec="seconds"))
            print(f"streaming games live to {base} as tournament '{tid}'")

        result = round_robin(entries, args.games, condition, config, eval_engine=eval_engine, openings=openings,
                             on_game=pusher.on_game if pusher else None,
                             on_move=pusher.on_move if pusher else None)

    print(format_tournament(result))
    if args.pgn_out:
        with open(args.pgn_out, "w", encoding="utf-8") as f:
            f.write(result.pgns())
        print(f"\nwrote {len(result.games)} game PGNs -> {args.pgn_out}")
    if args.save or pusher:
        from .store import TournamentRecord, json_safe, save_tournament

        record = TournamentRecord(result, condition, args.max_plies, anchor=anchor)
        if args.save:
            save_tournament(record, args.save)
            print(f"saved tournament -> {args.save}")
        if pusher:
            pusher.push_final(json_safe(record.to_dict()))  # flip the live view to the final rated table
            print("pushed final standings to the backend")
    return 0


def _add_condition_args(p: argparse.ArgumentParser) -> None:
    # Mode presets (override the individual axes below). Default run = MODE 2.
    p.add_argument("--mode", type=int, default=None, choices=[1, 2, 3],
                   help="1=raw fen+pieces, 2=+legal moves (default), 3=+coaching tips")
    # Individual axes default to MODE 2 (hand-holding: legal moves in SAN & UCI).
    p.add_argument("--legality", default="legal_list", choices=[e.value for e in Legality])
    p.add_argument("--representation", default="fen_pieces", choices=[e.value for e in Representation])
    p.add_argument("--notation", default="san", choices=[e.value for e in Notation])
    p.add_argument("--prompt-style", dest="prompt_style", default="minimal",
                   choices=[e.value for e in PromptStyle])
    p.add_argument("--retry-attempts", type=int, default=3)
    p.add_argument("--otb-limit", dest="otb_limit", type=int, default=2,
                   help="Nth cumulative illegal move that forfeits under --legality otb")
    p.add_argument("--explain", action="store_true", help="invite an optional explanation with the move")
    p.add_argument("--temperature", type=float, default=1.0,
                   help="sampling temperature; default 1.0 (models' native default). Use 0.0 for deterministic runs.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="chessbench")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("puzzles", help="run the puzzle track")
    p.add_argument("--agent", default="random",
                   choices=["random", "first_legal", "stockfish", "anthropic", "openai", "openrouter", "openrouter-vision"])
    p.add_argument("--model", default=None, help="model id for LLM agents")
    p.add_argument("--data", default=str(DEFAULT_DATA))
    p.add_argument("--suite", default=None, help="run a frozen suite (same items for every model) instead of --data")
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--nodes", type=int, default=200_000, help="Stockfish node limit")
    _add_condition_args(p)
    p.add_argument("--log", default=None, help="write per-puzzle results to this JSONL file")
    p.add_argument("--save-run", dest="save_run", default=None,
                   help="write a full run record JSON (for the web app) to this path")
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
    t.add_argument("--models", default="", help="comma-separated model ids (empty = baselines only)")
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
    t.add_argument("--save", default=None, help="save a tournament record JSON (for the web games viewer)")
    t.add_argument("--stream", action="store_true",
                   help="stream games live to the backend as they play (needs CHESSBENCH_API + "
                        "CHESSBENCH_INGEST_TOKEN env); durable per-game, watchable per-move")
    t.add_argument("--tid", default=None, help="tournament id for --stream (defaults to the --save basename)")
    t.add_argument("--eval-moves", dest="eval_moves", action="store_true",
                   help="Stockfish-evaluate each move (per-move centipawns / accuracy)")
    t.add_argument("--openings", default="none", choices=["book", "none"],
                   help="diversify games from an opening book vs the standard start (default). "
                        "At temperature 1.0 games self-diversify, so the book is opt-in.")
    _add_condition_args(t)
    t.set_defaults(func=cmd_tournament)

    e = sub.add_parser("export", help="write data/index.json listing run records for the web app")
    e.add_argument("--runs-dir", dest="runs_dir", default="webapp/data/runs")
    e.add_argument("--out", default="webapp/data/index.json")
    e.set_defaults(func=cmd_export)

    sp = sub.add_parser("sprt", help="A-vs-B with sequential early stopping (SPRT)")
    sp.add_argument("--a", default="openrouter", choices=["random", "first_legal", "stockfish", "anthropic", "openai", "openrouter"])
    sp.add_argument("--b", default="random", choices=["random", "first_legal", "stockfish", "anthropic", "openai", "openrouter"])
    sp.add_argument("--a-model", dest="a_model", default=None)
    sp.add_argument("--b-model", dest="b_model", default=None)
    sp.add_argument("--elo0", type=float, default=0.0, help="H0: A's Elo edge <= this")
    sp.add_argument("--elo1", type=float, default=20.0, help="H1: A's Elo edge >= this")
    sp.add_argument("--alpha", type=float, default=0.05)
    sp.add_argument("--beta", type=float, default=0.05)
    sp.add_argument("--max-games", dest="max_games", type=int, default=200)
    sp.add_argument("--max-plies", dest="max_plies", type=int, default=200)
    sp.add_argument("--openings", default="none", choices=["book", "none"])
    sp.add_argument("--seed", type=int, default=0)
    sp.add_argument("--sf-nodes", type=int, default=100_000)
    sp.add_argument("--sf-skill", type=int, default=3)
    sp.add_argument("--context-mode", dest="context_mode", default="fresh", choices=[e.value for e in ContextMode])
    _add_condition_args(sp)
    sp.set_defaults(func=cmd_sprt)

    cl = sub.add_parser("category-leaderboard", help="per-category rankings from saved run records")
    cl.add_argument("--runs-dir", dest="runs_dir", default="webapp/data/runs")
    cl.add_argument("--dim", default=None,
                    choices=["tier", "phase", "motif", "mate_pattern", "goal", "length"],
                    help="restrict to one category dimension")
    cl.add_argument("--min-n", dest="min_n", type=int, default=3)
    cl.set_defaults(func=cmd_category_leaderboard)

    m = sub.add_parser("models", help="model registry (list / add)")
    m.add_argument("models_action", nargs="?", default="list", choices=["list", "add"])
    m.add_argument("--label")
    m.add_argument("--provider", default="openrouter", choices=["openrouter", "openai", "anthropic"])
    m.add_argument("--model-id", dest="model_id")
    m.add_argument("--family", default="")
    m.add_argument("--notes", default="")
    m.set_defaults(func=cmd_models)

    rmp = sub.add_parser("run-model", help="run a registry model through a suite (incremental, saves a run record)")
    rmp.add_argument("--model", required=True, help="registry label (see `chessbench models`)")
    rmp.add_argument("--suite", required=True)
    rmp.add_argument("--out-dir", dest="out_dir", default="webapp/data/runs")
    rmp.add_argument("--force", action="store_true", help="recompute even if the run file exists")
    rmp.add_argument("--progress", type=int, default=10)
    _add_condition_args(rmp)
    rmp.set_defaults(func=cmd_run_model)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
