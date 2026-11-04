"""Line furniture up with the room: square to the walls, inside the room, flush against a wall it nearly
touches, front facing into the room, not overlapping other furniture, and never floating (it sits on the
furniture under it or reaches the floor; wall-mounted pieces hang on their wall, under the ceiling). Sizes never change, except growing down to the floor.
Runs after room.py and again after judge.ts (its moves can drift).

Usage: uv run --with numpy python pipeline/layout.py <bundle_dir>   (rewrites <bundle_dir>/room.json)
"""
import json
import sys
from pathlib import Path

import numpy as np

SNAP = 0.35          # an object this close to a wall is standing against it
SNAP_TALL = 0.5      # tall pieces (wardrobes, shelves) nearly always stand against a wall
WALL_MOUNTED = {"air conditioner", "curtain"}
GAP = 0.01           # leave 1 cm so blocks don't z-fight with the wall

path = Path(sys.argv[1]) / "room.json"
room = json.loads(path.read_text())
W, D = room["shell"]["width"] / 2, room["shell"]["depth"] / 2
objs = room["objects"]


def half(o):  # footprint half extents along room x, z (yaw is a multiple of 90° here)
    s = o["size"]
    return (s["w"] / 2, s["d"] / 2) if round(o["yaw"] / (np.pi / 2)) % 2 == 0 else (s["d"] / 2, s["w"] / 2)


def clamp(o):
    hx, hz = half(o)
    c = o["center"]
    c[0] = float(np.clip(c[0], -W + hx + GAP, W - hx - GAP)) if hx < W else 0.0
    c[2] = float(np.clip(c[2], -D + hz + GAP, D - hz - GAP)) if hz < D else 0.0


NO_FRONT = {"bin", "lamp", "chair", "rug", "plant", "stool", "table", "bed", "storage box", "basket", "fan", "trash can", "air conditioner", "curtain"}
for o in objs:
    o["yaw"] = yaw0 = round(o["yaw"] / (np.pi / 2)) * np.pi / 2
    clamp(o)
    hx, hz = half(o)
    c = o["center"]
    gaps = {"W": c[0] - hx + W, "E": W - c[0] - hx, "S": c[2] - hz + D, "N": D - c[2] - hz}
    near = min(gaps, key=gaps.get)
    snap = SNAP_TALL if o["size"]["h"] >= 1.0 else SNAP
    against = {k for k, g in gaps.items() if g < snap} | ({near} if o["label"] in WALL_MOUNTED else set())
    for k in against:
        if k == "W" and "E" not in against: c[0] = -W + hx + GAP
        if k == "E" and "W" not in against: c[0] = W - hx - GAP
        if k == "S" and "N" not in against: c[2] = -D + hz + GAP
        if k == "N" and "S" not in against: c[2] = D - hz - GAP
    # the front is the object's local +z, i.e. (sin yaw, cos yaw) in the room; turn it away from the wall
    fx, fz = round(np.sin(o["yaw"])), round(np.cos(o["yaw"]))
    facing = {(1, 0): "E", (-1, 0): "W", (0, 1): "N", (0, -1): "S"}[(fx, fz)]
    if facing in against:
        o["yaw"] += np.pi
    elif against and not o.get("parts") and o.get("has_front", o["label"] not in NO_FRONT):
        # front runs along the wall (a wardrobe with its doors to the side): face away from the wall with the
        # most open floor in front, keeping the footprint (w and d swap on a quarter turn). Only before the
        # parts are built: on built parts a quarter turn would need a rebuild (the builder handles those).
        away = {"W": "E", "E": "W", "S": "N", "N": "S"}
        back = max(against, key=lambda k: gaps[away[k]])
        if away[facing] not in against:
            o["yaw"] = {"E": 0.5, "N": 0.0, "W": -0.5, "S": 1.0}[away[back]] * np.pi
            s = o["size"]
            if round(abs(o["yaw"] - yaw0) / (np.pi / 2)) % 2:
                s["w"], s["d"] = s["d"], s["w"]

# push approximate pieces out of each other (measured ones stay put); flat things like rugs are exempt
def span(o):
    y0 = o["center"][1] - o["size"]["h"] / 2
    return y0, y0 + o["size"]["h"]

