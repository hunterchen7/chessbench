"""Popeye input/output adapter tests; the external binary is optional."""

from __future__ import annotations

import os

import pytest

from chessbench.solvers.popeye import (
    build_input,
    certify,
    extract_keys,
    extract_solution_lines,
    find_popeye,
)

FEN = "8/1Q6/8/4R3/3p4/8/1q6/5k1K w - - 0 1"
OUTPUT = """Popeye Darwin-arm-64Bit v4.101 (1024 MB)
  s#1                         3 + 3

   1.Qb7-g2 + !
      1...Qb2*g2 #

solution finished. Time = 0.003 s
"""
HELPMATE = """
  1.Kd2-e2 Qc1-e3 +   2.Ke2-f1 Qe3-f2 #
  1.Kd2-e2 Qc1-c5   2.Ke2-f1 Qc5-f2 #
solution finished. Time = 0.004 s
"""


def test_build_input_translates_fen_knights_and_stipulation():
    text = build_input("8/8/8/8/8/8/4N3/K6k w - - 0 1", "selfmate", 2)
    assert "Stipulation s#2" in text
    assert "4S3" in text
    assert "EndProblem" in text


def test_build_input_supports_series_selfmate():
    text = build_input("8/8/8/8/8/8/4N3/K6k w - - 0 1", "series_selfmate", 3)
    assert "Stipulation ser-s#3" in text


def test_extract_keys_reads_popeye_long_algebraic():
    assert extract_keys(OUTPUT, FEN) == ["b7g2"]


def test_extract_exact_helpmate_lines():
    fen = "8/3K4/8/8/8/8/3k4/2Q4N b - - 0 1"
    assert extract_solution_lines(HELPMATE, fen, "helpmate", 2) == [
        ["d2e2", "c1c5", "e2f1", "c5f2"],
        ["d2e2", "c1e3", "e2f1", "e3f2"],
    ]


def test_external_popeye_certificate_when_configured():
    path = find_popeye()
    if path is None:
        pytest.skip("POPEYE_BIN is not configured")
    certificate = certify(FEN, "selfmate", 1, executable=path)
    assert certificate.solved
    assert certificate.unique_key
    assert certificate.keys == ["b7g2"]
    assert certificate.solution_count == 0
    assert len(certificate.output_sha256) == 64


def test_find_popeye_rejects_non_executable(tmp_path):
    path = tmp_path / "popeye"
    path.write_text("not executable", encoding="utf-8")
    os.chmod(path, 0o600)
    assert find_popeye(path) is None
