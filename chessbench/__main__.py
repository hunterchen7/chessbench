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
import os
import sys
from contextlib import ExitStack
from dataclasses import replace
from pathlib import Path
from typing import TYPE_CHECKING

from .conditions import (
    CachePolicy,
    Condition,
    ContextMode,
    Legality,
    Notation,
    PromptStyle,
    Representation,
    mode_condition,
)
from .report import format_report
from .response_protocols import ResponseProtocol
from .store import RunRecord, SuiteRef, save_run
from .tasks.puzzles import load_puzzles
from .tasks.runner import run_puzzles

if TYPE_CHECKING:
    from .agents import Agent
    from .core.engine import Engine
    from .models import Model
    from .report import PuzzleReport
    from .tasks.composed import ComposedSolver
    from .tasks.puzzles import PuzzleResult

DEFAULT_DATA = Path(__file__).resolve().parent.parent / "data" / "sample_puzzles.csv"
DEFAULT_COMPOSED = (
    Path(__file__).resolve().parent.parent / "data" / "composed_problems.json"
)


def _run_model_output_path(
    out_dir: Path,
    *,
    variant_key: str,
    condition_slug: str,
    suite_name: str,
    suite_hash: str,
    run_id: str,
) -> Path:
    """Choose a collision-free run export while finishing legacy partials in place."""
    import hashlib
    import json
    import re

    legacy = out_dir / f"{variant_key}__{condition_slug}.json"
    if legacy.is_file():
        try:
            with legacy.open(encoding="utf-8") as file:
                payload = json.load(file)
        except (json.JSONDecodeError, OSError):
            payload = None
        if isinstance(payload, dict) and payload.get("run_id") == run_id:
            return legacy

    suite_slug = re.sub(r"[^a-z0-9]+", "-", suite_name.lower()).strip("-")
    suite_slug = suite_slug[:64] or "suite"
    hash_slug = suite_hash.removeprefix("sha256:")[:16] or "unhashed"
    filename = f"{variant_key}__suite-{suite_slug}--{hash_slug}__{condition_slug}.json"
    # Provider-route and reasoning-capture identities can make the descriptive
    # name exceed common 255-byte filesystem limits. Keep readable identity
    # fragments and hash the complete name so distinct configurations cannot
    # collide.
    if len(filename.encode("utf-8")) > 240:
        config_hash = hashlib.sha256(filename.encode("utf-8")).hexdigest()[:16]
        filename = (
            f"{variant_key[:96]}__suite-{suite_slug[:48]}--{hash_slug}"
            f"__cfg-{config_hash}.json"
        )
    return out_dir / filename


def _usage_int(value: object) -> int:
    return int(value) if isinstance(value, (str, int, float)) else 0


def _usage_float(value: object) -> float:
    return float(value) if isinstance(value, (str, int, float)) else 0.0


def _sync_completed_run(db_path: str, run_id: str, *, disabled: bool = False) -> None:
    """Best-effort publish after local completion; the SQLite outbox stays canonical."""
    if disabled:
        print("publish: skipped by --no-sync")
        return
    api = os.environ.get("CHESSBENCH_API")
    token = os.environ.get("CHESSBENCH_INGEST_TOKEN")
    if not api or not token:
        print("publish: local only (Cloudflare credentials are not configured)")
        return

    from .cloudflare_sync import sync_run
    from .database import BenchmarkStore

    try:
        with BenchmarkStore(db_path) as store:
            sent, failed = sync_run(store, api, token, run_id)
    except Exception as exc:
        print(
            f"[warn] Cloudflare publish failed; the complete run remains in the "
            f"local outbox: {type(exc).__name__}: {exc}",
            file=sys.stderr,
        )
        return
    if failed:
        print(
            f"[warn] published {sent} item(s); {failed} remain queued in the local outbox",
            file=sys.stderr,
        )
    else:
        print(f"publish: Cloudflare D1 is current ({sent} newly delivered item(s))")


def _turn_usage_totals(
    turns: list[dict[str, object]],
) -> tuple[int, int, int, float]:
    """Aggregate audited turns without double-counting reasoning tokens.

    Game/study envelopes expose a normalized ``reasoning_tokens`` field while
    provider usage often exposes the same value inside
    ``completion_tokens_details``. Prefer the provider field when present and
    only fall back to the normalized field.
    """
    prompt = completion = reasoning = 0
    cost = 0.0
    for turn in turns:
        usage = turn.get("usage")
        turn_reasoning: object | None = None
        if isinstance(usage, dict):
            prompt += _usage_int(usage.get("prompt_tokens", 0))
            completion += _usage_int(usage.get("completion_tokens", 0))
            details = usage.get("completion_tokens_details")
            if isinstance(details, dict) and "reasoning_tokens" in details:
                turn_reasoning = details.get("reasoning_tokens")
            elif "reasoning_tokens" in usage:
                turn_reasoning = usage.get("reasoning_tokens")
        else:
            # Puzzle turns store their normalized audit fields at the top level.
            prompt += _usage_int(turn.get("prompt_tokens", 0))
            completion += _usage_int(turn.get("completion_tokens", 0))
        if turn_reasoning is None:
            turn_reasoning = turn.get("reasoning_tokens", 0)
        reasoning += _usage_int(turn_reasoning)
        cost += _usage_float(turn.get("cost_usd", 0.0))
    return prompt, completion, reasoning, cost


def _turn_cache_totals(
    turns: list[dict[str, object]],
) -> tuple[int, int, int, float]:
    """Aggregate normalized prompt-cache accounting from audited turns."""
    cache_read = cache_write = uncached_prompt = 0
    cache_discount = 0.0
    for turn in turns:
        cache_read += _usage_int(turn.get("cache_read_tokens", 0))
        cache_write += _usage_int(turn.get("cache_write_tokens", 0))
        uncached_prompt += _usage_int(turn.get("uncached_prompt_tokens", 0))
        cache_discount += _usage_float(turn.get("cache_discount_usd", 0.0))
    return cache_read, cache_write, uncached_prompt, cache_discount


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
        context_mode=ContextMode(getattr(args, "context_mode", "hybrid")),
        retry_attempts=args.retry_attempts,
        otb_illegal_limit=args.otb_limit,
        explain=args.explain,
        response_protocol=ResponseProtocol(
            getattr(args, "response_protocol", ResponseProtocol.JSON_SCHEMA_V1.value)
        ),
        temperature=args.temperature,
        reasoning_effort=getattr(args, "reasoning", None),
        reasoning_max_tokens=getattr(args, "reasoning_tokens", None),
        reasoning_exclude=not getattr(args, "capture_reasoning", True),
        max_output_tokens=getattr(args, "max_output_tokens", 0),
        cache_policy=CachePolicy(
            getattr(args, "cache_policy", CachePolicy.PROMPT_PREFIX_V1.value)
        ),
    )


def _build_agent(
    args: argparse.Namespace, stack: ExitStack, condition: Condition
) -> Agent:
    from .agents import FirstLegalAgent, LLMAgent, RandomAgent, StockfishAgent

    if args.agent == "random":
        return RandomAgent(seed=args.seed)
    if args.agent == "first_legal":
        return FirstLegalAgent()
    if args.agent == "stockfish":
        from .core.engine import EngineConfig

        return stack.enter_context(
            StockfishAgent(config=EngineConfig(nodes=args.nodes))
        )
    if args.agent == "anthropic":
        from .models import AnthropicModel

        return LLMAgent(AnthropicModel(args.model or "claude-opus-4-8"), condition)
    if args.agent == "openai":
        from .models import OpenAIModel

        return LLMAgent(OpenAIModel(args.model or "gpt-4.1"), condition)
    if args.agent == "openrouter":
        from .models import OpenRouterModel

        return LLMAgent(
            OpenRouterModel(
                args.model or "openai/gpt-4o-mini",
                reasoning_effort=getattr(args, "reasoning", None),
                reasoning_max_tokens=getattr(args, "reasoning_tokens", None),
                reasoning_exclude=not getattr(args, "capture_reasoning", True),
            ),
            condition,
        )
    if args.agent == "openrouter-vision":
        from .agents import VisionAgent
        from .models import OpenRouterModel

        return VisionAgent(
            OpenRouterModel(args.model or "google/gemma-4-26b-a4b-it:free")
        )
    raise SystemExit(f"unknown agent: {args.agent}")


