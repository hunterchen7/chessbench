"""LLM model providers.

    from chessbench.models import OpenRouterModel, Model

All providers implement the `Model` protocol (see `base`). `ScriptedModel` is a
network-free test double. Provider SDKs are imported lazily inside each module,
so importing this package is cheap and dependency-free.
"""

from __future__ import annotations

from .anthropic import AnthropicModel
from .base import Model, ScriptedModel, VisionModel, split_system
from .openai_compat import ModelError, OpenAIModel, OpenRouterModel, Usage

__all__ = [
    "Model",
    "VisionModel",
    "ScriptedModel",
    "split_system",
    "AnthropicModel",
    "OpenAIModel",
    "OpenRouterModel",
    "ModelError",
    "Usage",
]
