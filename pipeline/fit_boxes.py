"""Fit approximate furniture to its SAM outlines: search each piece's position (x, z) and size (w, d, h) so
that its box, drawn from every keyframe that sees it, covers that keyframe's SAM mask as well as possible.
ARKit's sparse points place these pieces only roughly; the masks show their real extent from 5-15 angles.
Only pieces placed from sparse points (±20 cm or worse) are refitted: pieces sized from an ARKit plane keep
their size (their outlines are often half hidden, e.g. a desk behind a chair). Masks miss whatever other
things hide, so a pixel of mask the box misses costs twice a pixel of box outside the mask (Tversky
index); with plain IoU boxes shrink.

Usage: uv run --with numpy --with pillow python pipeline/fit_boxes.py <bundle_dir> <seg_dir>   (rewrites room.json)
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

bundle, seg = Path(sys.argv[1]), Path(sys.argv[2])
room = json.loads((bundle / "room.json").read_text())
SC = 8  # work at 1/8 resolution: 120×160 per keyframe
SAME = {"desk": {"desk", "table"}, "table": {"desk", "table"}}
W, D = room["shell"]["width"] / 2, room["shell"]["depth"] / 2


def project(k, pts):
    """Room points → upright keyframe pixels (pipeline/room.py conventions); None if any is behind the camera."""
    M = np.array(k["cam_to_room"])
    c = (pts - M[:3, 3]) @ M[:3, :3]
    z = -c[:, 2]
    if (z < 0.1).any():
        return None
    return np.c_[k["fx"] * c[:, 1] / z + k["cx"], k["fy"] * c[:, 0] / z + k["cy"]]


def hull(p):  # monotone chain convex hull
    p = sorted(map(tuple, p))
    def half(pts):
        h = []
        for q in pts:
            while len(h) >= 2 and (h[-1][0] - h[-2][0]) * (q[1] - h[-2][1]) - (h[-1][1] - h[-2][1]) * (q[0] - h[-2][0]) <= 0:
                h.pop()
            h.append(q)
        return h
    return half(p)[:-1] + half(p[::-1])[:-1]


def corners(x, z, w, d, h, y0, yaw):
    c, s = np.cos(yaw), np.sin(yaw)
    out = []
    for i in (-1, 1):
        for j in (-1, 1):
            lx, lz = i * w / 2, j * d / 2  # local x along w, local z along d; three.js rotation.y convention
            for y in (y0, y0 + h):
                out.append([x + lx * c + lz * s, y, z - lx * s + lz * c])
    return np.array(out)


def box_mask(k, pts):
    uv = project(k, pts)
    if uv is None:
        return None
    img = Image.new("L", (k["w"] // SC, k["h"] // SC))
    ImageDraw.Draw(img).polygon([(u / SC, v / SC) for u, v in hull(uv)], fill=1)
    return np.asarray(img, bool)


# every SAM mask per keyframe, at 1/8 resolution
masks = {}
for i, k in enumerate(room["keyframes"]):
    meta = json.loads((seg / f"{Path(k['file']).stem}.json").read_text())
    for o in meta["objects"]:
        if not o.get("mask"):
            continue
        mk, b = o["mask"], o["mask"]["bounds"]
        r = np.fromfile(seg / f"{Path(k['file']).stem}_{o['id']}.mask", np.uint8).reshape(mk["height"], mk["width"])
        full = Image.new("L", (k["w"] // SC, k["h"] // SC))
        part = Image.fromarray((r > 0).astype(np.uint8) * 255).resize((max(1, (b["right"] - b["left"]) // SC), max(1, (b["bottom"] - b["top"]) // SC)))
        full.paste(part, (b["left"] // SC, b["top"] // SC))
        masks.setdefault(i, []).append((o["label"], np.asarray(full) > 127))


def views_for(o):
    """Keyframes whose mask of this label contains the piece's projected centre (one mask per keyframe)."""
    labels = SAME.get(o["label"], {o["label"]})
    c = np.array([[o["center"][0], o["center"][1], o["center"][2]]])
    out = []
    for i, k in enumerate(room["keyframes"]):
        uv = project(k, c)
        if uv is None:
            continue
        u, v = int(uv[0, 0] / SC), int(uv[0, 1] / SC)
        for lab, m in masks.get(i, []):
            if lab in labels and 0 <= v < m.shape[0] and 0 <= u < m.shape[1] and m[max(0, v - 3):v + 4, max(0, u - 3):u + 4].any():
                out.append((k, m))
                break
    return out


def score(views, p):
    ious = []
    for k, m in views:
        b = box_mask(k, corners(*p))
        if b is None:  # a corner behind this camera: counts as a miss, or boxes could escape hard views
            ious.append(0.0)
            continue
        inter = (b & m).sum()
        denom = m.sum() + 0.5 * (b.sum() - inter)
        ious.append(inter / denom if denom else 0)
    return np.mean(ious) if ious else 0.0


report = []
for o in room["objects"]:
    if o["source"] == "measured" or o["pm_cm"] < 20:
        continue  # measured, or sized from an ARKit plane (±15): its outlines are often half hidden (desk)
    views = views_for(o)
    if len(views) < 2:
        continue
    s = o["size"]
    y0 = max(0.0, o["center"][1] - s["h"] / 2)
    p = [o["center"][0], o["center"][2], s["w"], s["d"], s["h"], y0, o["yaw"]]
    start = best = score(views, p)
    for step in (0.2, 0.1, 0.05, 0.02):  # coordinate search: each of x, z, w, d, h up and down
        improved = True
        while improved:
            improved = False
            for i in range(5):
                for sign in (1, -1):
                    q = list(p)
                    q[i] += sign * step
                    if i >= 2 and not (0.75 * [s["w"], s["d"], s["h"]][i - 2] <= q[i] <= 1.6 * [s["w"], s["d"], s["h"]][i - 2]):
                        continue  # sizes stay within -25% / +60% of the estimate
                    if abs(q[0] - o["center"][0]) > 0.6 or abs(q[1] - o["center"][2]) > 0.6:
                        continue  # and positions within 60 cm of it
                    v = score(views, q)
                    if v > best + 1e-4:
                        best, p, improved = v, q, True
    if best < start + 0.03:
        continue  # not clearly better: keep the estimate
    fw, fd, fh = p[2] / s["w"], p[3] / s["d"], p[4] / s["h"]
    for part in o.get("parts") or []:  # parts live in the piece's own frame: scale them with it
        part["size"] = [part["size"][0] * fw, part["size"][1] * fh, part["size"][2] * fd]
        part["pos"] = [part["pos"][0] * fw, part["pos"][1] * fh, part["pos"][2] * fd]
    o["center"] = [round(p[0], 3), round(y0 + p[4] / 2, 3), round(p[1], 3)]
    o["size"] = {"w": round(p[2], 3), "d": round(p[3], 3), "h": round(p[4], 3)}
    o["fit_iou"] = round(best, 3)
    report.append(f'{o["label"]} match {start:.2f}→{best:.2f} ({len(views)} views)')

(bundle / "room.json").write_text(json.dumps(room, indent=1))
print(f"fit_boxes: {len(report)} pieces refitted to their outlines · " + "; ".join(report))