def cmd_puzzles(args: argparse.Namespace) -> int:
    condition = _base_condition(args)
    suite_ref = None
    if args.suite:
        from .suite import load_suite

        suite = load_suite(args.suite)
        puzzles = suite.puzzles()
        suite_ref = SuiteRef(
            suite.name, suite.version, suite.visibility, suite.content_hash
        )
        print(
            f"suite: {suite.name} v{suite.version} [{suite.visibility}] {suite.content_hash} ({len(puzzles)} puzzles)"
        )
    else:
        puzzles = load_puzzles(args.data, limit=args.limit)
        print(f"loaded {len(puzzles)} puzzles from {args.data}")
    print(f"condition: {condition.slug()} (temp={condition.temperature})\n")

    # A saved run auto-checkpoints per puzzle, so a killed run resumes on re-run.
    ckpt = args.save_run + ".ckpt.jsonl" if args.save_run else None

    with ExitStack() as stack:
        agent = _build_agent(args, stack, condition)
        report, results = run_puzzles(
            agent,
            puzzles,
            condition,
            log_path=args.log,
            progress_every=args.progress,
            resume_path=ckpt,
        )

    print(format_report(report))

    if args.save_run:
        model = getattr(agent, "_model", None)
        cost = getattr(model, "total_cost", None)
        record = RunRecord(
            model=args.model or agent.name,
            provider=args.agent,
            condition=condition,
            report=report,
            results=results,
            puzzles={p.id: p for p in puzzles},
            suite=suite_ref,
            cost_usd=cost,
        )
        save_run(record, args.save_run)
        print(f"\nsaved run -> {args.save_run}")
        if ckpt:
            Path(ckpt).unlink(missing_ok=True)  # run complete -> drop the checkpoint
    return 0


def cmd_woodpecker(args: argparse.Namespace) -> int:
    """Run the one-shot full-variation puzzle track."""
    args.mode = 4
    return cmd_puzzles(args)


def _build_player(
    spec: str, model_id: str | None, args: argparse.Namespace, stack: ExitStack
) -> Agent:
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

        return LLMGameAgent(
            OpenRouterModel(
                model_id or "openai/gpt-4o-mini",
                reasoning_effort=cond.reasoning_effort,
                reasoning_max_tokens=cond.reasoning_max_tokens,
            ),
            cond,
        )
    raise SystemExit(f"unknown player: {spec}")


def _condition_from_args(args: argparse.Namespace) -> Condition:
    return _base_condition(args)


def cmd_play(args: argparse.Namespace) -> int:
    from .tasks.games import GameConfig, play_match

    condition = _condition_from_args(args)
    config = GameConfig(max_plies=args.max_plies)
    print(f"condition: {condition.game_slug()} (temp={condition.temperature})")
    print(
        f"{args.white} (White-start) vs {args.black}, {args.games} game(s), cap {args.max_plies} plies\n"
    )

    with ExitStack() as stack:
        a = _build_player(args.white, args.white_model, args, stack)
        b = _build_player(args.black, args.black_model, args, stack)
        res = play_match(a, b, args.games, condition, config)

    print(f"score: {res.a} {res.a_wins}  /  draws {res.draws}  /  {res.b} {res.b_wins}")
    print(f"{res.a} score: {res.a_score:.1%}")
    for i, g in enumerate(res.games, 1):
        print(
            f"  game {i}: {g.result:>7}  {g.termination:<16} {g.plies} plies  "
            f"(illegal-move rate W+B {g.illegal_rate():.1%})"
        )
    if args.pgn_out:
        with open(args.pgn_out, "w", encoding="utf-8") as f:
            f.write("\n\n".join(g.pgn for g in res.games))
        print(f"\nwrote PGNs -> {args.pgn_out}")
    return 0


def _build_composed_solver(
    spec: str, model_id: str | None, seed: int, condition: Condition
) -> ComposedSolver:
    from .tasks.composed import (
        LLMComposedSolver,
        OracleComposedSolver,
        RandomComposedSolver,
    )

    if spec == "oracle":
        return OracleComposedSolver()
    if spec == "random":
        return RandomComposedSolver(seed=seed)
    if spec in ("anthropic", "openai", "openrouter"):
        return LLMComposedSolver(
            _build_model(
                spec,
                model_id,
                reasoning_effort=condition.reasoning_effort,
                reasoning_max_tokens=condition.reasoning_max_tokens,
                reasoning_exclude=condition.reasoning_exclude,
            )
        )
    raise SystemExit(f"unknown solver: {spec}")