for _ in range(20):
    moved = False
    for a in objs:
        for b in objs:
            if a is b or a["source"] == "measured" or b["size"]["h"] <= 0.03 or a["size"]["h"] <= 0.03:
                continue
            (a0, a1), (b0, b1) = span(a), span(b)
            if a0 >= b1 - 0.02 or b0 >= a1 - 0.02:
                continue  # stacked, not side by side
            if b["source"] != "measured" and a["size"]["w"] * a["size"]["d"] > b["size"]["w"] * b["size"]["d"]:
                continue  # between two approximate pieces, the smaller one moves
            (ahx, ahz), (bhx, bhz) = half(a), half(b)
            dx = a["center"][0] - b["center"][0]
            dz = a["center"][2] - b["center"][2]
            px, pz = ahx + bhx - abs(dx), ahz + bhz - abs(dz)
            if px <= 0.005 or pz <= 0.005:
                continue
            # the shortest way out that stays inside the room (pushing into a wall would just bounce back)
            reach_x, reach_z = ahx + bhx + GAP, ahz + bhz + GAP
            options = [(0, b["center"][0] + s * reach_x) for s in (1, -1) if abs(b["center"][0] + s * reach_x) <= W - ahx] + \
                      [(2, b["center"][2] + s * reach_z) for s in (1, -1) if abs(b["center"][2] + s * reach_z) <= D - ahz]
            if not options:
                continue
            axis, v = min(options, key=lambda t: abs(t[1] - a["center"][t[0]]))
            a["center"][axis] = v
            moved = True
    if not moved:
        break

# Nothing floats: a raised object sits on the furniture under it, or (nothing under it) reaches down to the
# floor, because ARKit often misses the dark bottom of furniture. Lowest first, so supports settle first.
def overlaps_xz(a, b):
    (ahx, ahz), (bhx, bhz) = half(a), half(b)
    return abs(a["center"][0] - b["center"][0]) < ahx + bhx - 0.02 and abs(a["center"][2] - b["center"][2]) < ahz + bhz - 0.02

H = room["shell"]["height"]
for o in sorted(objs, key=lambda o: span(o)[0]):
    y0 = span(o)[0]
    if o["label"] in WALL_MOUNTED:  # hangs on its wall, just under the ceiling at most
        o["center"][1] = min(o["center"][1], H - 0.05 - o["size"]["h"] / 2)
        continue
    if y0 <= 0.03:
        continue
    tops = [span(b)[1] for b in objs if b is not o and b["label"] not in WALL_MOUNTED and span(b)[1] <= y0 + 0.05 and overlaps_xz(o, b)]
    if tops:
        o["center"][1] += max(tops) - y0
    else:
        f = (o["size"]["h"] + y0) / o["size"]["h"]
        for p in o.get("parts") or []:
            p["size"][1] *= f
            p["pos"][1] *= f
        o["size"]["h"] = round(o["size"]["h"] + y0, 3)
        o["center"][1] = o["size"]["h"] / 2

for o in objs:
    o["center"] = [round(float(v), 3) for v in o["center"]]
    o["yaw"] = round(float(o["yaw"]), 3)
path.write_text(json.dumps(room, indent=1))

overlaps = [(a["id"], b["id"]) for i, a in enumerate(objs) for b in objs[i + 1:]
            if a["size"]["h"] > 0.03 and b["size"]["h"] > 0.03
            and min(span(a)[1], span(b)[1]) - max(span(a)[0], span(b)[0]) > 0.02
            and half(a)[0] + half(b)[0] - abs(a["center"][0] - b["center"][0]) > 0.02
            and half(a)[1] + half(b)[1] - abs(a["center"][2] - b["center"][2]) > 0.02]
assert all(o["label"] in WALL_MOUNTED or span(o)[0] < 0.03 or any(abs(span(b)[1] - span(o)[0]) < 0.01 for b in objs) for o in objs), "something floats"
assert all(abs(o["yaw"] / (np.pi / 2) - round(o["yaw"] / (np.pi / 2))) < 1e-2 for o in objs)
print(f"layout: {len(objs)} objects squared to the walls; {len(overlaps)} overlaps left {overlaps}")
