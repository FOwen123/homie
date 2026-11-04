"""Build room.json: the room shell, every piece of furniture with size ± and source, and keyframe
poses, all in "room coordinates" (meters, floor at y=0, walls aligned with x/z, centre at 0,0).

- Flat furniture (bed, desk) and doors/windows come from measure.py (SAM masks on ARKit planes).
- Everything else (chair, wardrobe, bin...) comes from ARKit's tracked 3D points that fall inside the
  object's SAM masks across keyframes. Sparse points, so those sizes are marked "approx".
- The room shell is the rectangle that holds ARKit's points, rotated to the dominant wall direction.

Usage: uv run --with numpy --with pillow python pipeline/room.py <capture_dir> <seg_dir> <keyframe_dir> <measure.json> <out_dir>
Writes <out_dir>/room.json and <out_dir>/crops/<object id>.jpg (masked cut-outs for Muse and the UI).
"""
import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image

cap, seg, kfdir, measure_path, out = map(Path, sys.argv[1:6])
KF_STEP, SW, SH, SENSOR_H = 50, 960, 1280, 1440
S = SENSOR_H / SW
SKIP = {"floor", "wall", "ceiling", "ceiling beam", "beam", "light switch", "power outlet", "access panel",
        "utility panel", "electrical panel", "floor mat", "doorway"}
FIXTURE_WORDS = ("outlet", "socket", "switch", "panel", "vent", "thermostat")  # Muse labels freely: "wall outlet"
OPENINGS = {"door", "window"}
AS_WINDOW = {"curtain"}  # a curtain marks a window opening, not furniture
# Minimum depth by label: ARKit often sees only the front face of tall furniture.
MIN_DEPTH = {"desk": 0.50, "wardrobe": 0.55, "cabinet": 0.40, "shelf": 0.30, "mini fridge": 0.45, "chair": 0.45, "storage box": 0.35, "sofa": 0.75}
M = lambda flat: np.array(flat, dtype=float).reshape(4, 4).T

frames = [json.loads(l) for l in open(cap / "frames.jsonl")]
feats = {json.loads(l)["i"]: np.array(json.loads(l)["points"], float) for l in open(cap / "features.jsonl")}
planes = json.load(open(cap / "planes.json"))
measured = json.load(open(measure_path))
floor_y = measured["floorY"]

# --- room frame: rotate so the dominant wall direction lines up with the x axis ----------------------
angles, weights = [], []
for p in planes:
    if p["alignment"] == "vertical":
        n = M(p["transform"])[:3, 1]  # a plane anchor's local y axis is its normal
        angles.append(np.arctan2(n[2], n[0]) % (np.pi / 2))
        weights.append(p["extent"]["width"] * p["extent"]["height"])
# circular mean on a 90° period, weighted by wall area
th = np.angle(np.sum(np.array(weights) * np.exp(4j * np.array(angles)))) / 4
c, s = np.cos(th), np.sin(th)
all_pts = np.concatenate(list(feats.values()))
rot = lambda xz: np.c_[c * xz[:, 0] + s * xz[:, 1], -s * xz[:, 0] + c * xz[:, 1]]
q = rot(all_pts[:, [0, 2]])
band = (all_pts[:, 1] - floor_y > 0.1) & (all_pts[:, 1] - floor_y < 2.4)
lo, hi = np.percentile(q[band], 1, axis=0), np.percentile(q[band], 99, axis=0)
mid = (lo + hi) / 2
W2R = np.array([[c, 0, s, -mid[0]], [0, 1, 0, -floor_y], [-s, 0, c, -mid[1]], [0, 0, 0, 1]])
to_room = lambda P: (W2R @ np.c_[P, np.ones(len(P))].T)[:3].T
tops = [M(p["transform"])[1, 3] + max(np.array(p["boundary"])[:, 2].max(), 0) for p in planes if p["classification"] == "wall"]
height = float(np.clip(np.percentile(all_pts[:, 1], 99.5) - floor_y, 2.3, 3.2))
room_w, room_d = (hi - lo)


def project(f, pts):
    K = np.array(f["intrinsics"]).reshape(3, 3).T
    cc = (np.linalg.inv(M(f["transform"])) @ np.c_[pts, np.ones(len(pts))].T)[:3]
    z = -cc[2]
    zs = np.where(z > 0.05, z, np.nan)
    u = K[0, 0] * cc[0] / zs + K[0, 2]
    v = -K[1, 1] * cc[1] / zs + K[1, 2]
    return (SENSOR_H - 1 - v) / S, u / S, z


