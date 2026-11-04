"""Draw the block room (floor, walls, furniture parts) from a keyframe's real camera pose, next to the
real frame, so Muse can judge whether the blocks match the room. Flat-shaded painter's algorithm:
plenty for judging layout, size and colour.

Usage: uv run --with numpy --with pillow python pipeline/render_blocks.py <bundle_dir> <out_dir> <keyframe_index>...
Writes <out_dir>/judge_<index>.jpg (left: real frame, right: blocks).
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

bundle, out = Path(sys.argv[1]), Path(sys.argv[2])
idx = [int(i) for i in sys.argv[3:]]
room = json.loads((bundle / "room.json").read_text())
out.mkdir(parents=True, exist_ok=True)
LIGHT = np.array([0.3, 0.9, 0.4]) / np.linalg.norm([0.3, 0.9, 0.4])
FACES = [(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (0, 3, 7, 4)]
hexrgb = lambda h: np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], float)


def box(center, size, yaw):
    """8 corners of a yawed box: bottom 4 then top 4 (room coords)."""
    c, s = np.cos(yaw), np.sin(yaw)
    pts = []
    for dy in (0, 1):
        for i, j in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            lx, lz = i * size[0] / 2, j * size[2] / 2
            pts.append([center[0] + lx * c + lz * s, center[1] + dy * size[1], center[2] - lx * s + lz * c])
    return np.array(pts)


def solids(sample=None):
    sh, fin = room["shell"], room.get("finishes", {})
    W, D, H = sh["width"], sh["depth"], sh["height"]
    T = 0.25  # floor and walls in 25 cm tiles, so tiles behind the camera drop out one by one
    for x in np.arange(-W / 2, W / 2, T):
        for z in np.arange(-D / 2, D / 2, T):
            tw, td = min(T, W / 2 - x), min(T, D / 2 - z)
            yield box([x + tw / 2, -0.02, z + td / 2], [tw, 0.02, td], 0), fin.get("floor", "#9b9ca0")
    for w in sh["walls"]:  # thin slabs just outside each wall
        (ax, az), (bx, bz) = w["a"], w["b"]
        L = np.hypot(bx - ax, bz - az)
        ux, uz = (bx - ax) / L, (bz - az) / L
        yaw = np.arctan2(-uz, ux)
        holes = w["openings"]
        for t0 in np.arange(0, L, T):
            tl = min(T, L - t0)
            for y0 in np.arange(0, H, T):
                th = min(T, H - y0)
                tm, ym = t0 + tl / 2, y0 + th / 2
                if any(o["from"] <= tm <= o["to"] and o["bottom"] <= ym <= o["top"] for o in holes):
                    continue  # leave the door / window opening open
                cx, cz = ax + ux * tm + uz * 0.03, az + uz * tm - ux * 0.03
                yield box([cx, y0, cz], [tl, th, 0.06], yaw), fin.get("wall", "#f3efe6")
        for o in holes:  # fill each opening with the colour the real photo shows there (a red door stays red)
            tm = (o["from"] + o["to"]) / 2
            centre = [ax + ux * tm + uz * 0.02, o["bottom"], az + uz * tm - ux * 0.02]
            # median over a 3×3 grid on the opening: coats or a curtain cover part of it, rarely most of it
            grid = [sample([ax + ux * (o["from"] + f * (o["to"] - o["from"])), o["bottom"] + g * (o["top"] - o["bottom"]), az + uz * (o["from"] + f * (o["to"] - o["from"]))])
                    for f in (0.2, 0.5, 0.8) for g in (0.2, 0.5, 0.8)] if sample else []
            grid = [hexrgb(c) for c in grid if c]
            colour = "#%02x%02x%02x" % tuple(np.median(grid, axis=0).astype(int)) if grid else None
            yield box(centre, [o["to"] - o["from"], o["top"] - o["bottom"], 0.02], yaw), colour or "#8a8f99"
    for o in room["objects"]:
        base = [o["center"][0], max(0.0, o["center"][1] - o["size"]["h"] / 2), o["center"][2]]
        parts = o.get("parts") or [{"size": [o["size"]["w"], o["size"]["h"], o["size"]["d"]], "pos": [0, o["size"]["h"] / 2, 0], "color": "#b8b2a7"}]
        c, s = np.cos(o["yaw"]), np.sin(o["yaw"])
        for p in parts:
            lx, ly, lz = p["pos"]
            centre = [base[0] + lx * c + lz * s, base[1] + ly - p["size"][1] / 2, base[2] - lx * s + lz * c]
            yield box(centre, p["size"], o["yaw"]), p["color"]


for k in idx:
    kf = room["keyframes"][k]
    M = np.array(kf["cam_to_room"])
    R, t = M[:3, :3], M[:3, 3]
    real = Image.open(bundle / kf["file"]).convert("RGB")
    img = Image.new("RGB", (kf["w"], kf["h"]), (235, 245, 255))
    draw = ImageDraw.Draw(img)
    px = np.asarray(real)

    def sample(p):
        c = (np.array(p) - t) @ R
        z = -c[2]
        if z < 0.2:
            return None
        x, y = int(kf["fx"] * c[1] / z + kf["cx"]), int(kf["fy"] * c[0] / z + kf["cy"])
        if not (8 <= x < kf["w"] - 8 and 8 <= y < kf["h"] - 8):
            return None
        r, g, b = np.median(px[y - 8:y + 8, x - 8:x + 8].reshape(-1, 3), axis=0).astype(int)
        return f"#{r:02x}{g:02x}{b:02x}"

    faces = []
    for corners, color in solids(sample):
        cam = (corners - t) @ R  # Rᵀ·(p - t)
        z = -cam[:, 2]
        for f in FACES:
            if (z[list(f)] < 0.05).any():
                continue
            xy = [(kf["fx"] * cam[i, 1] / z[i] + kf["cx"], kf["fy"] * cam[i, 0] / z[i] + kf["cy"]) for i in f]
            a, b, c3 = corners[f[0]], corners[f[1]], corners[f[2]]
            n = np.cross(b - a, c3 - a)
            n = n / (np.linalg.norm(n) + 1e-9)
            shade = 0.55 + 0.45 * abs(n @ LIGHT)
            faces.append((z[list(f)].mean(), xy, tuple((hexrgb(color) * shade).clip(0, 255).astype(int))))
    for _, xy, col in sorted(faces, key=lambda f: -f[0]):  # far to near
        draw.polygon(xy, fill=col, outline=col)
    pair = Image.new("RGB", (kf["w"] * 2, kf["h"]))
    pair.paste(real, (0, 0))
    pair.paste(img, (kf["w"], 0))
    pair.resize((kf["w"], kf["h"] // 2)).save(out / f"judge_{k}.jpg", quality=85)
print(f"rendered {len(idx)} views → {out}")
