"""ARKit-only 3D view of a Room Capture recording: feature points (coloured from the video),
detected planes and the camera path, written as one self-contained HTML file.

Usage: uv run --with numpy --with pillow python eval/arkit_view.py <capture_dir> <out.html> [max_points] [objects.json]
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

cap, out = Path(sys.argv[1]), Path(sys.argv[2])
M = lambda flat: np.array(flat, dtype=float).reshape(4, 4).T  # ARKit stores column-major
frames = [json.loads(l) for l in open(cap / "frames.jsonl")]
snaps = [json.loads(l) for l in open(cap / "features.jsonl")]
planes = json.load(open(cap / "planes.json"))

# Colour each feature point from the frame it was observed in.
with tempfile.TemporaryDirectory() as tmp:
    # The recorder saves feature points on every 10th video frame.
    subprocess.run(["ffmpeg", "-v", "error", "-noautorotate", "-i", str(cap / "video.mov"),
                    "-vf", "select='not(mod(n\\,10))'", "-fps_mode", "passthrough", f"{tmp}/f%04d.png"], check=True)
    pts, cols = [], []
    for s in snaps:
        img = np.asarray(Image.open(f"{tmp}/f{s['i'] // 10 + 1:04d}.png").convert("RGB"))
        f = frames[s["i"]]
        K = np.array(f["intrinsics"]).reshape(3, 3).T
        world_to_cam = np.linalg.inv(M(f["transform"]))
        P = np.array(s["points"], dtype=float)
        c = (world_to_cam @ np.c_[P, np.ones(len(P))].T)[:3]
        z = -c[2]  # ARKit camera looks down -z; y is up, image v is down
        ok = z > 0.05
        u = K[0, 0] * c[0] / np.where(ok, z, 1) + K[0, 2]
        v = -K[1, 1] * c[1] / np.where(ok, z, 1) + K[1, 2]
        ok &= (u >= 0) & (u < img.shape[1]) & (v >= 0) & (v < img.shape[0])
        pts.append(P[ok])
        cols.append(img[v[ok].astype(int), u[ok].astype(int)])
    pts, cols = np.concatenate(pts), np.concatenate(cols)

# Self-check: ARKit's per-frame points include recently tracked ones already out of view (~half on
# the test capture), but broken projection maths would leave almost none inside the frame.
assert len(pts) > 0.3 * sum(len(s["points"]) for s in snaps), "too few points fell inside their frame"

# ARKit can report several floor planes at slightly different heights; trust the largest.
floor = max((p for p in planes if p["classification"] == "floor"), key=lambda p: p["extent"]["width"] * p["extent"]["height"])
floor_y = M(floor["transform"])[1, 3]
plane_polys = []
for p in planes:
    T = M(p["transform"])
    b = np.array(p["boundary"], dtype=float)
    poly = (T @ np.c_[b, np.ones(len(b))].T)[:3].T
    plane_polys.append({"cls": p["classification"], "align": p["alignment"],
                        "label": f'{p["classification"]} {p["extent"]["width"]*100:.0f}×{p["extent"]["height"]*100:.0f} cm',
                        "pts": np.round(poly, 2).tolist()})
path = [np.round(M(f["transform"])[:3, 3], 2).tolist() for f in frames[::30]]

# Compact encoding (integer cm, one hex colour string) keeps the page small enough to embed inline.
keep = np.random.default_rng(0).permutation(len(pts))[: int(sys.argv[3]) if len(sys.argv) > 3 else len(pts)]
data = {"pts": np.round(pts[keep] * 100).astype(int).ravel().tolist(),
        "cols": "".join("%02x%02x%02x" % tuple(c) for c in cols[keep]), "planes": plane_polys,
        "path": path, "floorY": floor_y, "boxes": []}
# Optional 4th argument: objects.json from objects3d.py, drawn as labeled boxes.
if len(sys.argv) > 4:
    for o in json.load(open(sys.argv[4]))["objects"]:
        if not o["trusted"] or o["area_m2"] < 0.03:
            continue
        dims = (f'{o["length_cm"]:.0f}×{o["width_cm"]:.0f} cm, {o["height_cm"]:.0f} high' if o["alignment"] == "horizontal"
                else f'{o["width_cm"]:.0f}×{o["tall_cm"]:.0f} cm')
        data["boxes"].append({"label": f'{o["label"]} {dims}' + (" · check?" if o.get("needs_check") else ""), "c": o["corners"]})
html = (Path(__file__).parent / "arkit_view_template.html").read_text().replace("__DATA__", json.dumps(data))
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(html)
print(f"{len(keep)} of {len(pts)} coloured points, {len(plane_polys)} planes → {out} ({out.stat().st_size/1e6:.1f} MB)")
