from __future__ import annotations

from scripts.build_public_corpus_bundle import (
    PUBLIC_SUITES,
    RELEASES,
    _read,
    _suite_catalog,
)


def test_dashboard_suite_catalog_describes_every_public_release() -> None:
    catalog = _suite_catalog()
    suites = catalog["suites"]
    assert catalog["schema"] == "chessbench.suite_catalog.v2"
    assert len(suites) == len(list(PUBLIC_SUITES.glob("*.json")))
    assert len({suite["name"] for suite in suites}) == len(suites)
    assert all(suite["description"].strip() for suite in suites)
    assert {suite["name"] for suite in suites if suite.get("current")} == {
        _read(path)["name"] for path in RELEASES.values()
    }

    standard = [
        suite for suite in suites if suite["name"].startswith("standard-lichess-")
    ]
    assert [
        (suite["name"], suite["items"], suite.get("current", False))
        for suite in standard
    ] == [
        ("standard-lichess-v2", 325, False),
        ("standard-lichess-v3", 250, True),
    ]
