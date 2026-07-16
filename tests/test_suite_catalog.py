from __future__ import annotations

from scripts.build_public_corpus_bundle import _suite_catalog


def test_dashboard_suite_catalog_describes_every_public_release() -> None:
    catalog = _suite_catalog()
    suites = catalog["suites"]
    assert catalog["schema"] == "chessbench.suite_catalog.v1"
    assert len(suites) >= 18
    assert len({suite["name"] for suite in suites}) == len(suites)
    assert all(suite["description"].strip() for suite in suites)
