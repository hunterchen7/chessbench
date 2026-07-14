"""Model registry: upsert, load, get, and validation."""

import pytest

from chessbench.registry import ModelEntry, add_model, get_model, load_registry, save_registry


def test_roundtrip_and_upsert(tmp_path):
    path = tmp_path / "models.json"
    save_registry([ModelEntry("a", "openrouter", "x/a")], path)
    add_model(ModelEntry("b", "openai", "b"), path)
    add_model(ModelEntry("a", "openrouter", "x/a2", notes="updated"), path)  # upsert, not duplicate

    entries = load_registry(path)
    assert [e.label for e in entries] == ["a", "b"]           # sorted, deduped
    assert get_model("a", path).model_id == "x/a2"            # upsert kept the new value


def test_bad_provider_rejected():
    with pytest.raises(ValueError, match="provider must be"):
        ModelEntry("x", "not-a-provider", "y")


def test_missing_model_raises(tmp_path):
    save_registry([], tmp_path / "m.json")
    with pytest.raises(KeyError):
        get_model("nope", tmp_path / "m.json")


def test_shipped_registry_loads():
    entries = load_registry()  # the committed registry/models.json
    labels = {e.label for e in entries}
    assert len(labels) == len(entries)  # labels are unique
    assert any(e.provider == "openrouter" and e.model_id for e in entries)  # real, runnable models