def cmd_composed(args: argparse.Namespace) -> int:
    from dataclasses import asdict

    from .core.engine import Engine, EngineConfig
    from .database import BenchmarkStore, RunSpec
    from .solvers import grade_study
    from .tasks.composed import grade_composed, load_composed
    from .variants import ModelVariant, ReasoningConfig

    condition = _base_condition(args)
    registry_entry = None
    provider_model_id = args.model
    if args.model and args.solver in ("anthropic", "openai", "openrouter"):
        from .registry import get_model

        try:
            registry_entry = get_model(args.model)
        except KeyError:
            pass  # A raw provider model ID remains a supported expert escape hatch.
        else:
            if registry_entry.provider != args.solver:
                raise SystemExit(
                    f"registry model {args.model!r} uses {registry_entry.provider}, "
                    f"not --solver {args.solver}"
                )
            provider_model_id = registry_entry.model_id
    suite = None
    if args.suite:
        from .suite import load_suite

        suite = load_suite(args.suite)
        problems = suite.composed_problems()
    else:
        problems = load_composed(args.data)
    solver = _build_composed_solver(
        args.solver, provider_model_id, args.seed, condition
    )
    model_id = provider_model_id or solver.name
    base_key = registry_entry.label if registry_entry else model_id
    display_name = (
        registry_entry.label if registry_entry else model_id.rsplit("/", 1)[-1]
    )
    variant = ModelVariant(
        base_key=base_key,
        display_name=display_name,
        provider=args.solver,
        model_id=model_id,
        reasoning=ReasoningConfig(
            effort=condition.reasoning_effort,
            max_tokens=condition.reasoning_max_tokens,
            exclude=condition.reasoning_exclude,
        ),
        max_output_tokens=condition.max_output_tokens,
    )
    store = BenchmarkStore(args.db)
    spec = RunSpec(
        "composed",
        variant,
        condition,
        len(problems),
        suite_name=suite.name if suite else None,
        suite_version=suite.version if suite else None,
        suite_hash=suite.content_hash if suite else None,
        suite_visibility=suite.visibility if suite else None,
    )
    handle = store.start_run(spec, force=args.force)
    if handle.status == "completed" and not args.force:
        print(
            f"skip (completed): {variant.label} × {suite.name if suite else args.data}"
        )
        store.close()
        return 0
    store.acquire_run_lock(handle.run_id)
    completed = store.load_benchmark_items(handle.run_id)
    print(f"solver: {solver.name} | condition: {condition.slug()}")
    origin = (
        f"suite {suite.name} v{suite.version} {suite.content_hash}"
        if suite
        else args.data
    )
    print(
        f"problems: {len(problems)} from {origin}; {len(completed)} already durable\n"
    )

    by_kind: dict[str, list[bool]] = {}
    needs_engine = any(p.answer_shape == "play" for p in problems)
    items: list[dict[str, object]] = []

    try:
        with ExitStack() as stack:
            engine = (
                stack.enter_context(Engine(EngineConfig(nodes=args.sf_nodes)))
                if needs_engine
                else None
            )
            study_agent = _build_study_agent(args, engine, stack, condition)
            for sequence, p in enumerate(problems):
                if p.id in completed:
                    item = completed[p.id]
                    solved = bool(item["solved"])
                    detail = str(item["detail"])
                    items.append(item)
                    by_kind.setdefault(p.kind, []).append(solved)
                    print(f"  {p.id:<14} {p.label:<20} resumed {detail}")
                    continue
                if p.answer_shape == "play":
                    assert engine is not None
                    study = grade_study(
                        study_agent, p.fen, p.goal or "win", engine, condition
                    )
                    solved, detail, answer = study.solved, study.outcome, ""
                    first_legal = study.first_move_legal
                    turns = study.turns
                    rationale = None
                    format_values = [
                        turn.get("response_format_valid")
                        for turn in turns
                        if turn.get("response_format_valid") is not None
                    ]
                    format_valid = (
                        all(bool(value) for value in format_values)
                        if format_values
                        else None
                    )
                    format_error = next(
                        (
                            str(turn["response_format_error"])
                            for turn in turns
                            if turn.get("response_format_error")
                        ),
                        None,
                    )
                    result_fields = asdict(study)
                else:
                    result = grade_composed(solver, p, condition)
                    solved, detail, answer = result.solved, result.detail, result.answer
                    first_legal = result.first_move_legal
                    turns = result.turns
                    rationale = result.answer_rationale
                    format_valid = result.response_format_valid
                    format_error = result.response_format_error
                    result_fields = asdict(result)
                item = {
                    "id": p.id,
                    "kind": p.kind,
                    "label": p.label,
                    "n": p.n,
                    "fen": p.fen,
                    "goal": p.goal,
                    "solution": p.solution,
                    "themes": p.themes,
                    "answer_shape": p.answer_shape,
                    "solved": solved,
                    "answer": answer,
                    "answer_rationale": rationale,
                    "response_format_valid": format_valid,
                    "response_format_error": format_error,
                    "detail": detail,
                    "turns": turns,
                    "result": result_fields,
                }
                prompt_tokens, completion_tokens, reasoning_tokens, cost_usd = (
                    _turn_usage_totals(turns)
                )
                cache_read, cache_write, uncached_prompt, cache_discount = (
                    _turn_cache_totals(turns)
                )
                store.save_benchmark_item(
                    handle.run_id,
                    sequence,
                    p.id,
                    item,
                    points=1.0 if solved else 0.0,
                    solved=solved,
                    first_move_legal=first_legal,
                    response_format_valid=format_valid,
                    failure_reason=None if solved else detail,
                    cost_usd=cost_usd,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    reasoning_tokens=reasoning_tokens,
                    cache_read_tokens=cache_read,
                    cache_write_tokens=cache_write,
                    uncached_prompt_tokens=uncached_prompt,
                    cache_discount_usd=cache_discount,
                )
                items.append(item)
                by_kind.setdefault(p.kind, []).append(solved)
                print(
                    f"  {p.id:<14} {p.label:<20} "
                    f"{'SOLVED' if solved else 'failed':<7} {detail}"
                )
    except BaseException as exc:
        store.mark_partial(handle.run_id, str(exc))
        store.close()
        raise

    print("\nby stipulation:")
    total = solved_total = 0
    by_kind_summary: dict[str, dict[str, int]] = {}
    for kind, outs in sorted(by_kind.items()):
        s, n = sum(outs), len(outs)
        total += n
        solved_total += s
        by_kind_summary[kind] = {"solved": s, "n": n}
        print(f"  {kind:<18} {s}/{n}")
    print(f"  {'TOTAL':<18} {solved_total}/{total}")
    summary: dict[str, object] = {
        "n": total,
        "solved": solved_total,
        "solve_rate": solved_total / total if total else 0.0,
        "points": float(solved_total),
        "max_points": float(total),
        "by_kind": by_kind_summary,
    }
    store.finalize_run(handle.run_id, summary)
    store.close()

    if getattr(args, "save_run", None):
        import json
        from datetime import datetime, timezone

        doc = {
            "schema": "chessbench.composed_run.v1",
            "run_id": handle.run_id,
            "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "model": model_id,
            "solver": args.solver,
            "model_variant": variant.to_dict(),
            "suite": suite.manifest() if suite else None,
            "condition": condition.to_dict(),
            "summary": summary,
            "items": items,
        }
        Path(args.save_run).parent.mkdir(parents=True, exist_ok=True)
        with open(args.save_run, "w", encoding="utf-8") as f:
            json.dump(doc, f, indent=1)
        print(f"\nsaved composed run -> {args.save_run}")
    return 0


def _build_study_agent(
    args: argparse.Namespace,
    engine: "Engine | None",
    stack: ExitStack,
    condition: Condition,
) -> Agent:
    from .agents import LLMGameAgent, RandomAgent, StockfishAgent

    spec = args.solver
    if spec == "random":
        return RandomAgent(seed=args.seed)
    if spec in ("oracle", "stockfish"):
        return StockfishAgent(engine=engine)  # oracle stand-in for interactive studies
    return LLMGameAgent(
        _build_model(
            spec,
            args.model,
            reasoning_effort=condition.reasoning_effort,
            reasoning_max_tokens=condition.reasoning_max_tokens,
            reasoning_exclude=condition.reasoning_exclude,
        ),
        condition,
    )


def _build_model(
    spec: str,
    model_id: str | None,
    *,
    reasoning_effort: str | None = None,
    reasoning_max_tokens: int | None = None,
    reasoning_exclude: bool = True,
    request_timeout: float = 120.0,
    provider_preferences: dict[str, object] | None = None,
) -> "Model":
    from .models import AnthropicModel, OpenAIModel, OpenRouterModel

    if spec == "anthropic":
        return AnthropicModel(model_id or "claude-opus-4-8")
    if spec == "openai":
        return OpenAIModel(model_id or "gpt-4.1", timeout=request_timeout)
    if spec == "openrouter":
        return OpenRouterModel(
            model_id or "openai/gpt-4o-mini",
            timeout=request_timeout,
            reasoning_effort=reasoning_effort,
            reasoning_max_tokens=reasoning_max_tokens,
            reasoning_exclude=reasoning_exclude,
            provider_preferences=provider_preferences,
        )
    raise SystemExit(f"unknown model provider: {spec}")


def cmd_suite_build(args: argparse.Namespace) -> int:
    from .suite import build_puzzle_suite, save_suite
    from .tasks.puzzles import load_puzzles

    source = load_puzzles(args.source)
    suite = build_puzzle_suite(
        source,
        name=args.name,
        version=args.version,
        visibility=args.visibility,
        source_label=args.source_label,
        per_bucket=args.per_bucket,
        seed=args.seed,
    )
    save_suite(suite, args.out)
    ratings = sorted(int(it["rating"]) for it in suite.items)  # type: ignore[call-overload]
    print(
        f"built suite '{suite.name}' v{suite.version} [{suite.visibility}] -> {args.out}"
    )
    print(
        f"  {len(suite.items)} puzzles, ratings {ratings[0]}-{ratings[-1]}, {suite.content_hash}"
    )
    if suite.visibility == "private":
        print(
            "  NOTE: private suite -- keep it out of the public repo (suites/private/ is gitignored)."
        )
    return 0


