"""Lift SAM masks into measured 3D objects using ARKit planes and camera poses.

For every ARKit plane we lay a 2 cm grid of cells over its outline. In each keyframe we project all
cells into the image, keep only the nearest surface per pixel (a coarse depth buffer), and mark which
visible cells fall inside each SAM mask. A cell belongs to an object when it is inside that object's
mask in at least half the frames where the object was detected and the cell was visible. This clips
ARKit's over-grown planes to the object's real outline.

Usage: uv run --with numpy --with pillow python pipeline/measure.py <capture_dir> <seg_dir> <out.json>
"""
import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

cap, seg, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
CELL = 0.02          # grid step on planes, meters
KF_STEP = 50         # keyframe kNN = video frame (NN-1)*50 (see AGENTS.md capture format)
SW, SH = 960, 1280   # upright keyframe size given to Muse/SAM
SENSOR_H = 1440      # sensor image is 1920x1440 (landscape)
S = SENSOR_H / SW    # upright keyframes are scaled down by this factor
ZB = 4               # depth buffer downscale
GROW = float(__import__("os").environ.get("GROW", 0))  # meters a desk/bed plane may extend past ARKit's outline; 0.5 fixed desk length but bloated the bed via its hanging duvet
VOTE = float(__import__("os").environ.get("VOTE", 0.5))  # share of frames a cell must be inside the mask
PLANAR = {"bed": "horizontal", "desk": "horizontal", "table": "horizontal", "door": "vertical", "window": "vertical"}

M = lambda flat: np.array(flat, dtype=float).reshape(4, 4).T
frames = [json.loads(l) for l in open(cap / "frames.jsonl")]
planes = json.load(open(cap / "planes.json"))
floor = max((p for p in planes if p["classification"] == "floor"), key=lambda p: p["extent"]["width"] * p["extent"]["height"])
floor_y = M(floor["transform"])[1, 3]

# --- plane cells -------------------------------------------------------------------------------
cells = []  # per plane: dict with local grid coords, world points, plane index
for pi, p in enumerate(planes):
    b = np.array(p["boundary"], dtype=float)[:, [0, 2]]
    # ARKit only grows a plane where it sees texture (papers on a desk, not its plain edge), so let
    # non-floor horizontal planes reach GROW past their outline; the mask vote decides the real edge.
    grow = GROW if p["alignment"] == "horizontal" and p["classification"] != "floor" else 0.0
    lo, hi = b.min(0) - 0.05 - grow, b.max(0) + 0.05 + grow
    nx, nz = int(np.ceil((hi[0] - lo[0]) / CELL)), int(np.ceil((hi[1] - lo[1]) / CELL))
    img = Image.new("L", (nx, nz))
    ImageDraw.Draw(img).polygon([tuple((v - lo) / CELL) for v in b], fill=255)
    if grow:
        img = img.filter(ImageFilter.MaxFilter(2 * int(grow / CELL) + 1))
    gz, gx = np.nonzero(np.asarray(img))
    local = np.c_[lo[0] + (gx + 0.5) * CELL, np.zeros(len(gx)), lo[1] + (gz + 0.5) * CELL, np.ones(len(gx))]
    cells.append({"grid": np.c_[gx, gz], "world": (M(p["transform"]) @ local.T)[:3].T, "lo": lo})
all_world = np.concatenate([c["world"] for c in cells])
all_plane = np.concatenate([np.full(len(c["world"]), i) for i, c in enumerate(cells)])
all_index = np.concatenate([np.arange(len(c["world"])) for c in cells])


def project(f, pts):
    """World points -> upright keyframe pixels (x, y) and depth."""
    K = np.array(f["intrinsics"]).reshape(3, 3).T
    c = (np.linalg.inv(M(f["transform"])) @ np.c_[pts, np.ones(len(pts))].T)[:3]
    z = -c[2]
    zs = np.where(z > 0.05, z, np.nan)
    u = K[0, 0] * c[0] / zs + K[0, 2]          # sensor column
    v = -K[1, 1] * c[1] / zs + K[1, 2]         # sensor row
    return (SENSOR_H - 1 - v) / S, u / S, z    # 90° clockwise rotation, then scale


