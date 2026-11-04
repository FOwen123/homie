"""Review sheet for a built room: a floor plan seen from above (each piece with an arrow on its front) and,
for every object, its photo crop next to its blocks (pipeline/render_blocks.py --object). For checking the
builders and the judge by eye.

Usage: uv run --with numpy --with pillow python eval/review_sheet.py <bundle_dir> <out.jpg>
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

bundle, out = Path(sys.argv[1]), Path(sys.argv[2])
room = json.loads((bundle / "room.json").read_text())
work = out.parent / (out.stem + "_parts")
ids = [o["id"] for o in room["objects"]]
subprocess.run(["uv", "run", "-q", "--with", "numpy", "--with", "pillow", "python", str(Path(__file__).parent.parent / "pipeline" / "render_blocks.py"),
                str(bundle), str(work), "--object", *ids], check=True)

# floor plan, 160 px per meter, north (+z) up
S, W, D = 160, room["shell"]["width"], room["shell"]["depth"]
plan = Image.new("RGB", (int(W * S) + 40, int(D * S) + 40), "white")
d = ImageDraw.Draw(plan)
P = lambda x, z: (20 + (x + W / 2) * S, 20 + (D / 2 - z) * S)
d.rectangle([P(-W / 2, D / 2), P(W / 2, -D / 2)], outline="black", width=3)
for w in room["shell"]["walls"]:
    (ax, az), (bx, bz) = w["a"], w["b"]
    L = np.hypot(bx - ax, bz - az)
    for o in w["openings"]:
        p0 = (ax + (bx - ax) * o["from"] / L, az + (bz - az) * o["from"] / L)
        p1 = (ax + (bx - ax) * o["to"] / L, az + (bz - az) * o["to"] / L)
        d.line([P(*p0), P(*p1)], fill="orange", width=7)
for o in room["objects"]:
    c, s, y = o["center"], o["size"], o["yaw"]
    co, si = np.cos(y), np.sin(y)
    pts = [P(c[0] + lx * co + lz * si, c[2] - lx * si + lz * co) for lx, lz in ((-s["w"] / 2, -s["d"] / 2), (s["w"] / 2, -s["d"] / 2), (s["w"] / 2, s["d"] / 2), (-s["w"] / 2, s["d"] / 2))]
    d.polygon(pts, outline="#2060d0", width=2)
    f = P(c[0] + si * s["d"] / 2, c[2] + co * s["d"] / 2)
    d.line([P(c[0], c[2]), f], fill="red", width=3)
    d.text((P(c[0], c[2])[0] - 20, P(c[0], c[2])[1] + 4), f'{o["id"][3:]} {o["label"]}', fill="black")

tiles = [Image.open(work / f"obj_{i}.jpg") for i in ids if (work / f"obj_{i}.jpg").exists()]
names = [f'{o["id"]} {o["label"]} {o.get("build_score", "")}' for o in room["objects"] if (work / f'obj_{o["id"]}.jpg').exists()]
TW, TH = 520, 300
cols = 3
rows = (len(tiles) + cols - 1) // cols
grid = Image.new("RGB", (cols * TW, rows * TH), "white")
g = ImageDraw.Draw(grid)
for k, (t, n) in enumerate(zip(tiles, names)):
    t.thumbnail((TW - 10, TH - 24))
    x, yy = (k % cols) * TW, (k // cols) * TH
    grid.paste(t, (x + 5, yy + 20))
    g.text((x + 5, yy + 4), n, fill="black")
sheet = Image.new("RGB", (max(plan.width, grid.width), plan.height + grid.height), "white")
sheet.paste(plan, (0, 0))
sheet.paste(grid, (0, plan.height))
sheet.save(out, quality=85)
print(f"review sheet → {out}")
