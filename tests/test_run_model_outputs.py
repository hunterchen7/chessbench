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


def test_run_model_defaults_to_the_cloudflare_dashboard_data_directory(monkeypatch):
    seen: dict[str, object] = {}

    def fake_run_model(args):
        seen["out_dir"] = args.out_dir
        return 0

    monkeypatch.setattr(cli, "cmd_run_model", fake_run_model)
    assert cli.main(["run-model", "--model", "model", "--suite", "suite.json"]) == 0
    assert seen["out_dir"] == "web/public/data/runs"
