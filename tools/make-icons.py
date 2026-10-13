#!/usr/bin/env python3
"""Build the app icons from icons/source.webp (rounded teal square on a
transparent ground). Run from the repo root: python3 tools/make-icons.py

- any:      the rounded square as drawn, transparent corners
- maskable: full-bleed teal, logo inside Android's 80% safe circle
- apple:    full-bleed (iOS rounds the corners itself)"""
import numpy as np
from PIL import Image

SRC, OUT = "icons/source.webp", "icons"
CX, CY = 626, 612          # centre of the logo ring in the source
BLEED = 420                # half-size of a crop that stays inside the square

src = Image.open(SRC).convert("RGBA")

# rounded square, trimmed to a centred square box
any_ = src.crop((CX - 540, CY - 540, CX + 540, CY + 540))

# full bleed: crop inside the square, then extend the edges so the ring
# (about 780 px across) sits within the central 80%
inner = np.asarray(src.crop((CX - BLEED, CY - BLEED, CX + BLEED, CY + BLEED)).convert("RGB"))
pad = 70
bleed = Image.fromarray(np.pad(inner, ((pad, pad), (pad, pad), (0, 0)), mode="edge"))


def save(img, size, name):
    img.resize((size, size), Image.LANCZOS).save(f"{OUT}/{name}", optimize=True)


save(any_, 192, "icon-192.png")
save(any_, 512, "icon-512.png")
save(bleed, 512, "icon-maskable-512.png")
save(bleed, 180, "apple-touch-icon.png")
save(any_, 32, "favicon-32.png")
print("icons written")
