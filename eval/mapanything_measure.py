"""Measure furniture from MapAnything points (eval/mapanything_modal.py) and compare with the tape and with
today's room.json. MapAnything's cameras are fitted onto the ARKit ones (scale, rotation, offset), which puts its
points in room coordinates and in meters. Each output pixel is mapped back to its upright keyframe pixel and kept
for an object if it falls inside that object's SAM mask.

Usage: uv run --with numpy --with pillow python eval/mapanything_measure.py <bundle_dir> <seg_dir> <mapanything.npz>
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

bundle, seg, npz = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
room = json.loads((bundle / "room.json").read_text())
d = np.load(npz)
kfs = room["keyframes"]
STEP = 2  # mapanything_modal.py keeps every 2nd pixel

# similarity (Umeyama) from MapAnything's camera centres to ARKit's
A = np.array([d[f"pose{i}"][:3, 3] for i in range(len(kfs))])
B = np.array([np.array(k["cam_to_room"])[:3, 3] for k in kfs])
ma, mb = A.mean(0), B.mean(0)
U, S, Vt = np.linalg.svd((A - ma).T @ (B - mb))
D = np.diag([1, 1, np.sign(np.linalg.det(Vt.T @ U.T))])
R = Vt.T @ D @ U.T
s = (S * np.diag(D)).sum() / ((A - ma) ** 2).sum()
t = mb - s * R @ ma
res = np.linalg.norm((s * (R @ A.T)).T + t - B, axis=1)
print(f"fit to ARKit cameras: scale {s:.3f}, camera centres within {np.median(res) * 100:.1f} cm (median), {res.max() * 100:.1f} cm (max)")


def upright_pixels(i):
    """Model output grid → upright keyframe pixel (x, y). Landscape keyframes were resized to cover the model's
    resolution and centre-cropped; the upright image is the landscape one turned 90° clockwise."""
    k, (h, w) = kfs[i], d[f"mask{i}"].shape
    W, H = k["h"], k["w"]                       # landscape size
    mw, mh = w * STEP, h * STEP                 # model resolution
    sc = max(mw / W, mh / H)
    gy, gx = np.mgrid[0:h, 0:w] * STEP
    u = (gx + (W * sc - mw) / 2) / sc
    v = (gy + (H * sc - mh) / 2) / sc
    return (k["w"] - 1 - v), u                   # upright x, y


# self-check the pixel mapping: the model's (denormalised) colours must match the keyframe at the mapped pixels
x, y = upright_pixels(0)
img = np.asarray(Image.open(bundle / kfs[0]["file"]).convert("L"), np.float32)
ours = img[np.clip(y, 0, img.shape[0] - 1).astype(int), np.clip(x, 0, img.shape[1] - 1).astype(int)]
theirs = d["rgb0"].astype(np.float32).mean(-1)
corr = np.corrcoef(ours.ravel(), theirs.ravel())[0, 1]
print(f"pixel mapping check: colour correlation {corr:.2f}")
assert corr > 0.8, "output pixels do not map back onto the keyframe"

by_label: dict[str, list] = {}
heights = []
for i, k in enumerate(kfs):
    conf = d[f"conf{i}"].astype(np.float32)
    m = d[f"mask{i}"] & (conf > np.percentile(conf, 30))
    pts = (s * (R @ d[f"pts{i}"][m].astype(np.float32).T)).T + t
    heights.append(pts[:, 1])
    x, y = upright_pixels(i)
    x, y = x[m].astype(int), y[m].astype(int)
    meta = json.loads((seg / f"{Path(k['file']).stem}.json").read_text())
    for o in meta["objects"]:
        mk, b = o["mask"], o["mask"]["bounds"]
        raster = np.fromfile(seg / f"{Path(k['file']).stem}_{o['id']}.mask", np.uint8).reshape(mk["height"], mk["width"])
        # the raster can be smaller than its bounds: scale pixel offsets into it
        ry = ((y - b["top"]) * mk["height"] / max(b["bottom"] - b["top"], 1)).astype(int)
        rx = ((x - b["left"]) * mk["width"] / max(b["right"] - b["left"], 1)).astype(int)
        inb = (rx >= 0) & (rx < mk["width"]) & (ry >= 0) & (ry < mk["height"])
        hit = np.zeros(len(pts), bool)
        hit[inb] = raster[ry[inb], rx[inb]] > 0
        if hit.sum() > 20:
            by_label.setdefault(o["label"], []).append(pts[hit])

hy = np.concatenate(heights)
low = hy[hy < np.percentile(hy, 8)]
print(f"floor (lowest 8% of points): {np.median(low) * 100:+.1f} cm ±{low.std() * 100:.1f} (ARKit floor is 0)")
fl = np.concatenate(by_label.get("floor", [np.zeros((1, 3))]))[:, 1]
print(f"floor (SAM floor mask): {np.median(fl) * 100:+.1f} cm ±{fl.std() * 100:.1f}")

TAPE = {"bed": "188 × 100", "desk": "100 × 60 × 70"}
print(f"\n{'object':14s} {'MapAnything W×D×H cm':>22s}   {'today (room.json)':>26s}   tape")
for o in room["objects"]:
    lab = o["label"]
    chunks = by_label.get(lab, []) + (by_label.get("table", []) if lab == "desk" else [])
    if not chunks:
        continue
    pts = np.concatenate(chunks)
    near = pts[np.linalg.norm(pts[:, [0, 2]] - np.array(o["center"])[[0, 2]], axis=1) < max(o["size"]["w"], o["size"]["d"]) / 2 + 0.4]
    if len(near) < 200:
        continue
    lo, hi = np.percentile(near, 3, axis=0), np.percentile(near, 97, axis=0)
    ext = hi - lo  # room axes: layout.py squared every object to them
    w, dd = (ext[0], ext[2]) if round(o["yaw"] / (np.pi / 2)) % 2 == 0 else (ext[2], ext[0])
    sz = o["size"]
    print(f"{lab:14s} {w * 100:6.0f} × {dd * 100:4.0f} × {hi[1] * 100:4.0f}      {sz['w'] * 100:5.0f} × {sz['d'] * 100:4.0f} × {sz['h'] * 100:4.0f} {o['source']:8s}"
          f"  {TAPE.get(lab, '')}   ({len(near):,} pts)")
if by_label.get("door"):
    p = np.concatenate(by_label["door"])
    lo, hi = np.percentile(p, 3, axis=0), np.percentile(p, 97, axis=0)
    print(f"{'door':14s} width {max(hi[0] - lo[0], hi[2] - lo[2]) * 100:.0f}, top {hi[1] * 100:.0f} cm          today 80 wide          80 wide   ({len(p):,} pts)")