def cmd_leaderboard(args: argparse.Namespace) -> int:
    """Points leaderboard on one frozen suite, optionally swept by condition."""
    from .agents import LLMAgent, RandomAgent, StockfishAgent
    from .core.engine import EngineConfig, find_stockfish
    from .suite import load_suite

    suite = load_suite(args.suite)
    puzzles = suite.puzzles()
    legalities = [
        s.strip() for s in (args.legalities or args.legality).split(",") if s.strip()
    ]

    def condition_for(legality: str) -> Condition:
        return replace(_base_condition(args), legality=Legality(legality))

    print(
        f"leaderboard on suite '{suite.name}' {suite.content_hash} "
        f"({len(puzzles)} puzzles, identical for every model)"
    )
    print(
        f"settings: legality={legalities}, {args.representation}/{args.notation}/{args.prompt_style}\n"
    )

    model_ids = [m.strip() for m in args.models.split(",") if m.strip()]
    # rows[name] = {legality: PuzzleReport, ...}
    rows: dict[str, dict[str, object]] = {}
    with ExitStack() as stack:
        agents: list[Agent] = []
        if args.include_baselines:
            agents.append(RandomAgent())
            if find_stockfish():
                agents.append(
                    stack.enter_context(
                        StockfishAgent(config=EngineConfig(nodes=args.sf_nodes))
                    )
                )
        agents.extend(LLMAgent(_build_model(args.provider, mid)) for mid in model_ids)

        for agent in agents:
            rows[agent.name] = {}
            for legality in legalities:
                print(f"  running {agent.name} [{legality}] ...")
                report, _ = run_puzzles(agent, puzzles, condition_for(legality))
                rows[agent.name][legality] = report
                if legality == legalities[0]:
                    rows[agent.name]["_solved"] = report.solve_rate
                    rows[agent.name]["_legal"] = report.first_move_legal_rate

    order = sorted(
        rows,
        key=lambda name: getattr(rows[name][legalities[0]], "points", 0.0),
        reverse=True,
    )
    header = (
        f"{'model':<38} "
        + " ".join(f"{lg:>12}" for lg in legalities)
        + f" {'solved':>7} {'legal':>7}"
    )
    print("\n" + header)
    print("-" * len(header))
    for name in order:
        cells = " ".join(
            f"{getattr(rows[name][lg], 'points', 0.0):>5.1f}/{getattr(rows[name][lg], 'max_points', 0):<5}"
            for lg in legalities
        )
        solved = rows[name].get("_solved", 0.0)
        legal = rows[name].get("_legal", 0.0)
        print(f"{name:<38} {cells} {solved:>6.1%} {legal:>6.1%}")  # type: ignore[str-format]
    print(
        "\npoints = sum of per-puzzle credit; a full solve is 1 point and correct line prefixes earn partial credit"
    )
    return 0


def cmd_models(args: argparse.Namespace) -> int:
    from .registry import ModelEntry, add_model, load_registry

    if args.models_action == "add":
        add_model(
            ModelEntry(
                label=args.label,
                provider=args.provider,
                model_id=args.model_id,
                family=args.family or "",
                notes=args.notes or "",
            )
        )
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
    from .database import BenchmarkStore, RunSpec
    from .registry import get_model
    from .suite import load_suite
    from .variants import ModelVariant, ProviderRoute, ReasoningConfig

    if args.max_new_items is not None and args.max_new_items < 1:
        raise ValueError("--max-new-items must be positive")
    if args.request_timeout <= 0:
        raise ValueError("--request-timeout must be positive")
    entry = get_model(args.model)
    suite = load_suite(args.suite)
    condition = _base_condition(args)
    provider_route = ProviderRoute(
        only=tuple(args.provider_only),
        order=tuple(args.provider_order),
        allow_fallbacks=args.provider_allow_fallbacks,
        require_parameters=args.require_provider_parameters,
    )
    if entry.provider != "openrouter" and not provider_route.is_default:
        raise ValueError("provider routing options require an OpenRouter model")
    variant = ModelVariant(
        base_key=entry.label,
        display_name=entry.label,
        provider=entry.provider,
        model_id=entry.model_id,
        reasoning=ReasoningConfig(
            effort=condition.reasoning_effort,
            max_tokens=condition.reasoning_max_tokens,
            exclude=condition.reasoning_exclude,
        ),
        max_output_tokens=condition.max_output_tokens,
        provider_route=provider_route,
    )
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    puzzles = suite.puzzles()
    track = "woodpecker" if condition.puzzle_protocol.value == "full_line" else "puzzle"
    spec = RunSpec(
        track,
        variant,
        condition,
        len(puzzles),
        suite_name=suite.name,
        suite_version=suite.version,
        suite_hash=suite.content_hash,
        suite_visibility=suite.visibility,
    )
    store = BenchmarkStore(args.db)
    handle = (
        store.find_run(spec)
        if args.export_only
        else store.start_run(spec, force=args.force)
    )
    if handle is None:
        store.close()
        raise SystemExit("no durable run matches this model, suite, and condition")
    if handle.status == "completed" and not args.force and not args.export_only:
        print(f"skip (completed): {variant.label} × {suite.name} × {condition.slug()}")
        store.close()
        _sync_completed_run(args.db, handle.run_id, disabled=args.no_sync)
        return 0
    if not args.export_only:
        store.acquire_run_lock(handle.run_id)
    out = _run_model_output_path(
        out_dir,
        variant_key=variant.key,
        condition_slug=condition.slug(),
        suite_name=suite.name,
        suite_hash=suite.content_hash,
        run_id=handle.run_id,
    )

    print(
        f"{'exporting' if args.export_only else 'running'} {variant.label} "
        f"on {track} suite {suite.name} "
        f"[{condition.slug()}] ({len(puzzles)} puzzles, {handle.completed_items} already durable)..."
    )
    completed = store.load_puzzle_results(handle.run_id)

    def persist(seq: int, puzzle, result) -> None:
        prompt_tokens, completion_tokens, reasoning_tokens, item_cost = (
            _turn_usage_totals(result.turns)
        )
        cache_read, cache_write, uncached_prompt, cache_discount = _turn_cache_totals(
            result.turns
        )
        store.save_puzzle_result(
            handle.run_id,
            seq,
            puzzle,
            result,
            cost_usd=item_cost,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            reasoning_tokens=reasoning_tokens,
            cache_read_tokens=cache_read,
            cache_write_tokens=cache_write,
            uncached_prompt_tokens=uncached_prompt,
            cache_discount_usd=cache_discount,
        )

    def persist_checkpoint(seq: int, puzzle, state) -> None:
        store.save_puzzle_checkpoint(handle.run_id, seq, puzzle.id, state)

    def export_snapshot(
        results: list[PuzzleResult],
        report: PuzzleReport,
        row: dict[str, object],
    ) -> None:
        total_cost = _usage_float(row.get("cost_usd"))
        record = RunRecord(
            model=entry.model_id,
            provider=entry.provider,
            condition=condition,
            report=report,
            results=results,
            puzzles={p.id: p for p in puzzles},
            suite=SuiteRef(
                suite.name,
                suite.version,
                suite.visibility,
                suite.content_hash,
            ),
            cost_usd=total_cost,
            run_id=handle.run_id,
            model_variant=variant.to_dict(),
            created=str(row.get("created_at") or ""),
            status=str(row.get("status") or "partial"),
            progress={
                "completed": _usage_int(row.get("completed_items")),
                "total": _usage_int(row.get("total_items")) or len(puzzles),
            },
            usage={
                "cost_usd": total_cost,
                "prompt_tokens": _usage_int(row.get("prompt_tokens")),
                "completion_tokens": _usage_int(row.get("completion_tokens")),
                "reasoning_tokens": _usage_int(row.get("reasoning_tokens")),
                "cache_read_tokens": _usage_int(row.get("cache_read_tokens")),
                "cache_write_tokens": _usage_int(row.get("cache_write_tokens")),
                "uncached_prompt_tokens": _usage_int(row.get("uncached_prompt_tokens")),
                "cache_discount_usd": _usage_float(row.get("cache_discount_usd")),
            },
            error=str(row["error"]) if row.get("error") else None,
            updated_at=str(row.get("updated_at") or ""),
            completed_at=(
                str(row["completed_at"]) if row.get("completed_at") else None
            ),
        )
        save_run(record, out)

    if args.export_only:
        durable_results = [
            completed[puzzle.id] for puzzle in puzzles if puzzle.id in completed
        ]
        from .report import build_report

        snapshot_report = build_report(
            entry.model_id, condition.slug(), durable_results
        )
        export_snapshot(durable_results, snapshot_report, store.run_row(handle.run_id))
        store.close()
        print(
            f"exported {len(durable_results)}/{len(puzzles)} durable item(s) "
            f"without inference -> {out}"
        )
        return 0

    model = _build_model(
        entry.provider,
        entry.model_id,
        reasoning_effort=condition.reasoning_effort,
        reasoning_max_tokens=condition.reasoning_max_tokens,
        reasoning_exclude=condition.reasoning_exclude,
        request_timeout=args.request_timeout,
        provider_preferences=provider_route.to_request(),
    )
    agent = LLMAgent(model, condition, cache_namespace=handle.run_id)
    checkpoints = store.load_puzzle_checkpoints(handle.run_id)

    try:
        report, results = run_puzzles(
            agent,
            puzzles,
            condition,
            progress_every=args.progress,
            max_new_items=args.max_new_items,
            max_consecutive_unsolved=args.max_consecutive_unsolved,
            completed=completed,
            checkpoints=checkpoints,
            on_checkpoint=persist_checkpoint,
            on_result=persist,
        )
    except BaseException as exc:
        store.mark_partial(handle.run_id, str(exc))
        try:
            durable = store.load_puzzle_results(handle.run_id)
            durable_results = [
                durable[puzzle.id] for puzzle in puzzles if puzzle.id in durable
            ]
            from .report import build_report

            partial_report = build_report(
                entry.model_id, condition.slug(), durable_results
            )
            export_snapshot(
                durable_results, partial_report, store.run_row(handle.run_id)
            )
            print(
                f"\npartial {handle.run_id}; wrote resumable JSON export -> {out}",
                file=sys.stderr,
            )
        except Exception as export_exc:
            print(
                f"[warn] failed to export partial run {handle.run_id}: {export_exc}",
                file=sys.stderr,
            )
        finally:
            store.close()
        raise
    row = store.run_row(handle.run_id)
    incomplete = _usage_int(row.get("completed_items")) < len(puzzles)
    trailing_unsolved = 0
    for result in reversed(results):
        if result.solved:
            break
        trailing_unsolved += 1
    reason: str | None = None
    if args.max_new_items is not None and incomplete:
        reason = f"operator stop after {args.max_new_items} new item(s)"
    elif (
        args.max_consecutive_unsolved is not None
        and incomplete
        and trailing_unsolved >= args.max_consecutive_unsolved
    ):
        reason = store.finalize_stopped_puzzle_run(
            handle.run_id,
            report,
            consecutive_unsolved=trailing_unsolved,
        )
        row = store.run_row(handle.run_id)
        export_snapshot(results, report, row)
        store.close()
        print(f"\ncompleted {handle.run_id}; {reason}; wrote JSON export -> {out}")
        _sync_completed_run(args.db, handle.run_id, disabled=args.no_sync)
        return 0
    if reason is not None:
        store.mark_partial(handle.run_id, reason)
        durable = store.load_puzzle_results(handle.run_id)
        durable_results = [
            durable[puzzle.id] for puzzle in puzzles if puzzle.id in durable
        ]
        from .report import build_report

        partial_report = build_report(entry.model_id, condition.slug(), durable_results)
        export_snapshot(durable_results, partial_report, store.run_row(handle.run_id))
        store.close()
        print(f"\npartial {handle.run_id}; {reason}; wrote resumable JSON export -> {out}")
        return 0

    # Each item already incremented the durable aggregate exactly once. Do not
    # replace it with this process's model.total_cost: a resumed process only
    # knows about its newly-issued calls.
    store.finalize_puzzle_run(handle.run_id, report)
    row = store.run_row(handle.run_id)
    export_snapshot(results, report, row)
    store.close()
    print(format_report(report))
    print(f"\ncompleted {handle.run_id}; wrote JSON export -> {out}")
    _sync_completed_run(args.db, handle.run_id, disabled=args.no_sync)
    return 0


