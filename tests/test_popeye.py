"""Popeye input/output adapter tests; the external binary is optional."""

from __future__ import annotations

import os

import pytest

from chessbench.solvers.popeye import build_input, certify, extract_keys, find_popeye

FEN = "8/1Q6/8/4R3/3p4/8/1q6/5k1K w - - 0 1"
OUTPUT = """Popeye Darwin-arm-64Bit v4.101 (1024 MB)
  s#1                         3 + 3

   1.Qb7-g2 + !
      1...Qb2*g2 #

solution finished. Time = 0.003 s
"""


def test_build_input_translates_fen_knights_and_stipulation():
    text = build_input("8/8/8/8/8/8/4N3/K6k w - - 0 1", "selfmate", 2)
    assert "Stipulation s#2" in text
    assert "4S3" in text
    assert "EndProblem" in text


def test_extract_keys_reads_popeye_long_algebraic():
    assert extract_keys(OUTPUT, FEN) == ["b7g2"]


def test_external_popeye_certificate_when_configured():
    path = find_popeye()
    if path is None:
        pytest.skip("POPEYE_BIN is not configured")
    certificate = certify(FEN, "selfmate", 1, executable=path)
    assert certificate.solved
    assert certificate.unique_key
    assert certificate.keys == ["b7g2"]
    assert len(certificate.output_sha256) == 64


def test_find_popeye_rejects_non_executable(tmp_path):
    path = tmp_path / "popeye"
    path.write_text("not executable", encoding="utf-8")
    os.chmod(path, 0o600)
    assert find_popeye(path) is None