def load_mask(name, o):
    mk = o["mask"]
    r = np.fromfile(seg / f'{name}_{o["id"]}.mask', np.uint8).reshape(mk["height"], mk["width"])
    return r, mk["bounds"]


def min_rect(xy):
    best = None
    for a in np.radians(np.arange(0, 90, 1.0)):
        R = np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]])
        qq = xy @ R
        l, h = qq.min(0), qq.max(0)
        if best is None or np.prod(h - l) < best[0]:
            best = (np.prod(h - l), h - l, a, ((l + h) / 2) @ R.T)
    return best[1], best[2], best[3]


# --- gather masked feature points per label, and the best crop per label -------------------------------
points, crops = defaultdict(list), {}
for meta_path in sorted(seg.glob("k*.json")):
    meta = json.loads(meta_path.read_text())
    name = meta["name"][:3]
    fi = (int(name[1:]) - 1) * KF_STEP
    P = feats.get(fi)
    for o in meta["objects"]:
        if not o["mask"] or o["label"] in SKIP or any(w in o["label"] for w in FIXTURE_WORDS):
            continue
        r, b = load_mask(name, o)
        area = int((r > 0).sum() * ((b["right"] - b["left"]) * (b["bottom"] - b["top"])) / r.size)
        score = area * o.get("visible", 1) * (0.5 if b["left"] <= 1 or b["right"] >= SW - 1 else 1)  # prefer uncut views
        if o["label"] not in crops or score > crops[o["label"]][0]:
            crops[o["label"]] = (score, name, o)
        if P is None or not len(P):
            continue
        x, y, z = project(frames[fi], P)
        ok = np.isfinite(x) & (x >= b["left"]) & (x < b["right"]) & (y >= b["top"]) & (y < b["bottom"])
        if not ok.any():
            continue
        ry = ((y[ok] - b["top"]) * r.shape[0] // (b["bottom"] - b["top"])).astype(int).clip(0, r.shape[0] - 1)
        rx = ((x[ok] - b["left"]) * r.shape[1] // (b["right"] - b["left"])).astype(int).clip(0, r.shape[1] - 1)
        inside = r[ry, rx] > 0
        sel, zz = P[ok][inside], z[ok][inside]
        if len(sel) >= 3:  # drop background seen past the object's edges
            sel = sel[np.abs(zz - np.median(zz)) < 0.35 * np.median(zz)]
            points[o["label"]].append(sel)


def clusters(P, radius=0.35):
    """Group points into objects: union of 3D grid cells that touch."""
    keys = np.floor(P[:, [0, 2]] / radius).astype(int)
    cells = defaultdict(list)
    for i, k in enumerate(map(tuple, keys)):
        cells[k].append(i)
    left, out_ = set(cells), []
    while left:
        stack, comp = [left.pop()], []
        while stack:
            k = stack.pop()
            comp += cells[k]
            for dx in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    n = (k[0] + dx, k[1] + dz)
                    if n in left:
                        left.remove(n)
                        stack.append(n)
        out_.append(P[comp])
    return out_


objects, openings = [], []
used_labels = set()
# 1) plane-measured objects (trusted) from measure.py. Pieces of one object (a duvet fold splitting the bed
#    top) come back as separate components: merge same-label pieces on the same surface within 30 cm.
trusted = [m for m in measured["objects"] if m["trusted"] and m["area_m2"] >= 0.05]
merged = []
for m in sorted(trusted, key=lambda m: -m["area_m2"]):
    C = np.array(m["corners"])
    host = next((h for h in merged if h["label"] == m["label"] and h["plane"] == m["plane"] and
                 np.min(np.linalg.norm(np.array(h["corners"])[4:, None, [0, 2]] - C[None, 4:, [0, 2]], axis=2)) < 0.3 + 0.5 * max(np.ptp(C[4:, 0]), np.ptp(C[4:, 2]))), None)
    if host is None or m["label"] in OPENINGS:
        merged.append(dict(m))
        continue
    top = np.r_[np.array(host["corners"])[4:], C[4:]]
    (l, w), a, cxz = min_rect(top[:, [0, 2]])
    R = np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]])
    q = top[:, [0, 2]] @ R
    lo_q, hi_q = q.min(0), q.max(0)
    rect = [np.array(v) @ R.T for v in ((lo_q[0], lo_q[1]), (hi_q[0], lo_q[1]), (hi_q[0], hi_q[1]), (lo_q[0], hi_q[1]))]
    y = top[0, 1]
    host["corners"] = [[r[0], floor_y, r[1]] for r in rect] + [[r[0], y, r[1]] for r in rect]
    host["area_m2"] += m["area_m2"]
    host["needs_check"] = host["needs_check"] and m["needs_check"]