def cmd_category_leaderboard(args: argparse.Namespace) -> int:
    """Per-category rankings from saved run records (offline)."""
    from .leaderboards import (
        category_leaderboard,
        format_category_leaderboard,
        load_runs,
    )

    runs = load_runs(args.runs_dir)
    if not runs:
        print(f"no run records in {args.runs_dir}")
        return 0
    board = category_leaderboard(runs, min_n=args.min_n, dim=args.dim)
    print(
        f"per-category points from {len(runs)} run(s)"
        + (f", dimension '{args.dim}'" if args.dim else "")
    )
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
    print(
        f"SPRT: {args.a} vs {args.b} | H0 elo<={args.elo0} vs H1 elo>={args.elo1} "
        f"| alpha={args.alpha} beta={args.beta} | max {args.max_games} games\n"
    )
    with ExitStack() as stack:
        a = _build_player(args.a, args.a_model, args, stack)
        b = _build_player(args.b, args.b_model, args, stack)
        status, games = sprt_match(
            a,
            b,
            condition,
            config,
            elo0=args.elo0,
            elo1=args.elo1,
            alpha=args.alpha,
            beta=args.beta,
            max_games=args.max_games,
            openings=openings,
        )
    verdict = {
        "accept_h1": f"{args.a} is stronger (accept H1)",
        "accept_h0": f"no evidence {args.a} is stronger (accept H0)",
        "continue": "inconclusive at max games",
    }[status.decision]
    print(
        f"result: {status.wins}-{status.draws}-{status.losses} ({status.score:.1%}) over {status.n} games"
    )
    print(
        f"LLR {status.llr:+.2f}  (bounds {status.lower:.2f} .. {status.upper:.2f})  ->  {verdict}"
    )
    return 0


def cmd_export(args: argparse.Namespace) -> int:
    """Rebuild deterministic static indexes for puzzle, composed, and game runs."""
    import json

    from .store import json_safe, list_composed_runs, list_runs, list_tournaments

    runs = list_runs(args.runs_dir)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(
            json_safe({"schema": "chessbench.index.v2", "runs": runs}), f, indent=1
        )
        f.write("\n")
    print(f"indexed {len(runs)} run(s) -> {args.out}")

    cdir = Path(args.runs_dir).parent / "composed"
    if cdir.is_dir():
        composed = list_composed_runs(cdir)
        with open(cdir / "index.json", "w", encoding="utf-8") as f:
            json.dump(
                json_safe(
                    {
                        "schema": "chessbench.composed_index.v1",
                        "runs": composed,
                    }
                ),
                f,
                indent=1,
            )
            f.write("\n")
        print(f"indexed {len(composed)} composed run(s) -> {cdir / 'index.json'}")

    tdir = Path(args.runs_dir).parent / "tournaments"
    if tdir.is_dir():
        tournaments = list_tournaments(tdir)
        with open(tdir / "index.json", "w", encoding="utf-8") as f:
            json.dump(
                json_safe(
                    {
                        "schema": "chessbench.tournament_index.v1",
                        "tournaments": tournaments,
                    }
                ),
                f,
                indent=1,
            )
            f.write("\n")
        print(f"indexed {len(tournaments)} tournament(s) -> {tdir / 'index.json'}")
    return 0


