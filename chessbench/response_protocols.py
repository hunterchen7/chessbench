"""Versioned, provider-facing response contracts for chess model calls.

The schema name and protocol enum are deliberately versioned. Changing either
the JSON shape or its semantic constraints requires a new version so historical
prompt-only and schema-constrained benchmark cells can never be conflated.
"""

from __future__ import annotations

from copy import deepcopy
from enum import Enum
from typing import Literal, TypeAlias


class ResponseProtocol(str, Enum):
    """How the canonical JSON response contract is enforced."""

    JSON_SCHEMA_V1 = "json_schema_v1"
    JSON_OBJECT_V1 = "json_object_v1"
    PROMPT_JSON_V1 = "prompt_json_v1"


ResponseShape = Literal["move", "line"]
ResponseFormat: TypeAlias = dict[str, object]

UCI_PATTERN = "^[a-h][1-8][a-h][1-8][qrbn]?$"

_MOVE_RESPONSE_FORMAT: ResponseFormat = {
    "type": "json_schema",
    "json_schema": {
        "name": "chess_move_response_v1",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "move": {
                    "type": "string",
                    "pattern": UCI_PATTERN,
                    "description": (
                        "Exactly one legal move in lowercase UCI coordinate notation, "
                        "for example e2e4, g1f3, or e7e8q. Never SAN."
                    ),
                },
                "rationale": {
                    "type": "string",
                    "minLength": 1,
                    "description": "A concise explanation of why the selected move works.",
                },
            },
            "required": ["move", "rationale"],
            "additionalProperties": False,
        },
    },
}

_LINE_RESPONSE_FORMAT: ResponseFormat = {
    "type": "json_schema",
    "json_schema": {
        "name": "chess_line_response_v1",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "moves": {
                    "type": "array",
                    "minItems": 1,
                    "items": {
                        "type": "string",
                        "pattern": UCI_PATTERN,
                        "description": (
                            "One legal move in lowercase UCI coordinate notation, "
                            "for example e2e4, g1f3, or e7e8q. Never SAN."
                        ),
                    },
                    "description": "The complete move sequence in legal play order.",
                },
                "rationale": {
                    "type": "string",
                    "minLength": 1,
                    "description": "A concise explanation of why the sequence works.",
                },
            },
            "required": ["moves", "rationale"],
            "additionalProperties": False,
        },
    },
}


def response_format(shape: ResponseShape) -> ResponseFormat:
    """Return an isolated copy safe for attaching to a provider request/log."""
    source = _MOVE_RESPONSE_FORMAT if shape == "move" else _LINE_RESPONSE_FORMAT
    return deepcopy(source)


def response_format_for(
    protocol: ResponseProtocol,
    shape: ResponseShape,
    *,
    explain: bool,
) -> ResponseFormat | None:
    """Resolve the API constraint; prompt-only and move-only ablations return none."""
    if not explain or protocol == ResponseProtocol.PROMPT_JSON_V1:
        return None
    if protocol == ResponseProtocol.JSON_OBJECT_V1:
        return {"type": "json_object"}
    return response_format(shape)
