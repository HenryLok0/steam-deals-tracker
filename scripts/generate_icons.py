#!/usr/bin/env python3
"""Generate square favicon and PWA icon PNGs."""

from __future__ import annotations

import io
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
ICONS = DOCS / "icons"
MASTER_SIZE = 512
TOP = (27, 118, 201)
BOTTOM = (102, 192, 244)

OUTPUTS = {
    ICONS / "favicon-32.png": 32,
    ICONS / "favicon-48.png": 48,
    ICONS / "apple-touch-icon.png": 180,
    ICONS / "icon-192.png": 192,
    ICONS / "icon-512.png": 512,
}


def lerp_color(start: tuple[int, int, int], end: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(int(start[i] + (end[i] - start[i]) * t) for i in range(3))  # type: ignore[return-value]


def draw_master() -> Image.Image:
    size = MASTER_SIZE
    radius = int(size * 96 / 512)
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)

    gradient = Image.new("RGBA", (size, size))
    pixels = gradient.load()
    for y in range(size):
        color = lerp_color(TOP, BOTTOM, y / max(size - 1, 1))
        row = (*color, 255)
        for x in range(size):
            pixels[x, y] = row
    image = Image.composite(gradient, image, mask)

    tag = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(tag)
    scale = size / 512

    def pt(x: float, y: float) -> tuple[float, float]:
        cx, cy = 256 * scale, 268 * scale
        rad = math.radians(-14)
        dx, dy = (x - 256) * scale, (y - 268) * scale
        rx = dx * math.cos(rad) - dy * math.sin(rad)
        ry = dx * math.sin(rad) + dy * math.cos(rad)
        return cx + rx, cy + ry

    body = [
        pt(164, 160),
        pt(340, 160),
        pt(358, 196),
        pt(340, 352),
        pt(164, 352),
    ]
    draw.polygon(body, fill=(255, 255, 255, 255))

    hole_center = pt(318, 196)
    hole_r = 16 * scale
    draw.ellipse(
        (
            hole_center[0] - hole_r,
            hole_center[1] - hole_r,
            hole_center[0] + hole_r,
            hole_center[1] + hole_r,
        ),
        fill=TOP,
    )

    font_size = max(12, int(92 * scale))
    try:
        font = ImageFont.truetype("segoeui.ttf", font_size)
    except OSError:
        try:
            font = ImageFont.truetype("arial.ttf", font_size)
        except OSError:
            font = ImageFont.load_default()

    percent_center = pt(256, 286)
    draw.text(
        percent_center,
        "%",
        fill=TOP,
        font=font,
        anchor="mm",
    )

    return Image.alpha_composite(image, tag)


def save_png(path: Path, size: int, master: Image.Image) -> None:
    resized = master.resize((size, size), Image.Resampling.LANCZOS)
    resized.save(path, format="PNG", optimize=True)


def save_ico(path: Path, master: Image.Image, sizes: list[int]) -> None:
    frames = [master.resize((size, size), Image.Resampling.LANCZOS) for size in sizes]
    frames[0].save(
        path,
        format="ICO",
        sizes=[(frame.size[0], frame.size[1]) for frame in frames],
        append_images=frames[1:],
    )


def main() -> int:
    master = draw_master()
    for path, size in OUTPUTS.items():
        save_png(path, size, master)
        print(f"[info] Wrote {path.relative_to(ROOT)} ({size}x{size})")

    save_ico(DOCS / "favicon.ico", master, [16, 32, 48])
    print(f"[info] Wrote {DOCS.relative_to(ROOT) / 'favicon.ico'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