def cmd_tournament(args: argparse.Namespace) -> int:
    """Round-robin among LLMs (+ optional Stockfish baseline) -> match points."""
    import hashlib
    import json
    from dataclasses import asdict

    from .agents import LLMGameAgent, RandomAgent, StockfishAgent
    from .core.engine import Engine, EngineConfig, find_stockfish
    from .database import BenchmarkStore, RunSpec
    from .store import TournamentRecord, json_safe, save_tournament
    from .tasks.games import GameConfig
    from .tasks.tournament import TournamentEntry, format_tournament, round_robin
    from .variants import ModelVariant, ReasoningConfig

    condition = _condition_from_args(args)
    config = GameConfig(max_plies=args.max_plies, eval_moves=args.eval_moves)
    model_ids = [m.strip() for m in args.models.split(",") if m.strip()]
    print(
        f"tournament: {len(model_ids)} models, {args.games} games/pair, condition {condition.game_slug()}\n"
    )

    store: BenchmarkStore | None = None
    run_id: str | None = None
    pusher = None
    try:
        with ExitStack() as stack:
            entries = [
                TournamentEntry(
                    mid,
                    LLMGameAgent(
                        _build_model(
                            args.provider,
                            mid,
                            reasoning_effort=condition.reasoning_effort,
                            reasoning_max_tokens=condition.reasoning_max_tokens,
                            reasoning_exclude=condition.reasoning_exclude,
                        ),
                        condition,
                    ),
                )
                for mid in model_ids
            ]
            if args.include_random:
                entries.append(TournamentEntry("random", RandomAgent(seed=args.seed)))
            eval_engine = None
            if (args.include_stockfish or args.eval_moves) and find_stockfish():
                eng = stack.enter_context(
                    Engine(EngineConfig(nodes=args.sf_nodes, skill_level=args.sf_skill))
                )
                eval_engine = eng if args.eval_moves else None
                if args.include_stockfish:
                    sf = stack.enter_context(StockfishAgent(engine=eng))
                    label = f"stockfish(sk{args.sf_skill})"
                    entries.append(TournamentEntry(label, sf))
            openings = None
            if args.openings == "book":
                from .openings import opening_fens

                openings = opening_fens()

            labels = [entry.label for entry in entries]
            manifest: dict[str, object] = {
                "players": labels,
                "games_per_pair": args.games,
                "max_plies": args.max_plies,
                "eval_moves": args.eval_moves,
                "opening_fens": openings or [None],
                "seed": args.seed,
                "stockfish_nodes": args.sf_nodes if args.include_stockfish else None,
                "stockfish_skill": args.sf_skill if args.include_stockfish else None,
            }
            manifest_json = json.dumps(
                manifest, sort_keys=True, separators=(",", ":"), ensure_ascii=True
            )
            manifest_hash = hashlib.sha256(manifest_json.encode()).hexdigest()
            variant = ModelVariant(
                base_key=f"tournament-{manifest_hash[:16]}",
                display_name=" vs ".join(labels) or "empty tournament",
                provider=args.provider,
                model_id=",".join(labels),
                reasoning=ReasoningConfig(
                    effort=condition.reasoning_effort,
                    max_tokens=condition.reasoning_max_tokens,
                    exclude=condition.reasoning_exclude,
                ),
                max_output_tokens=condition.max_output_tokens,
            )
            total_games = len(entries) * (len(entries) - 1) // 2 * args.games
            spec = RunSpec(
                "tournament",
                variant,
                condition,
                total_games,
                suite_name="standard-start-games"
                if openings is None
                else "opening-book-games",
                suite_version="1",
                suite_hash=f"sha256:{manifest_hash[:16]}",
                suite_visibility="private",
            )
            store = BenchmarkStore(args.db)
            handle = store.start_run(spec, force=args.force)
            run_id = handle.run_id
            store.acquire_run_lock(handle.run_id)
            completed_games = store.load_game_results(handle.run_id)
            in_progress_games = store.load_in_progress_games(handle.run_id)
            print(
                f"durable run {handle.run_id}: {len(completed_games)}/{total_games} "
                f"games complete, {len(in_progress_games)} resumable"
            )

            if args.stream:
                import os
                from datetime import datetime, timezone

                from .stream import StreamPusher

                base = os.environ.get("CHESSBENCH_API")
                token = os.environ.get("CHESSBENCH_INGEST_TOKEN")
                if not base or not token:
                    raise SystemExit(
                        "--stream needs CHESSBENCH_API and "
                        "CHESSBENCH_INGEST_TOKEN in the env"
                    )
                tid = args.tid or (Path(args.save).stem if args.save else "live")
                pusher = StreamPusher(
                    base,
                    token,
                    tid,
                    condition_slug=condition.game_slug(),
                    players=labels,
                    created=datetime.now(timezone.utc).isoformat(timespec="seconds"),
                )
                print(f"streaming games live to {base} as tournament '{tid}'")
                # Cloudflare delivery is intentionally best-effort while paid
                # play continues. Replaying the complete local ledger here
                # closes any crash/network window from the previous process;
                # both remote endpoints are idempotent.
                for sequence, durable_game in sorted(completed_games.items()):
                    pusher.on_game(durable_game, sequence)
                for sequence, durable_game in sorted(in_progress_games.items()):
                    pusher.replay_progress(durable_game, sequence)
                if completed_games or in_progress_games:
                    print(
                        f"replayed {len(completed_games)} completed and "
                        f"{len(in_progress_games)} in-progress game(s) to Cloudflare"
                    )

            def persist_game(record, sequence: int) -> None:
                assert store is not None and run_id is not None
                store.save_game_result(run_id, sequence, record)
                if pusher is not None:
                    pusher.on_game(record, sequence)

            def start_game(
                white: str,
                black: str,
                start_fen: str | None,
                sequence: int,
            ) -> None:
                assert store is not None and run_id is not None
                store.start_game(run_id, sequence, white, black, start_fen)

            def persist_move(
                white: str,
                black: str,
                start_fen: str | None,
                sequence: int,
                board,
                records,
            ) -> None:
                assert store is not None and run_id is not None and records
                store.save_game_progress(
                    run_id,
                    sequence,
                    white,
                    black,
                    start_fen,
                    records,
                )
                latest = records[-1]
                if latest.forfeited:
                    status = f"{latest.color} forfeits (illegal move)"
                elif latest.uci is not None:
                    status = f"ply {latest.ply}: {latest.san}"
                else:
                    status = f"{latest.color} illegal attempt {latest.illegal_attempts}"
                print(
                    f"  game {sequence + 1}/{total_games} {status}",
                    flush=True,
                )
                if pusher is not None:
                    pusher.on_move(
                        white,
                        black,
                        start_fen,
                        sequence,
                        board,
                        records,
                    )

            result = round_robin(
                entries,
                args.games,
                condition,
                config,
                eval_engine=eval_engine,
                openings=openings,
                completed_games=completed_games,
                in_progress_games=in_progress_games,
                on_game_start=start_game,
                on_game=persist_game,
                on_move=persist_move,
                cache_session_prefix=handle.run_id,
            )
            summary = {
                "n_games": len(result.games),
                "standings": [
                    {
                        **asdict(standing),
                        "games": standing.games,
                        "score": standing.score,
                    }
                    for standing in result.standings
                ],
            }
            store.finalize_run(handle.run_id, summary)
            store.close()
            store = None
    except BaseException as exc:
        if store is not None:
            if run_id is not None:
                store.mark_partial(run_id, str(exc))
            store.close()
        raise

    print(format_tournament(result))
    if args.pgn_out:
        with open(args.pgn_out, "w", encoding="utf-8") as f:
            f.write(result.pgns())
        print(f"\nwrote {len(result.games)} game PGNs -> {args.pgn_out}")
    record = TournamentRecord(result, condition, args.max_plies)
    if args.save:
        save_tournament(record, args.save)
        print(f"saved tournament -> {args.save}")
    if pusher:
        final_doc = json_safe(record.to_dict())
        assert isinstance(final_doc, dict)
        pusher.push_final(final_doc)  # flip the live view to the final points table
        print("pushed final standings to the backend")
    return 0


