"""Board image rendering + the VisionAgent (with a scripted vision model)."""

from dataclasses import replace

import chess

from chessbench.agents import MoveContext, VisionAgent
from chessbench.conditions import HEADLINE
from chessbench.imaging import render_board_png
from chessbench.response_protocols import ResponseProtocol


def test_render_board_png_is_valid():
    png = render_board_png(chess.Board())
    assert png[:8] == b"\x89PNG\r\n\x1a\n"  # PNG magic
    assert len(png) > 1000


class _ScriptedVision:
    name = "scripted-vision"

    def __init__(self, reply: str):
        self._reply = reply
        self.last_png: bytes | None = None

    def chat_image(
        self, text: str, png: bytes, *, temperature: float = 0.0, max_tokens: int = 2048
    ) -> str:
        self.last_png = png
        return self._reply


def test_vision_agent_sends_image_and_extracts_move():
    model = _ScriptedVision("e4  why: grabs the center")
    agent = VisionAgent(model)
    ctx = MoveContext(
        condition=replace(HEADLINE, response_protocol=ResponseProtocol.PROMPT_JSON_V1)
    )
    move = agent.choose(chess.Board(), ctx)
    assert move in ("e4", "e2e4")
    assert (
        model.last_png and model.last_png[:8] == b"\x89PNG\r\n\x1a\n"
    )  # a board image was sent
    assert ctx.last_explanation and "center" in ctx.last_explanation
