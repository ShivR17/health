#!/usr/bin/env python3
"""Generate the app icons. Teal ground, white trend line, matching the app's
own chart mark. Run from the repo root: python3 tools/make-icons.py"""
import os

from PIL import Image, ImageDraw

TEAL = (20, 96, 90)
INK = (19, 37, 35)
WHITE = (255, 255, 255)
OUT = "icons"
SS = 4  # supersample, then downscale for clean edges


def draw(size, maskable=False):
    """maskable icons must keep their content inside the safe circle, because
    Android crops them to whatever shape the launcher uses."""
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if maskable:
        d.rectangle([0, 0, s, s], fill=TEAL)
        inset = s * 0.22           # content within the 80% safe zone
    else:
        d.rounded_rectangle([0, 0, s, s], radius=s * 0.22, fill=TEAL)
        inset = s * 0.26

    w = s - inset * 2
    # a falling line with a flat stretch: the plan's shape, loss then the
    # festive hold then loss again
    pts = [(0.00, 0.14), (0.30, 0.42), (0.58, 0.46), (1.00, 0.86)]
    xy = [(inset + x * w, inset + y * w) for x, y in pts]

    d.line(xy, fill=WHITE, width=int(s * 0.058), joint="curve")
    for px, py in (xy[0], xy[-1]):
        r = s * 0.052
        d.ellipse([px - r, py - r, px + r, py + r], fill=WHITE)

    return img.resize((size, size), Image.LANCZOS)


os.makedirs(OUT, exist_ok=True)
jobs = [
    ("icon-192.png", 192, False),
    ("icon-512.png", 512, False),
    ("icon-maskable-512.png", 512, True),
    ("apple-touch-icon.png", 180, True),   # iOS crops corners itself
    ("favicon-32.png", 32, False),
]
for name, size, mask in jobs:
    p = os.path.join(OUT, name)
    draw(size, mask).save(p)
    print(p, os.path.getsize(p), "bytes")