for m in merged:
    C = to_room(np.array(m["corners"]))
    if m["label"] in OPENINGS:
        openings.append({"type": m["label"], "corners": C})
        continue
    top = C[4:]
    e1, e2 = top[1] - top[0], top[3] - top[0]
    length, width = np.linalg.norm(e1), np.linalg.norm(e2)
    yaw = float(np.arctan2(-e1[2], e1[0]))
    centre = top.mean(0)
    approx = m["needs_check"]
    if approx and points.get(m["label"]):  # partly seen top: widen with the object's own points
        P = to_room(np.concatenate(points[m["label"]]))
        near = P[np.linalg.norm(P[:, [0, 2]] - centre[[0, 2]], axis=1) < 1.0]
        xz = np.r_[top[:, [0, 2]], np.percentile(near[:, [0, 2]], [5, 95], axis=0)] if len(near) > 10 else top[:, [0, 2]]
        (length, width), a, cxz = min_rect(xz)
        if length < width:
            length, width = width, length
        centre = np.array([cxz[0], centre[1], cxz[1]])
    depth = max(min(length, width), MIN_DEPTH.get(m["label"], 0)) if approx else min(length, width)
    objects.append({"label": m["label"], "center": [centre[0], centre[1] / 2, centre[2]], "yaw": yaw,
                    "size": {"w": max(length, width), "d": depth, "h": centre[1]},
                    "pm_cm": 15 if approx else 5, "source": "approx" if approx else "measured"})
    used_labels.add(m["label"])

# 2) point-measured objects for everything else
for label, chunks in points.items():
    if label in used_labels or label in OPENINGS:
        continue
    P = to_room(np.concatenate(chunks))
    for cl in clusters(P):
        if len(cl) < 8:
            continue
        if label in AS_WINDOW:
            lo3, hi3 = np.percentile(cl, 3, axis=0), np.percentile(cl, 97, axis=0)
            openings.append({"type": "window", "corners": np.array([[lo3[0], lo3[1], lo3[2]], [hi3[0], hi3[1], hi3[2]]])})
            continue
        lo3, hi3 = np.percentile(cl, 4, axis=0), np.percentile(cl, 96, axis=0)
        core = cl[np.all((cl >= lo3) & (cl <= hi3), axis=1)]
        (length, width), a, cxz = min_rect(core[:, [0, 2]])
        if length < width:  # keep w along the yaw axis as the longer side
            length, width, a = width, length, a + np.pi / 2
        bottom = 0.0 if lo3[1] < 0.35 else float(lo3[1])   # standing on the floor unless clearly raised
        h = float(hi3[1] - bottom)
        objects.append({"label": label, "center": [float(cxz[0]), bottom + h / 2, float(cxz[1])], "yaw": float(-a),  # min_rect axis (cos a, sin a) in x,z is the object's local x
                        "size": {"w": float(max(length, 0.15)), "d": float(max(width, MIN_DEPTH.get(label, 0.15))), "h": max(h, 0.1)},
                        "pm_cm": 20, "source": "approx"})

# 2b) objects Muse saw but ARKit tracked too few points on (chairs, lamps): cast a ray through the bottom
#     centre of the best mask onto the floor, and size the object from the mask at that distance.
have = {o["label"] for o in objects}
if "desk" in have:
    have.add("table")  # Muse sometimes calls the same desk a table
for label, (_, name, so) in crops.items():
    if label in have or label in OPENINGS or label in AS_WINDOW:
        continue
    f = frames[(int(name[1:]) - 1) * KF_STEP]
    K = np.array(f["intrinsics"]).reshape(3, 3).T
    T = M(f["transform"])
    b = so["mask"]["bounds"]

    def ray(x, y):  # upright keyframe pixel -> world ray direction
        u, v = y * S, SENSOR_H - 1 - x * S
        return T[:3, :3] @ np.array([(u - K[0, 2]) / K[0, 0], -(v - K[1, 2]) / K[1, 1], -1.0])

    o3, d = T[:3, 3], ray((b["left"] + b["right"]) / 2, b["bottom"])
    if d[1] >= -1e-3:
        continue  # bottom edge is above the horizon: not standing on the floor in view
    t = (floor_y - o3[1]) / d[1]
    foot = o3 + t * d
    dist = np.linalg.norm(foot - o3)
    w = (b["right"] - b["left"]) * S / K[0, 0] * dist
    h = (b["bottom"] - b["top"]) * S / K[1, 1] * dist
    pc = to_room(foot[None])[0]
    objects.append({"label": label, "center": [float(pc[0]), h / 2, float(pc[2])], "yaw": 0.0,
                    "size": {"w": float(w), "d": float(max(MIN_DEPTH.get(label, 0.3), 0.3)), "h": float(h)},
                    "pm_cm": 25, "source": "approx"})

