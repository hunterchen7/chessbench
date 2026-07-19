"""Suite-aware static export naming for durable registry runs."""

from __future__ import annotations

import json
from pathlib import Path

import chessbench.__main__ as cli


def output_path(
    directory: Path,
    *,
    suite_name: str = "standard-lichess-v2",
    suite_hash: str = "sha256:5fe06f759d825898",
    run_id: str = "durable-run",
) -> Path:
    return cli._run_model_output_path(
        directory,
        variant_key="gpt-5-6-luna--r-low--o8192t",
        condition_slug="legal_list__fen_pieces__uci__minimal__plain-text-v1",
        suite_name=suite_name,
        suite_hash=suite_hash,
        run_id=run_id,
    )


def test_new_output_filename_contains_suite_name_and_hash(tmp_path):
    path = output_path(tmp_path)

    assert path.parent == tmp_path
    assert path.name == (
        "gpt-5-6-luna--r-low--o8192t"
        "__suite-standard-lichess-v2--5fe06f759d825898"
        "__legal_list__fen_pieces__uci__minimal__plain-text-v1.json"
    )
    assert path != output_path(
        tmp_path,
        suite_name="standard-smoke-v1",
        suite_hash="sha256:6a13da8035f65a2c",
    )


def test_matching_legacy_partial_is_reused_in_place(tmp_path):
    legacy = tmp_path / (
        "gpt-5-6-luna--r-low--o8192t"
        "__legal_list__fen_pieces__uci__minimal__plain-text-v1.json"
    )
    legacy.write_text(
        json.dumps({"schema": "chessbench.run.v1", "run_id": "durable-run"}),
        encoding="utf-8",
    )

    assert output_path(tmp_path) == legacy


def test_unrelated_or_malformed_legacy_output_is_never_overwritten(tmp_path):
    legacy = tmp_path / (
        "gpt-5-6-luna--r-low--o8192t"
        "__legal_list__fen_pieces__uci__minimal__plain-text-v1.json"
    )
    legacy.write_text(json.dumps({"run_id": "another-run"}), encoding="utf-8")
    assert output_path(tmp_path) != legacy

    legacy.write_text("{", encoding="utf-8")
    assert output_path(tmp_path) != legacy


def test_long_auditable_identity_uses_a_deterministic_bounded_filename(tmp_path):
    kwargs = {
        "variant_key": "gemini-3-5-flash--r-default-captured--o-provider--route-only-google-ai-studio-no-fallbacks-required-params",
        "condition_slug": "free_form__fen_pieces__uci__minimal__prompt-uci-candidates-v1__cache-prompt-prefix-v1__plain-text-v1__pctx-hybrid__reasoning-captured",
        "suite_name": "standard-lichess-v3",
        "suite_hash": "sha256:196077b0a7370043",
        "run_id": "durable-run",
    }

    first = cli._run_model_output_path(tmp_path, **kwargs)
    second = cli._run_model_output_path(tmp_path, **kwargs)

    assert first == second
    assert len(first.name.encode("utf-8")) <= 240
    assert "suite-standard-lichess-v3--196077b0a7370043" in first.name
    assert "__cfg-" in first.name


def test_run_model_defaults_to_the_local_export_directory(monkeypatch):
    seen: dict[str, object] = {}

    def fake_run_model(args):
        seen["out_dir"] = args.out_dir
        seen["max_output_tokens"] = args.max_output_tokens
        return 0

    monkeypatch.setattr(cli, "cmd_run_model", fake_run_model)
    assert cli.main(["run-model", "--model", "model", "--suite", "suite.json"]) == 0
    assert seen["out_dir"] == "runs/exports"
    assert seen["max_output_tokens"] == 0


def test_rate_model_defaults_to_the_local_export_directory(monkeypatch):
    seen: dict[str, object] = {}

    def fake_rate_model(args):
        seen["out_dir"] = args.out_dir
        seen["target_rd"] = args.target_rd
        return 0

    monkeypatch.setattr(cli, "cmd_rate_model", fake_rate_model)
    assert cli.main(["rate-model", "--model", "model"]) == 0
    assert seen["out_dir"] == "runs/exports"
    assert seen["target_rd"] == 77.0


