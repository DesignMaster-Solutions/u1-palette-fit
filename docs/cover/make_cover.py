#!/usr/bin/env python3
"""Cover for the forum topic: docs/cover.png, 1280x760, drawn from the CLI's own --json on the demo file
(docs/evidence/demo-plan.json), so the swatches and the dE numbers cannot drift from the code.

  node cli.mjs examples/six-colour-demo.3mf examples/spools.txt --json > docs/evidence/demo-plan.json
  DYLD_LIBRARY_PATH=/opt/homebrew/lib uv run --no-project --with pillow python3 docs/cover/make_cover.py

shortcut: macOS system fonts; change SANS/MONO to run elsewhere.
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
plan = json.loads((ROOT / "docs/evidence/demo-plan.json").read_text())
SANS, MONO = "/System/Library/Fonts/SFNS.ttf", "/System/Library/Fonts/SFNSMono.ttf"
used = [p for p in plan["palette"] if p["used"]]
assert len(plan["plan"]) == 4 and len(used) > 4 and len(plan["merges"]) == len(used) - 4

S = 2
W, H, M = 1280 * S, 760 * S, 72 * S
img = Image.new("RGB", (W, H), "#0e1013")
d = ImageDraw.Draw(img)
f = lambda path, px: ImageFont.truetype(path, px * S)

d.text((M, 60 * S), "U1 Palette Fit", font=f(SANS, 54), fill="#f2f4f7")
d.text((M, 128 * S), "A downloaded multicolour 3MF, the spools you own, four U1 slots: which spool goes where, by CIEDE2000.",
       font=f(SANS, 24), fill="#a2abb6")

def swatch(x, y, hex_, size):
    d.rounded_rectangle((x, y, x + size, y + size), radius=10 * S, fill=hex_, outline="#252a31", width=2 * S)

# left: model palette
x0, y0, sz, gap = M, 220 * S, 56 * S, 14 * S
d.text((x0, y0 - 40 * S), "Model palette (%d colours, %d used)" % (len(plan["palette"]), len(used)), font=f(SANS, 22), fill="#8a939e")
for i, p in enumerate(plan["palette"]):
    y = y0 + i * (sz + gap)
    swatch(x0, y, p["hex"], sz)
    d.text((x0 + sz + 18 * S, y + 2 * S), p["hex"], font=f(MONO, 22), fill="#f2f4f7" if p["used"] else "#5c646e")
    d.text((x0 + sz + 18 * S, y + 32 * S), "used by %d part%s" % (p["uses"], "" if p["uses"] == 1 else "s") if p["used"] else "not used",
           font=f(SANS, 18), fill="#8a939e")

# arrow
ax = 560 * S
d.text((ax, 400 * S), "→", font=f(SANS, 64), fill="#58a6ff")

# right: slot plan
x1 = 660 * S
d.text((x1, y0 - 40 * S), "Your four slots", font=f(SANS, 22), fill="#8a939e")
for i, s in enumerate(plan["plan"]):
    y = y0 + i * 100 * S
    d.text((x1, y + 20 * S), s["slot"], font=f(MONO, 28), fill="#d29922")
    swatch(x1 + 60 * S, y, s["modelHex"], 64 * S)
    swatch(x1 + 136 * S, y, s["spool"]["hex"], 64 * S)
    tx = x1 + 222 * S
    d.text((tx, y + 2 * S), s["spool"]["name"], font=f(SANS, 24), fill="#f2f4f7")
    col = "#3fb950" if s["deltaE"] < 2 else ("#d29922" if s["deltaE"] <= 5 else "#f85149")
    d.text((tx, y + 38 * S), "ΔE00 %.2f, %s" % (s["deltaE"], s["label"]), font=f(SANS, 20), fill=col)

m = plan["merges"][0]
d.text((x1, 628 * S), "%d used colours into 4 slots: %s folded into %s, ΔE00 %.2f" % (
    len(used), m["from"]["hex"], m["into"]["hex"], m["deltaE"]), font=f(SANS, 20), fill="#b9c1ca")
d.text((M, 712 * S), "designmaster-solutions.github.io/u1-palette-fit · runs in the browser, nothing uploaded · GPL-3.0",
       font=f(SANS, 18), fill="#7a838e")
out = ROOT / "docs/cover.png"
img.resize((W // S, H // S), Image.LANCZOS).save(out, optimize=True)
print(out, Image.open(out).size)