def _add_condition_args(p: argparse.ArgumentParser) -> None:
    # Mode presets (override the individual axes below). Default run = MODE 2.
    p.add_argument(
        "--mode",
        type=int,
        default=None,
        choices=[1, 2, 3, 4, 5],
        help=(
            "1=raw, 2=legal moves, 3=coached, 4=Woodpecker full line, 5=deep coached"
        ),
    )
    # Individual axes default to MODE 2 (hand-holding: legal moves in UCI).
    p.add_argument(
        "--legality", default="legal_list", choices=[e.value for e in Legality]
    )
    p.add_argument(
        "--representation",
        default="fen_pieces",
        choices=[e.value for e in Representation],
    )
    p.add_argument("--notation", default="uci", choices=[e.value for e in Notation])
    p.add_argument(
        "--prompt-style",
        dest="prompt_style",
        default="minimal",
        choices=[e.value for e in PromptStyle],
    )
    p.add_argument("--retry-attempts", type=int, default=3)
    p.add_argument(
        "--otb-limit",
        dest="otb_limit",
        type=int,
        default=2,
        help="Nth cumulative illegal move that forfeits under --legality otb",
    )
    response = p.add_mutually_exclusive_group()
    response.add_argument(
        "--rationale",
        "--explain",
        dest="explain",
        action="store_true",
        default=True,
        help="request the canonical JSON move + rationale response (default)",
    )
    response.add_argument(
        "--move-only",
        dest="explain",
        action="store_false",
        help="request only a move, without JSON or rationale (paired response-style ablation)",
    )
    p.add_argument(
        "--response-protocol",
        default=ResponseProtocol.JSON_SCHEMA_V1.value,
        choices=[protocol.value for protocol in ResponseProtocol],
        help=(
            "JSON response enforcement: strict API JSON Schema (default) or the "
            "versioned prompt-only compatibility protocol"
        ),
    )
    p.add_argument(
        "--temperature",
        type=float,
        default=1.0,
        help="sampling temperature; default 1.0 (models' native default). Use 0.0 for deterministic runs.",
    )
    p.add_argument(
        "--reasoning",
        default=None,
        choices=["none", "minimal", "low", "medium", "high", "xhigh", "max"],
        help="for reasoning models: how hard to think (adds a reasoning axis to the run)",
    )
    p.add_argument(
        "--reasoning-tokens",
        dest="reasoning_tokens",
        type=int,
        default=None,
        help="exact thinking-token budget; cannot be combined with --reasoning",
    )
    p.add_argument(
        "--capture-reasoning",
        action=argparse.BooleanOptionalAction,
        default=True,
        help=(
            "request and store provider-supplied reasoning, then preserve its exact "
            "native continuity artifact inside the model's private conversation "
            "(default: enabled; use --no-capture-reasoning for the visible-history ablation)"
        ),
    )
    output_budget = p.add_mutually_exclusive_group()
    output_budget.add_argument(
        "--max-output-tokens",
        dest="max_output_tokens",
        type=int,
        default=0,
        help=(
            "opt-in maximum output tokens, tracked as part of the model variant; "
            "the default omits max_tokens and uses the provider/model limit"
        ),
    )
    output_budget.add_argument(
        "--provider-output-limit",
        dest="max_output_tokens",
        action="store_const",
        const=0,
        help=(
            "omit max_tokens and use the model/provider default; recorded as a "
            "distinct provider-limit variant"
        ),
    )
    p.add_argument(
        "--cache-policy",
        default=CachePolicy.PROMPT_PREFIX_V1.value,
        choices=[policy.value for policy in CachePolicy],
        help=(
            "provider prompt-prefix caching policy; never enables response caching "
            "or exposes tools"
        ),
    )