def test_run_model_accepts_export_only_without_changing_condition(monkeypatch):
    seen: dict[str, object] = {}

    def fake_run_model(args):
        seen["export_only"] = args.export_only
        seen["capture_reasoning"] = args.capture_reasoning
        return 0

    monkeypatch.setattr(cli, "cmd_run_model", fake_run_model)
    assert (
        cli.main(
            [
                "run-model",
                "--model",
                "minimax-m3",
                "--suite",
                "suite.json",
                "--reasoning",
                "low",
                "--capture-reasoning",
                "--export-only",
            ]
        )
        == 0
    )
    assert seen == {"export_only": True, "capture_reasoning": True}


def test_run_model_accepts_a_slow_model_response_deadline(monkeypatch):
    seen: dict[str, object] = {}

    def fake_run_model(args):
        seen["request_timeout"] = args.request_timeout
        return 0

    monkeypatch.setattr(cli, "cmd_run_model", fake_run_model)
    assert (
        cli.main(
            [
                "run-model",
                "--model",
                "model",
                "--suite",
                "suite.json",
                "--request-timeout",
                "600",
            ]
        )
        == 0
    )
    assert seen["request_timeout"] == 600.0


def test_model_factory_threads_response_deadline_to_openrouter():
    model = cli._build_model(
        "openrouter",
        "test/model",
        request_timeout=600.0,
    )

    assert model._timeout == 600.0


def test_model_factory_threads_openrouter_provider_preferences():
    model = cli._build_model(
        "openrouter",
        "z-ai/glm-5.2",
        provider_preferences={
            "only": ["z-ai"],
            "allow_fallbacks": False,
            "require_parameters": True,
        },
    )

    assert model._provider_preferences == {
        "only": ["z-ai"],
        "allow_fallbacks": False,
        "require_parameters": True,
    }


def test_model_factory_threads_reasoning_capture_to_openrouter():
    model = cli._build_model(
        "openrouter",
        "minimax/minimax-m3",
        reasoning_effort="low",
        reasoning_exclude=False,
    )

    assert model._reasoning_exclude is False


def test_run_model_accepts_reasoning_capture(monkeypatch):
    seen: dict[str, object] = {}

    def fake_run_model(args):
        seen["capture_reasoning"] = args.capture_reasoning
        return 0

    monkeypatch.setattr(cli, "cmd_run_model", fake_run_model)
    assert (
        cli.main(
            [
                "run-model",
                "--model",
                "minimax-m3",
                "--suite",
                "suite.json",
                "--capture-reasoning",
            ]
        )
        == 0
    )
    assert seen["capture_reasoning"] is True


def test_run_model_defaults_to_native_reasoning_continuity_and_allows_ablation(
    monkeypatch,
):
    seen: list[bool] = []

    def fake_run_model(args):
        seen.append(args.capture_reasoning)
        return 0

    monkeypatch.setattr(cli, "cmd_run_model", fake_run_model)
    base = ["run-model", "--model", "model", "--suite", "suite.json"]

    assert cli.main(base) == 0
    assert cli.main([*base, "--no-capture-reasoning"]) == 0
    assert seen == [True, False]


def test_run_model_accepts_recorded_provider_route(monkeypatch):
    seen: dict[str, object] = {}

    def fake_run_model(args):
        seen["only"] = args.provider_only
        seen["fallbacks"] = args.provider_allow_fallbacks
        seen["require"] = args.require_provider_parameters
        return 0

    monkeypatch.setattr(cli, "cmd_run_model", fake_run_model)
    assert (
        cli.main(
            [
                "run-model",
                "--model",
                "glm-5.2",
                "--suite",
                "suite.json",
                "--provider-only",
                "z-ai",
                "--no-provider-fallbacks",
                "--require-provider-parameters",
            ]
        )
        == 0
    )
    assert seen == {"only": ["z-ai"], "fallbacks": False, "require": True}


def test_run_model_accepts_provider_native_output_limit(monkeypatch):
    seen: dict[str, object] = {}

    def fake_run_model(args):
        seen["max_output_tokens"] = args.max_output_tokens
        return 0

    monkeypatch.setattr(cli, "cmd_run_model", fake_run_model)
    assert (
        cli.main(
            [
                "run-model",
                "--model",
                "model",
                "--suite",
                "suite.json",
                "--provider-output-limit",
                "--reasoning",
                "low",
            ]
        )
        == 0
    )
    assert seen["max_output_tokens"] == 0
