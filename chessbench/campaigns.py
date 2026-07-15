"""Frozen experiment matrices for published ChessBench campaigns.

Campaigns are deliberately thin orchestration over the durable per-cell runners.
The SQLite natural key remains the source of truth: rerunning a campaign skips
completed cells and resumes partial cells without issuing duplicate paid calls.
"""

from __future__ import annotations

import re
import sys
import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Sequence

from .registry import get_model


Track = Literal["standard", "woodpecker", "esoteric"]
ResponseStyle = Literal["move_only", "json_rationale"]

PUBLIC_MODELS = ("gpt-5.6-luna", "claude-haiku-4.5")
PUBLIC_RESPONSE_STYLES: tuple[ResponseStyle, ...] = (
    "move_only",
    "json_rationale",
)
PUBLIC_SUITES: dict[Track, tuple[str, int]] = {
    "standard": ("suites/public/standard-lichess-v2.json", 325),
    "woodpecker": ("suites/public/woodpecker-masters-v1.json", 136),
    "esoteric": ("suites/public/esoteric-seed-v1.json", 50),
}
PUBLIC_GAME_MODELS = ("gpt-5.6-luna", "claude-haiku-4.5")


def openrouter_credit_remaining(api_key: str, *, timeout: float = 15.0) -> float | None:
    """Return this key's remaining USD limit, or ``None`` when unlimited.

    OpenRouter documents ``GET /api/v1/key`` as the authenticated credit-limit
    preflight. Keeping it outside the paid runner prevents an underfunded
    campaign from creating an empty durable cell before its first HTTP 402.
    """
    request = urllib.request.Request(
        "https://openrouter.ai/api/v1/key",
        headers={
            "Authorization": f"Bearer {api_key}",
            "User-Agent": "chessbench-campaign/1",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.load(response)
    except (urllib.error.URLError, OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"OpenRouter credit preflight failed: {exc}") from exc
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, dict) or "limit_remaining" not in data:
        raise RuntimeError("OpenRouter credit preflight returned no limit_remaining field")
    value = data["limit_remaining"]
    if value is None:
        return None
    if not isinstance(value, (int, float)) or value < 0:
        raise RuntimeError("OpenRouter credit preflight returned an invalid balance")
    return float(value)


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


@dataclass(frozen=True)
class CampaignCell:
    """One comparable model x suite x condition cell."""

    model_label: str
    track: Track
    suite: str
    item_count: int
    mode: int
    response_style: ResponseStyle
    reasoning: str = "low"
    max_output_tokens: int = 8192
    response_protocol: str = "prompt_json_v1"

    @property
    def key(self) -> str:
        return (
            f"{self.model_label}:{self.track}:mode-{self.mode}:"
            f"{self.response_style}:r-{self.reasoning}:o-{self.max_output_tokens}"
        )

    def command(
        self,
        *,
        db: str = "runs/chessbench.db",
        data_root: str = "web/public/data",
        python: str = sys.executable,
    ) -> list[str]:
        """Return an argv list for the existing durable runner."""
        style_flag = (
            "--move-only" if self.response_style == "move_only" else "--rationale"
        )
        common = [
            "--suite",
            self.suite,
            "--db",
            db,
            "--mode",
            str(self.mode),
            style_flag,
            "--response-protocol",
            self.response_protocol,
            "--reasoning",
            self.reasoning,
            "--max-output-tokens",
            str(self.max_output_tokens),
        ]
        if self.track != "esoteric":
            return [
                python,
                "-m",
                "chessbench",
                "run-model",
                "--model",
                self.model_label,
                "--out-dir",
                str(Path(data_root) / "runs"),
                *common,
            ]

        entry = get_model(self.model_label)
        output_name = "--".join(
            [
                _slug(self.model_label),
                f"r-{self.reasoning}",
                f"o{self.max_output_tokens}",
                self.response_protocol.replace("_", "-"),
                f"mode-{self.mode}",
                self.response_style.replace("_", "-"),
                Path(self.suite).stem,
            ]
        ) + ".json"
        return [
            python,
            "-m",
            "chessbench",
            "composed",
            "--solver",
            entry.provider,
            "--model",
            self.model_label,
            "--save-run",
            str(Path(data_root) / "composed" / output_name),
            *common,
        ]


@dataclass(frozen=True)
class GameCampaignCell:
    """One color-balanced Luna/Haiku game condition from the standard start."""

    mode: int
    response_style: ResponseStyle
    model_labels: tuple[str, str] = PUBLIC_GAME_MODELS
    games_per_pair: int = 2
    max_plies: int = 200
    reasoning: str = "low"
    max_output_tokens: int = 8192
    response_protocol: str = "prompt_json_v1"

    @property
    def key(self) -> str:
        return (
            f"games:mode-{self.mode}:{self.response_style}:"
            f"r-{self.reasoning}:o-{self.max_output_tokens}"
        )

    def output_stem(self) -> str:
        base = (
            f"luna-vs-haiku--mode-{self.mode}--r-{self.reasoning}--"
            f"o{self.max_output_tokens}--{self.response_protocol.replace('_', '-')}"
        )
        # Preserve the already-published rationale filenames/natural keys while
        # making the paired move-only artifacts unambiguous.
        return base if self.response_style == "json_rationale" else base + "--move-only"

    def command(
        self,
        *,
        db: str = "runs/chessbench.db",
        data_root: str = "web/public/data",
        python: str = sys.executable,
        publish: bool = False,
    ) -> list[str]:
        entries = [get_model(label) for label in self.model_labels]
        providers = {entry.provider for entry in entries}
        if providers != {"openrouter"}:
            raise ValueError("the public game campaign requires OpenRouter registry entries")
        stem = self.output_stem()
        command = [
            python,
            "-m",
            "chessbench",
            "tournament",
            "--models",
            ",".join(entry.model_id for entry in entries),
            "--provider",
            "openrouter",
            "--games",
            str(self.games_per_pair),
            "--max-plies",
            str(self.max_plies),
            "--mode",
            str(self.mode),
            "--move-only"
            if self.response_style == "move_only"
            else "--rationale",
            "--response-protocol",
            self.response_protocol,
            "--reasoning",
            self.reasoning,
            "--max-output-tokens",
            str(self.max_output_tokens),
            "--context-mode",
            "hybrid",
            "--notation",
            "uci",
            "--temperature",
            "1",
            "--openings",
            "none",
            "--db",
            db,
            "--save",
            str(Path(data_root) / "tournaments" / f"{stem}.json"),
        ]
        if publish:
            command.extend(["--stream", "--tid", stem])
        return command


def public_low_reasoning_campaign(
    models: Sequence[str] = PUBLIC_MODELS,
) -> list[CampaignCell]:
    """The complete public low-reasoning response-style comparison.

    Standard uses all three board-information modes. Woodpecker remains its
    full-line Mode 4 track. Esoteric uses coached Mode 3. Every track is paired
    across move-only and visible-rationale response styles.
    """
    cells: list[CampaignCell] = []
    for model in models:
        for mode in (1, 2, 3):
            for style in PUBLIC_RESPONSE_STYLES:
                suite, count = PUBLIC_SUITES["standard"]
                cells.append(
                    CampaignCell(model, "standard", suite, count, mode, style)
                )
        for style in PUBLIC_RESPONSE_STYLES:
            suite, count = PUBLIC_SUITES["woodpecker"]
            cells.append(CampaignCell(model, "woodpecker", suite, count, 4, style))
        for style in PUBLIC_RESPONSE_STYLES:
            suite, count = PUBLIC_SUITES["esoteric"]
            cells.append(CampaignCell(model, "esoteric", suite, count, 3, style))
    return cells


def public_low_reasoning_game_campaign() -> list[GameCampaignCell]:
    """Three information modes crossed with the move-only response ablation."""
    return [
        GameCampaignCell(mode, style)
        for mode in (1, 2, 3)
        for style in PUBLIC_RESPONSE_STYLES
    ]
