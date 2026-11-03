"""Turn a Room Capture recording into a Nerfstudio dataset for splat training, using ARKit poses
(no COLMAP needed). ARKit's camera axes (x right, y up, looking down -z) match Nerfstudio's.

Usage: uv run --with numpy python pipeline/splat_dataset.py <capture_dir> <out_dir> [every_nth_frame] [width]
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

cap, out = Path(sys.argv[1]), Path(sys.argv[2])
step = int(sys.argv[3]) if len(sys.argv) > 3 else 10   # every 10th frame also has ARKit feature points
width = int(sys.argv[4]) if len(sys.argv) > 4 else 960
frames = [json.loads(l) for l in open(cap / "frames.jsonl")]
(out / "images").mkdir(parents=True, exist_ok=True)

subprocess.run(["ffmpeg", "-v", "error", "-y", "-noautorotate", "-i", str(cap / "video.mov"),
                "-vf", f"select='not(mod(n\\,{step}))',scale={width}:-1", "-fps_mode", "passthrough",
                "-q:v", "2", str(out / "images" / "f%05d.jpg")], check=True)
s = width / frames[0]["w"]
K = np.array(frames[0]["intrinsics"]).reshape(3, 3).T
records = []
for k, f in enumerate(frames[::step]):
    if f["tracking"] != "Normal":
        continue
    records.append({"file_path": f"images/f{k + 1:05d}.jpg",
                    "transform_matrix": np.array(f["transform"]).reshape(4, 4).T.tolist()})

# Seed the splat with ARKit's tracked 3D points (much better than random initialisation).
pts = np.concatenate([np.array(json.loads(l)["points"]) for l in open(cap / "features.jsonl")])
with open(out / "points3D.ply", "w") as fh:
    fh.write(f"ply\nformat ascii 1.0\nelement vertex {len(pts)}\nproperty float x\nproperty float y\nproperty float z\n"
             "property uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n")
    fh.writelines(f"{x:.4f} {y:.4f} {z:.4f} 128 128 128\n" for x, y, z in pts)

json.dump({"camera_model": "OPENCV", "fl_x": K[0, 0] * s, "fl_y": K[1, 1] * s, "cx": K[0, 2] * s, "cy": K[1, 2] * s,
           "w": round(frames[0]["w"] * s), "h": round(frames[0]["h"] * s),
           "k1": 0, "k2": 0, "p1": 0, "p2": 0, "ply_file_path": "points3D.ply", "frames": records},
          open(out / "transforms.json", "w"), indent=1)
n_img = len(list((out / "images").glob("*.jpg")))
assert n_img >= len(records), f"{n_img} images for {len(records)} frames"
print(f"{len(records)} frames, {len(pts)} seed points → {out}")
