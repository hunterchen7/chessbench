"""Render a board to a PNG for the multimodal (vision) track.

Uses Pillow only (no SVG toolchain). Pieces are drawn as color-coded discs with
their letter (white pieces: white disc + black letter; black: dark disc + white
letter) on a coordinate-labelled board -- a clear, legible diagram a vision model
can read. (Photorealistic piece sprites would be a stronger test; this is v1.)
"""

from __future__ import annotations

from io import BytesIO

import chess
from PIL import Image, ImageDraw, ImageFont

_FONT_PATHS = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in _FONT_PATHS:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def render_board_png(board: chess.Board, *, square: int = 56, margin: int = 24) -> bytes:
    size = square * 8 + margin * 2
    img = Image.new("RGB", (size, size), (24, 27, 34))
    draw = ImageDraw.Draw(img)
    light, dark = (198, 205, 216), (108, 118, 134)
    piece_font, coord_font = _font(int(square * 0.5)), _font(int(margin * 0.55))

    for rank in range(8):
        for file in range(8):
            x0 = margin + file * square
            y0 = margin + (7 - rank) * square
            draw.rectangle([x0, y0, x0 + square, y0 + square],
                           fill=light if (rank + file) % 2 else dark)
            piece = board.piece_at(chess.square(file, rank))
            if piece is None:
                continue
            cx, cy, r = x0 + square / 2, y0 + square / 2, square * 0.38
            white = piece.color == chess.WHITE
            draw.ellipse([cx - r, cy - r, cx + r, cy + r],
                         fill=(245, 245, 245) if white else (35, 35, 40),
                         outline=(20, 20, 20) if white else (230, 230, 230), width=2)
            draw.text((cx, cy), piece.symbol().upper(), anchor="mm",
                      fill=(20, 20, 20) if white else (240, 240, 240), font=piece_font)

    for file in range(8):
        draw.text((margin + file * square + square / 2, size - margin / 2), "abcdefgh"[file],
                  anchor="mm", fill=(150, 155, 165), font=coord_font)
    for rank in range(8):
        draw.text((margin / 2, margin + (7 - rank) * square + square / 2), str(rank + 1),
                  anchor="mm", fill=(150, 155, 165), font=coord_font)

    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