# --- vote cells per object instance ------------------------------------------------------------
votes = defaultdict(lambda: defaultdict(lambda: [0, 0]))  # (label, plane) -> cell -> [in mask, visible]
for meta_path in sorted(seg.glob("k*.json")):
    meta = json.loads(meta_path.read_text())
    f = frames[(int(meta["name"][1:3]) - 1) * KF_STEP]
    x, y, z = project(f, all_world)
    ok = np.isfinite(x) & (x >= 0) & (x < SW) & (y >= 0) & (y < SH)
    # coarse depth buffer: nearest plane cell per pixel wins (hides surfaces behind furniture)
    zb = np.full((SH // ZB, SW // ZB), np.inf)
    xi, yi = (x[ok] // ZB).astype(int), (y[ok] // ZB).astype(int)
    np.minimum.at(zb, (yi, xi), z[ok])
    vis = np.zeros(len(all_world), bool)
    vis[np.flatnonzero(ok)] = z[ok] <= zb[yi, xi] + 0.10
    vx, vy = np.nan_to_num(x).astype(int), np.nan_to_num(y).astype(int)
    for o in meta["objects"]:
        mk = o["mask"]
        if not mk:
            continue
        raster = np.fromfile(seg / f'{meta["name"][:3]}_{o["id"]}.mask', np.uint8).reshape(mk["height"], mk["width"])
        bx = mk["bounds"]
        inside = vis & (vx >= bx["left"]) & (vx < bx["right"]) & (vy >= bx["top"]) & (vy < bx["bottom"])
        idx = np.flatnonzero(inside)
        # the raster can be smaller than its bounds (SAM caps raster size), so scale into it
        ry = ((vy[idx] - bx["top"]) * mk["height"] // (bx["bottom"] - bx["top"])).clip(0, mk["height"] - 1)
        rx = ((vx[idx] - bx["left"]) * mk["width"] // (bx["right"] - bx["left"])).clip(0, mk["width"] - 1)
        hit = raster[ry, rx] > 0
        if hit.sum() < 20:
            continue
        # the object's surface is the plane holding most of its visible masked cells
        best = np.bincount(all_plane[idx[hit]]).argmax()
        on_plane = np.flatnonzero(vis & (all_plane == best))
        in_mask = np.zeros(len(all_world), bool)
        in_mask[idx[hit]] = True
        tally = votes[(o["label"], int(best))]
        for gi in on_plane:
            t = tally[int(all_index[gi])]
            t[1] += 1
            t[0] += int(in_mask[gi])


def components(points):
    """4-connected components of grid cells."""
    left, groups = set(map(tuple, points)), []
    while left:
        stack, comp = [left.pop()], []
        while stack:
            c = stack.pop()
            comp.append(c)
            for d in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                n = (c[0] + d[0], c[1] + d[1])
                if n in left:
                    left.remove(n)
                    stack.append(n)
        groups.append(np.array(comp))
    return groups


def min_rect(xy):
    """Smallest-area rectangle over 1° steps: (long side, short side, angle, centre)."""
    best = None
    for a in np.radians(np.arange(0, 90, 1.0)):
        R = np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]])
        q = xy @ R
        lo, hi = q.min(0), q.max(0)
        area = np.prod(hi - lo)
        if best is None or area < best[0]:
            best = (area, hi - lo, a, ((lo + hi) / 2) @ R.T)
    _, size, a, centre = best
    return max(size), min(size), a, centre


objects = []
for (label, pi), tally in votes.items():
    keep = np.array([c for c, (h, n) in tally.items() if n and h / n >= VOTE], int)
    if len(keep) < 25:  # under 100 cm² is noise
        continue
    p = planes[pi]
    grid = cells[pi]["grid"]
    for comp in components(grid[keep]):
        if len(comp) < 25:
            continue
        local_xz = cells[pi]["lo"] + (comp + 0.5) * CELL
        long_, short, a, centre = min_rect(local_xz)
        T = M(p["transform"])
        world_c = (T @ np.array([centre[0], 0, centre[1], 1]))[:3]
        horizontal = p["alignment"] == "horizontal"
        # Only objects whose own surface is an ARKit plane are measured by this method: a bed or desk top,
        # a door in a wall. Chairs, bins and boxes land on the floor/wall behind them, so they are untrusted.
        trusted = PLANAR.get(label) == p["alignment"] and p["classification"] != "floor"
        obj = {"label": label, "plane": p["classification"], "alignment": p["alignment"], "cells": len(comp),
               "area_m2": round(len(comp) * CELL * CELL, 3), "trusted": trusted}
        # Fill = measured cells / their bounding rectangle. A low fill means the surface was only partly
        # seen (clutter, missed edges), so the engine should ask the user to confirm this size.
        rect_area = long_ * short if horizontal else (np.ptp(local_xz[:, 0]) * np.ptp(local_xz[:, 1]))
        obj["fill"] = round(float(obj["area_m2"] / max(rect_area, 1e-6)), 2)
        obj["needs_check"] = bool(obj["fill"] < 0.45)
        if horizontal:
            obj.update(length_cm=round(long_ * 100, 1), width_cm=round(short * 100, 1),
                       height_cm=round((world_c[1] - floor_y) * 100, 1))
        else:  # vertical plane: local x is horizontal along the wall, local z is vertical
            xs, zs = local_xz[:, 0], local_xz[:, 1]
            obj.update(width_cm=round((xs.max() - xs.min()) * 100, 1), tall_cm=round((zs.max() - zs.min()) * 100, 1))
        # 8 box corners in world space for the viewer: footprint rectangle from the floor up to the plane
        R = np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]])
        lo_q = (local_xz @ R).min(0); hi_q = (local_xz @ R).max(0)
        rect = [np.array([qx, qz]) @ R.T for qx, qz in ((lo_q[0], lo_q[1]), (hi_q[0], lo_q[1]), (hi_q[0], hi_q[1]), (lo_q[0], hi_q[1]))]
        top = [(T @ np.array([r[0], 0, r[1], 1]))[:3] for r in rect]
        if horizontal:
            bottom = [np.array([t[0], floor_y, t[2]]) for t in top]
            corners = bottom + top
        else:
            corners = top + top  # flat panel on the wall
        obj["corners"] = np.round(np.array(corners), 3).tolist()
        objects.append(obj)

objects.sort(key=lambda o: -o["area_m2"])
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps({"floorY": floor_y, "objects": objects}, indent=1))
for o in objects:
    dims = (f'{o["length_cm"]} × {o["width_cm"]} cm, top {o["height_cm"]} cm above floor' if o["alignment"] == "horizontal"
            else f'{o["width_cm"]} wide × {o["tall_cm"]} tall (on {o["plane"]} plane)')
    if o["trusted"]:
        print(f'{o["label"]:14s} {dims}   [fill {o["fill"]:.0%}{", NEEDS CHECK" if o["needs_check"] else ""}]')
print(f'{sum(not o["trusted"] for o in objects)} untrusted pieces (non-flat objects or wrong surface) kept in the JSON only')
