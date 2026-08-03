"""Focused checks for the compact adaptive campaign reporter."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "report_adaptive_campaign.py"
SPEC = importlib.util.spec_from_file_location("report_adaptive_campaign", SCRIPT)
assert SPEC and SPEC.loader
reporter = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = reporter
SPEC.loader.exec_module(reporter)


def health(**overrides):
    values = {
        "advanced": False,
        "child_alive": True,
        "supervisor_alive": True,
        "connected": False,
        "worker_age": 300,
        "evidence_age": 300,
        "request_timeout": 900,
        "interval": 600,
        "flat_reports": 0,
        "repeated_exit_since_activity": False,
    }
    values.update(overrides)
    return reporter.classify_health(**values)


def test_health_prioritizes_durable_advancement():
    assert health(advanced=True, child_alive=False) == "advancing"


def test_health_does_not_equate_a_pid_with_a_healthy_run():
    assert health(supervisor_alive=False) == "hard stall/recovery needed: supervisor dead"
    assert health(child_alive=False) == "hard stall/recovery needed: child missing"
    assert (
        health(repeated_exit_since_activity=True)
        == "hard stall/recovery active: repeated exits"
    )
    assert (
        health(flat_reports=2, evidence_age=700)
        == "hard stall/recovery needed: two flat reports"
    )


def test_live_socket_uses_latest_durable_activity_as_request_age_bound():
    assert (
        health(connected=True, worker_age=3600, evidence_age=700)
        == "in-flight but active"
    )


def test_soft_and_timeout_stalls_are_distinct():
    assert health(evidence_age=700) == "soft stall"
    assert (
        health(evidence_age=1100)
        == "hard stall/recovery needed: timeout exceeded"
    )


def test_duration_is_exact_and_compact():
    assert reporter.format_duration(24140) == "6h 42m 20s"
    assert reporter.format_duration(632) == "10m 32s"
