"""Model registry: a committed list of models so "add a model and run it through
the suite" is a single command instead of ad-hoc CLI strings.

registry/models.json is the human-editable source of truth. `chessbench models
add` upserts an entry; `chessbench run-model` builds the model from its entry,
runs a suite, and saves a run record -- skipping model×suite×condition cells that
already exist (incremental), so re-running only computes what's missing.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path

DEFAULT_REGISTRY = Path(__file__).resolve().parent.parent / "registry" / "models.json"

_PROVIDERS = ("openrouter", "openai", "anthropic")


@dataclass
class ModelEntry:
    label: str            # unique key + display name, e.g. "gpt-4o-mini"
    provider: str         # openrouter | openai | anthropic
    model_id: str         # provider wire name, e.g. "openai/gpt-4o-mini"
    family: str = ""      # e.g. "openai", "meta", "google"
    notes: str = ""
    enabled: bool = True

    def __post_init__(self) -> None:
        if self.provider not in _PROVIDERS:
            raise ValueError(f"provider must be one of {_PROVIDERS}, got {self.provider!r}")


def load_registry(path: str | Path = DEFAULT_REGISTRY) -> list[ModelEntry]:
    p = Path(path)
    if not p.exists():
        return []
    with open(p, encoding="utf-8") as f:
        data = json.load(f)
    return [ModelEntry(**m) for m in data.get("models", [])]


def save_registry(entries: list[ModelEntry], path: str | Path = DEFAULT_REGISTRY) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump({"models": [asdict(e) for e in entries]}, f, indent=1)


def add_model(entry: ModelEntry, path: str | Path = DEFAULT_REGISTRY) -> list[ModelEntry]:
    """Upsert by label (idempotent)."""
    entries = [e for e in load_registry(path) if e.label != entry.label]
    entries.append(entry)
    entries.sort(key=lambda e: e.label)
    save_registry(entries, path)
    return entries


def get_model(label: str, path: str | Path = DEFAULT_REGISTRY) -> ModelEntry:
    for e in load_registry(path):
        if e.label == label:
            return e
    raise KeyError(f"model {label!r} not in registry ({path})")
