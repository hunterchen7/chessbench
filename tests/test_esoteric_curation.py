from __future__ import annotations

import copy
import json
import pathlib

from chessbench.esoteric_curation import (
    distribution_report,
    duplicate_and_anticipation_report,
    enumerate_complete_selfmate_tree,
    load_curation_records,
    select_curation_records,
    validate_curation_record,
    verify_terminal_lines,
)

ROOT = pathlib.Path(__file__).resolve().parent.parent
SEED = ROOT / "data" / "curated" / "esoteric" / "seed-selfmate-kopaev-1996.json"


def test_owner_seed_is_structurally_complete_and_exhaustively_replayed():
    record = load_curation_records(SEED)[0]
    assert validate_curation_record(record) == []
    tree = record["complete_solution_tree"]
    assert isinstance(tree, dict)
    lines = tree["terminal_lines"]
    assert isinstance(lines, list)
    solution = record["solution"]
    assert isinstance(solution, list)
    assert lines == enumerate_complete_selfmate_tree(
        str(record["fen"]), 2, str(solution[0])
    )
    assert len(lines) == 43
    assert verify_terminal_lines(str(record["fen"]), lines)
    assert validate_curation_record(record, public_gate=True) == []


def test_selection_never_auto_approves_pending_records():
    record = copy.deepcopy(load_curation_records(SEED)[0])
    record["review_status"] = "pending"
    record["visibility"] = "candidate"
    partitions = select_curation_records(
        [record], public_per_genre=1, reserve_per_genre=0
    )
    assert partitions["accepted_public"] == []
    assert [item["id"] for item in partitions["pending"]] == ["yacpdb-438993"]
    report = distribution_report(partitions, public_target=1, reserve_target=0)
    assert report["targets_met"] is False
    assert report["exact_counts"] == {
        "accepted_public": 0,
        "reserved_private": 0,
        "rejected": 0,
        "pending": 1,
        "invalid": 0,
        "candidate_pool": 1,
    }


def test_rights_cleared_human_approval_can_pass_public_gate():
    record = copy.deepcopy(load_curation_records(SEED)[0])
    record.update(
        {
            "review_status": "approved",
            "rights_status": "permission-granted",
            "rights_basis": "Composer or rights-holder permission receipt test fixture.",
        }
    )
    assert validate_curation_record(record, public_gate=True) == []
    partitions = select_curation_records(
        [record], public_per_genre=1, reserve_per_genre=0
    )
    assert [item["id"] for item in partitions["accepted_public"]] == ["yacpdb-438993"]


def test_approval_without_a_rights_basis_stays_out_of_public_release():
    record = copy.deepcopy(load_curation_records(SEED)[0])
    record["rights_status"] = "pending-review"
    record["rights_basis"] = ""
    errors = validate_curation_record(record, public_gate=True)
    assert any("redistribution rights" in error for error in errors)
    assert any("rights basis" in error for error in errors)


def test_approved_but_incomplete_record_cannot_enter_private_reserve():
    record = copy.deepcopy(load_curation_records(SEED)[0])
    record["review_status"] = "approved"
    tree = record["complete_solution_tree"]
    assert isinstance(tree, dict)
    tree["completeness"] = "published-variations"
    partitions = select_curation_records(
        [record], public_per_genre=1, reserve_per_genre=1
    )
    assert partitions["accepted_public"] == []
    assert partitions["reserved_private"] == []
    assert [item["id"] for item in partitions["pending"]] == ["yacpdb-438993"]


def test_duplicate_report_distinguishes_exact_duplicates_from_review_leads():
    record = load_curation_records(SEED)[0]
    duplicate = copy.deepcopy(record)
    duplicate["id"] = "same-position-version"
    report = duplicate_and_anticipation_report([record, duplicate])
    assert report["exact_duplicate_groups"] == [
        ["same-position-version", "yacpdb-438993"]
    ]
    assert report["file_mirror_groups"] == []


def test_seed_json_has_no_placeholder_certificate_hash():
    payload = json.loads(SEED.read_text(encoding="utf-8"))
    verification = payload["records"][0]["independent_verification"]
    assert verification["terminal_lines_sha256"] != "pending-rebuild"
