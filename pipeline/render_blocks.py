"""Draw the block room (floor, walls, furniture parts) from a keyframe's real camera pose, next to the
real frame, so Muse can judge whether the blocks match the room. Flat-shaded painter's algorithm:
plenty for judging layout, size and colour.

Usage: uv run --with numpy --with pillow python pipeline/render_blocks.py <bundle_dir> <out_dir> <keyframe_index>...
Writes <out_dir>/judge_<index>.jpg (left: real frame, right: blocks).
   or: ... render_blocks.py <bundle_dir> <out_dir> --object <object_id>...
Writes <out_dir>/obj_<id>.jpg: the object's photo crop (left) and only its blocks drawn from its best keyframe's
camera (right), plus <out_dir>/obj_<id>.json with the keyframe index and which room direction faces the
camera / image left / image right in that view (for the builder's front check, pipeline/parts.ts).
"""
import json
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

bundle, out = Path(sys.argv[1]), Path(sys.argv[2])
OBJECTS = sys.argv[4:] if sys.argv[3:4] == ["--object"] else None
idx = [] if OBJECTS else [int(i) for i in sys.argv[3:]]
room = json.loads(Path(os.environ.get("ROOM_JSON") or bundle / "room.json").read_text())  # ROOM_JSON: a builder's own copy
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
    yield from furniture()


def furniture(only=None):
    for o in room["objects"]:
        if only and o["id"] not in only:
            continue
        base = [o["center"][0], max(0.0, o["center"][1] - o["size"]["h"] / 2), o["center"][2]]
        parts = o.get("parts") or [{"size": [o["size"]["w"], o["size"]["h"], o["size"]["d"]], "pos": [0, o["size"]["h"] / 2, 0], "color": "#b8b2a7"}]
        c, s = np.cos(o["yaw"]), np.sin(o["yaw"])
        for p in parts:
            lx, ly, lz = p["pos"]
            centre = [base[0] + lx * c + lz * s, base[1] + ly - p["size"][1] / 2, base[2] - lx * s + lz * c]
            yield box(centre, p["size"], o["yaw"]), p["color"]


def draw(kf, items, bg=(235, 245, 255)):
    M = np.array(kf["cam_to_room"])
    R, t = M[:3, :3], M[:3, 3]
    img = Image.new("RGB", (kf["w"], kf["h"]), bg)
    d = ImageDraw.Draw(img)
    faces = []
    for corners, color in items:
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
        d.polygon(xy, fill=col, outline=col)
    return img


def sampler(kf, px):
    M = np.array(kf["cam_to_room"])
    R, t = M[:3, :3], M[:3, 3]

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
    return sample


def best_view(o):
    """Keyframe where the object's whole box is in front of the camera and on screen, and largest."""
    s = o["size"]
    pts = box([o["center"][0], max(0.0, o["center"][1] - s["h"] / 2), o["center"][2]], [s["w"], s["h"], s["d"]], o["yaw"])
    best = None
    for i, kf in enumerate(room["keyframes"]):
        M = np.array(kf["cam_to_room"])
        cam = (pts - M[:3, 3]) @ M[:3, :3]
        z = -cam[:, 2]
        if (z < 0.3).any():
            continue
        x, y = kf["fx"] * cam[:, 1] / z + kf["cx"], kf["fy"] * cam[:, 0] / z + kf["cy"]
        x0, x1, y0, y1 = x.min(), x.max(), y.min(), y.max()
        if x1 <= 1 or y1 <= 1 or x0 >= kf["w"] - 1 or y0 >= kf["h"] - 1:
            continue  # off screen
        inside = (min(x1, kf["w"]) - max(x0, 0)) * (min(y1, kf["h"]) - max(y0, 0)) / ((x1 - x0) * (y1 - y0))
        area = (x1 - x0) * (y1 - y0) / (kf["w"] * kf["h"])
        score = min(area, 0.4) * inside ** 3
        if best is None or score > best[0]:
            best = (score, i, [max(0, x0), max(0, y0), min(kf["w"], x1), min(kf["h"], y1)])
    return best


for oid in OBJECTS or []:
    o = next(x for x in room["objects"] if x["id"] == oid)
    found = best_view(o)
    if not found:
        print(f"{oid}: no view")
        continue
    _, i, (x0, y0, x1, y1) = found
    kf = room["keyframes"][i]
    m = 0.12 * max(x1 - x0, y1 - y0)
    bb = tuple(int(v) for v in (max(0, x0 - m), max(0, y0 - m), min(kf["w"], x1 + m), min(kf["h"], y1 + m)))
    # left: the object's own crop (masked, so only it shows); right: its blocks from the best view
    real = Image.open(bundle / o["crop"]).convert("RGB") if o.get("crop") else Image.open(bundle / kf["file"]).convert("RGB").crop(bb)
    blocks = draw(kf, furniture([oid]), (255, 255, 255)).crop(bb)
    real = real.resize((max(1, int(real.width * blocks.height / real.height)), blocks.height))
    pair = Image.new("RGB", (real.width + blocks.width + 8, real.height), (255, 255, 255))
    pair.paste(real, (0, 0))
    pair.paste(blocks, (real.width + 8, 0))
    sc = 512 / max(pair.width, pair.height)
    pair.resize((max(1, int(pair.width * sc)), max(1, int(pair.height * sc)))).save(out / f"obj_{oid}.jpg", quality=88)
    # the object's side faces the camera can see (room directions), left to right in the image
    M = np.array(kf["cam_to_room"])
    R, t = M[:3, :3], M[:3, 3]
    quarter = round(o["yaw"] / (np.pi / 2)) % 2
    hx, hz = (o["size"]["d"], o["size"]["w"]) if quarter else (o["size"]["w"], o["size"]["d"])
    seen = []
    for n in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        fc = np.array([o["center"][0] + n[0] * hx / 2, o["center"][1], o["center"][2] + n[1] * hz / 2])
        if n[0] * (t[0] - fc[0]) + n[1] * (t[2] - fc[2]) > 0.05:
            c = (fc - t) @ R
            seen.append((kf["fx"] * c[1] / max(-c[2], 0.05) + kf["cx"], list(n)))
    (out / f"obj_{oid}.json").write_text(json.dumps({"keyframe": i, "faces": [n for _, n in sorted(seen)]}))
if OBJECTS:
    print(f"rendered {len(OBJECTS)} objects → {out}")
    sys.exit()

for k in idx:
    kf = room["keyframes"][k]
    real = Image.open(bundle / kf["file"]).convert("RGB")
    img = draw(kf, solids(sampler(kf, np.asarray(real))))
    pair = Image.new("RGB", (kf["w"] * 2, kf["h"]))
    pair.paste(real, (0, 0))
    pair.paste(img, (kf["w"], 0))
    pair.resize((kf["w"], kf["h"] // 2)).save(out / f"judge_{k}.jpg", quality=85)
print(f"rendered {len(idx)} views → {out}")