# 3) door and window openings, snapped to the nearest wall of the room rectangle
walls = [  # name, start, end (room coords, counter-clockwise)
    ("south", (-room_w / 2, -room_d / 2), (room_w / 2, -room_d / 2)), ("east", (room_w / 2, -room_d / 2), (room_w / 2, room_d / 2)),
    ("north", (room_w / 2, room_d / 2), (-room_w / 2, room_d / 2)), ("west", (-room_w / 2, room_d / 2), (-room_w / 2, -room_d / 2))]
wall_json = [{"id": n, "a": list(a), "b": list(b), "openings": []} for n, a, b in walls]
for op in openings:
    C = op["corners"]
    xz, ys = C[:, [0, 2]], C[:, 1]
    best = min(range(4), key=lambda i: min(abs(xz[:, 0].mean() - walls[i][1][0]) if walls[i][1][0] == walls[i][2][0] else 9,
                                          abs(xz[:, 1].mean() - walls[i][1][1]) if walls[i][1][1] == walls[i][2][1] else 9))
    a, b = np.array(walls[best][1]), np.array(walls[best][2])
    d = (b - a) / np.linalg.norm(b - a)
    t = (xz - a) @ d
    wall_json[best]["openings"].append({"type": op["type"], "from": float(t.min()), "to": float(t.max()),
                                        "bottom": float(max(ys.min(), 0)), "top": float(min(ys.max(), height))})

# --- crops for Muse and the UI ------------------------------------------------------------------------
(out / "crops").mkdir(parents=True, exist_ok=True)
for i, o in enumerate(objects):
    o["id"] = f"obj{i}"
    if o["label"] in crops:
        _, name, so = crops[o["label"]]
        r, b = load_mask(name, so)
        img = Image.open(kfdir / f"{name}.jpg").convert("RGB").crop((b["left"], b["top"], b["right"], b["bottom"]))
        m = Image.fromarray((r > 0).astype(np.uint8) * 255).resize(img.size)
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, (0, 0), m)
        bg.save(out / "crops" / f'{o["id"]}.jpg', quality=88)
        o["crop"] = f'crops/{o["id"]}.jpg'

# --- keyframes in room coordinates (for realistic photos and the judge) -----------------------------
kfs = []
for meta_path in sorted(seg.glob("k*.json")):
    name = meta_path.stem
    f = frames[(int(name[1:]) - 1) * KF_STEP]
    K = np.array(f["intrinsics"]).reshape(3, 3).T
    kfs.append({"file": f"keyframes/{name}.jpg", "cam_to_room": (W2R @ M(f["transform"])).round(4).tolist(),
                # upright, scaled intrinsics (the keyframe is the sensor image rotated 90° clockwise)
                "fx": K[1, 1] / S, "fy": K[0, 0] / S, "cx": (SENSOR_H - 1 - K[1, 2]) / S, "cy": K[0, 2] / S, "w": SW, "h": SH})

rnd = lambda v: round(float(v), 3)
room = {"version": 1, "units": "meters",
        "shell": {"width": rnd(room_w), "depth": rnd(room_d), "height": rnd(height), "walls": wall_json},
        "objects": [{**o, "center": [rnd(v) for v in o["center"]], "yaw": rnd(o["yaw"]),
                     "size": {k: rnd(v) for k, v in o["size"].items()}} for o in objects],
        "keyframes": kfs, "world_to_room": W2R.round(5).tolist()}
assert room_w > 1 and room_d > 1, "room rectangle too small; capture probably did not see the walls"
(out / "room.json").write_text(json.dumps(room, indent=1))
print(f"room {room_w:.2f} × {room_d:.2f} × {height:.2f} m, {len(objects)} objects, {len(openings)} openings")
for o in room["objects"]:
    print(f'  {o["label"]:14s} {o["size"]["w"]*100:5.0f} × {o["size"]["d"]*100:4.0f} × {o["size"]["h"]*100:4.0f} cm  ±{o["pm_cm"]} {o["source"]}')
