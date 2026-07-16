from __future__ import annotations

import json
import pathlib
from dataclasses import asdict

from chessbench.corpus import load_corpus
from chessbench.suite import load_suite
from scripts.build_esoteric_release import build

ROOT = pathlib.Path(__file__).resolve().parent.parent


def test_esoteric_v2_builder_reproduces_committed_catalogue_and_suite(tmp_path):
    corpus_path = tmp_path / "corpora" / "public" / "esoteric-seed-v2.json"
    suite_path = tmp_path / "suites" / "public" / "esoteric-seed-v2.json"
    corpus, suite = build(corpus_out=corpus_path, suite_out=suite_path)

    committed_corpus = json.loads(
        (ROOT / "corpora/public/esoteric-seed-v2.json").read_text(encoding="utf-8")
    )
    committed_suite = json.loads(
        (ROOT / "suites/public/esoteric-seed-v2.json").read_text(encoding="utf-8")
    )
    assert asdict(corpus) == committed_corpus
    assert asdict(suite) == committed_suite
    assert load_corpus(corpus_path).content_hash == "sha256:276ff7d1975ec273dbc6"
    assert load_suite(suite_path).content_hash == "sha256:b6e7e9fdb5c1ba36"


def test_esoteric_v2_catalogue_exactly_matches_runnable_suite():
    corpus = load_corpus(ROOT / "corpora/public/esoteric-seed-v2.json")
    suite = load_suite(ROOT / "suites/public/esoteric-seed-v2.json")
    assert suite.source == f"corpus:{corpus.name}@{corpus.content_hash}"
    assert suite.items == corpus.items
    assert [item["id"] for item in corpus.items].count("yacpdb-438993") == 1