def main(argv: list[str] | None = None) -> int:
    from .env import load_local_env

    load_local_env()
    parser = argparse.ArgumentParser(prog="chessbench")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("puzzles", help="run the puzzle track")
    p.add_argument(
        "--agent",
        default="random",
        choices=[
            "random",
            "first_legal",
            "stockfish",
            "anthropic",
            "openai",
            "openrouter",
            "openrouter-vision",
        ],
    )
    p.add_argument("--model", default=None, help="model id for LLM agents")
    p.add_argument("--data", default=str(DEFAULT_DATA))
    p.add_argument(
        "--suite",
        default=None,
        help="run a frozen suite (same items for every model) instead of --data",
    )
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--nodes", type=int, default=200_000, help="Stockfish node limit")
    _add_condition_args(p)
    p.add_argument(
        "--log", default=None, help="write per-puzzle results to this JSONL file"
    )
    p.add_argument(
        "--save-run",
        dest="save_run",
        default=None,
        help="write a full run record JSON (for the web app) to this path",
    )
    p.add_argument(
        "--progress", type=int, default=0, help="print progress every N puzzles"
    )
    p.set_defaults(func=cmd_puzzles)

    g = sub.add_parser("play", help="run the game track (agent vs agent)")
    g.add_argument(
        "--white",
        default="stockfish",
        choices=[
            "random",
            "first_legal",
            "stockfish",
            "anthropic",
            "openai",
            "openrouter",
        ],
    )
    g.add_argument(
        "--black",
        default="random",
        choices=[
            "random",
            "first_legal",
            "stockfish",
            "anthropic",
            "openai",
            "openrouter",
        ],
    )
    g.add_argument("--white-model", default=None)
    g.add_argument("--black-model", default=None)
    g.add_argument("--games", type=int, default=1)
    g.add_argument("--max-plies", type=int, default=200)
    g.add_argument("--seed", type=int, default=0)
    g.add_argument(
        "--sf-nodes", type=int, default=100_000, help="node limit for stockfish players"
    )
    g.add_argument(
        "--sf-skill",
        type=int,
        default=3,
        help="Stockfish Skill Level 0-20 for stockfish players",
    )
    g.add_argument(
        "--context-mode",
        dest="context_mode",
        default="fresh",
        choices=[e.value for e in ContextMode],
    )
    _add_condition_args(g)
    g.set_defaults(legality="retry", context_mode="hybrid")
    g.add_argument("--pgn-out", default=None, help="write game PGNs to this file")
    g.set_defaults(func=cmd_play)

    c = sub.add_parser("composed", help="run the composed/esoteric track")
    c.add_argument(
        "--solver",
        default="oracle",
        choices=["oracle", "random", "anthropic", "openai", "openrouter"],
    )
    c.add_argument(
        "--model",
        default=None,
        help="registry label (preferred) or raw provider model ID for LLM solvers",
    )
    c.add_argument("--data", default=str(DEFAULT_COMPOSED))
    c.add_argument(
        "--suite",
        default=None,
        help="run a frozen composed suite instead of the mutable --data source",
    )
    c.add_argument("--seed", type=int, default=0)
    c.add_argument(
        "--sf-nodes",
        type=int,
        default=120_000,
        help="engine nodes for study adjudication",
    )
    c.add_argument(
        "--save-run",
        dest="save_run",
        default=None,
        help="write a composed-run JSON (per-problem model results) for the web app",
    )
    c.add_argument(
        "--db", default="runs/chessbench.db", help="durable local benchmark database"
    )
    c.add_argument(
        "--force", action="store_true", help="create an explicit replicate run"
    )
    _add_condition_args(c)
    c.set_defaults(func=cmd_composed)

    sb = sub.add_parser(
        "suite", help="build a frozen benchmark suite (identical items for every model)"
    )
    sb.add_argument(
        "--source", required=True, help="puzzle source CSV/JSON to sample from"
    )
    sb.add_argument("--name", required=True)
    sb.add_argument("--version", default="1")
    sb.add_argument("--visibility", default="public", choices=["public", "private"])
    sb.add_argument("--source-label", dest="source_label", default="lichess")
    sb.add_argument("--per-bucket", dest="per_bucket", type=int, default=20)
    sb.add_argument("--seed", type=int, default=0)
    sb.add_argument("--out", required=True)
    sb.set_defaults(func=cmd_suite_build)

    lb = sub.add_parser(
        "leaderboard", help="points for several models on the SAME suite"
    )
    lb.add_argument("--suite", required=True)
    lb.add_argument(
        "--provider",
        default="openrouter",
        choices=["openrouter", "openai", "anthropic"],
    )
    lb.add_argument("--models", required=True, help="comma-separated model ids")
    lb.add_argument(
        "--legalities",
        default=None,
        help="comma-separated legality settings to sweep (points per setting); defaults to --legality",
    )
    lb.add_argument(
        "--include-baselines",
        dest="include_baselines",
        action="store_true",
        help="also run random + stockfish for reference",
    )
    lb.add_argument("--sf-nodes", type=int, default=200_000)
    _add_condition_args(lb)
    lb.set_defaults(func=cmd_leaderboard)

    t = sub.add_parser("tournament", help="round-robin among LLMs -> match points")
    t.add_argument(
        "--models",
        default="",
        help="comma-separated model ids (empty = baselines only)",
    )
    t.add_argument(
        "--provider",
        default="openrouter",
        choices=["openrouter", "openai", "anthropic"],
    )
    t.add_argument(
        "--games", type=int, default=2, help="games per pair (colors alternate)"
    )
    t.add_argument("--max-plies", type=int, default=200)
    t.add_argument("--seed", type=int, default=0)
    t.add_argument(
        "--include-random",
        dest="include_random",
        action="store_true",
        help="add a random baseline",
    )
    t.add_argument(
        "--include-stockfish",
        dest="include_stockfish",
        action="store_true",
        help="add a Stockfish baseline to the match-points table",
    )
    t.add_argument("--sf-nodes", type=int, default=100_000)
    t.add_argument("--sf-skill", type=int, default=3)
    t.add_argument(
        "--context-mode",
        dest="context_mode",
        default="fresh",
        choices=[e.value for e in ContextMode],
    )
    t.add_argument("--pgn-out", default=None)
    t.add_argument(
        "--save",
        default=None,
        help="save a tournament record JSON (for the web games viewer)",
    )
    t.add_argument(
        "--db", default="runs/chessbench.db", help="durable local benchmark database"
    )
    t.add_argument(
        "--force", action="store_true", help="create an explicit replicate run"
    )
    t.add_argument(
        "--stream",
        action="store_true",
        help="stream games live to the backend as they play (needs CHESSBENCH_API + "
        "CHESSBENCH_INGEST_TOKEN env); durable per-game, watchable per-move",
    )
    t.add_argument(
        "--tid",
        default=None,
        help="tournament id for --stream (defaults to the --save basename)",
    )
    t.add_argument(
        "--eval-moves",
        dest="eval_moves",
        action="store_true",
        help="Stockfish-evaluate each move (per-move centipawns / accuracy)",
    )
    t.add_argument(
        "--openings",
        default="none",
        choices=["book", "none"],
        help="diversify games from an opening book vs the standard start (default). "
        "At temperature 1.0 games self-diversify, so the book is opt-in.",
    )
    _add_condition_args(t)
    t.set_defaults(legality="retry", context_mode="hybrid")
    t.set_defaults(func=cmd_tournament)

    e = sub.add_parser(
        "export", help="rebuild puzzle, esoteric, and game indexes for the web app"
    )
    e.add_argument("--runs-dir", dest="runs_dir", default="web/public/data/runs")
    e.add_argument("--out", default="web/public/data/index.json")
    e.set_defaults(func=cmd_export)

    sp = sub.add_parser("sprt", help="A-vs-B with sequential early stopping (SPRT)")
    sp.add_argument(
        "--a",
        default="openrouter",
        choices=[
            "random",
            "first_legal",
            "stockfish",
            "anthropic",
            "openai",
            "openrouter",
        ],
    )
    sp.add_argument(
        "--b",
        default="random",
        choices=[
            "random",
            "first_legal",
            "stockfish",
            "anthropic",
            "openai",
            "openrouter",
        ],
    )
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
    sp.add_argument(
        "--context-mode",
        dest="context_mode",
        default="fresh",
        choices=[e.value for e in ContextMode],
    )
    _add_condition_args(sp)
    sp.set_defaults(legality="retry", context_mode="hybrid")
    sp.set_defaults(func=cmd_sprt)

    cl = sub.add_parser(
        "category-leaderboard", help="per-category rankings from saved run records"
    )
    cl.add_argument("--runs-dir", dest="runs_dir", default="web/public/data/runs")
    cl.add_argument(
        "--dim",
        default=None,
        choices=["tier", "phase", "motif", "mate_pattern", "goal", "length"],
        help="restrict to one category dimension",
    )
    cl.add_argument("--min-n", dest="min_n", type=int, default=3)
    cl.set_defaults(func=cmd_category_leaderboard)

    m = sub.add_parser("models", help="model registry (list / add)")
    m.add_argument("models_action", nargs="?", default="list", choices=["list", "add"])
    m.add_argument("--label")
    m.add_argument(
        "--provider",
        default="openrouter",
        choices=["openrouter", "openai", "anthropic"],
    )
    m.add_argument("--model-id", dest="model_id")
    m.add_argument("--family", default="")
    m.add_argument("--notes", default="")
    m.set_defaults(func=cmd_models)

    rmp = sub.add_parser(
        "run-model",
        help="run a registry model through a suite (incremental, saves a run record)",
    )
    rmp.add_argument(
        "--model", required=True, help="registry label (see `chessbench models`)"
    )
    rmp.add_argument("--suite", required=True)
    rmp.add_argument("--out-dir", dest="out_dir", default="web/public/data/runs")
    rmp.add_argument(
        "--db",
        default="runs/chessbench.db",
        help="durable local outbox/database (completed runs auto-sync when Cloudflare credentials exist)",
    )
    rmp.add_argument(
        "--no-sync",
        action="store_true",
        help="leave a completed run queued in the local outbox instead of publishing it",
    )
    rmp.add_argument(
        "--force", action="store_true", help="recompute even if the run file exists"
    )
    rmp.add_argument("--progress", type=int, default=10)
    rmp.add_argument(
        "--request-timeout",
        type=float,
        default=120.0,
        help=(
            "absolute per-response deadline in seconds; transport failures are "
            "never retried automatically because billing may have occurred"
        ),
    )
    rmp.add_argument(
        "--max-new-items",
        type=int,
        default=None,
        help=(
            "stop cleanly after N newly evaluated items; completed items remain "
            "durable and the same run resumes later"
        ),
    )
    rmp.add_argument(
        "--max-consecutive-unsolved",
        type=int,
        default=None,
        help=(
            "stop before the next paid item after N consecutive scored puzzles "
            "without a full solve; the partial run remains resumable"
        ),
    )
    rmp.add_argument(
        "--export-only",
        action="store_true",
        help="rebuild this run's dashboard JSON from SQLite without model inference",
    )
    provider_order = rmp.add_mutually_exclusive_group()
    provider_order.add_argument(
        "--provider-only",
        action="append",
        default=[],
        metavar="SLUG",
        help="allow only this OpenRouter provider (repeatable; recorded in model identity)",
    )
    provider_order.add_argument(
        "--provider-order",
        action="append",
        default=[],
        metavar="SLUG",
        help="prefer OpenRouter providers in this order (repeatable; recorded in model identity)",
    )
    rmp.add_argument(
        "--no-provider-fallbacks",
        dest="provider_allow_fallbacks",
        action="store_false",
        default=True,
        help="fail if the selected OpenRouter providers are unavailable",
    )
    rmp.add_argument(
        "--require-provider-parameters",
        action="store_true",
        help="route only to endpoints supporting every supplied parameter",
    )
    _add_condition_args(rmp)
    rmp.set_defaults(func=cmd_run_model)

    wp = sub.add_parser(
        "woodpecker", help="run puzzles as one-shot complete variations"
    )
    wp.add_argument(
        "--agent", default="openrouter", choices=["anthropic", "openai", "openrouter"]
    )
    wp.add_argument("--model", default=None, help="model id for the LLM agent")
    wp.add_argument("--data", default=str(DEFAULT_DATA))
    wp.add_argument(
        "--suite", default=None, help="run a frozen suite instead of --data"
    )
    wp.add_argument("--limit", type=int, default=None)
    wp.add_argument("--seed", type=int, default=0)
    wp.add_argument("--nodes", type=int, default=200_000)
    _add_condition_args(wp)
    wp.add_argument("--log", default=None)
    wp.add_argument("--save-run", dest="save_run", default=None)
    wp.add_argument("--progress", type=int, default=0)
    wp.set_defaults(func=cmd_woodpecker)

    args = parser.parse_args(argv)
    if (
        getattr(args, "reasoning", None) is not None
        and getattr(args, "reasoning_tokens", None) is not None
    ):
        parser.error("--reasoning and --reasoning-tokens are mutually exclusive")
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
