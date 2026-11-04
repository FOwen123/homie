"""Photos for the Real view: every Nth video frame at full resolution, upright, with its camera pose in room
coordinates, so the website can show the real frame that looks where the user looks (always sharp, unlike the
splat away from the phone's path).

Usage: uv run --with numpy python pipeline/photos.py <capture_dir> <bundle_dir> [step=15]
Writes <bundle_dir>/photos/pNNNN.jpg and adds "photos" (same fields as "keyframes") to <bundle_dir>/room.json.
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np

cap, bundle = Path(sys.argv[1]), Path(sys.argv[2])
step = int(sys.argv[3]) if len(sys.argv) > 3 else 15
room = json.loads((bundle / "room.json").read_text())
W2R = np.array(room["world_to_room"])
frames = [json.loads(line) for line in open(cap / "frames.jsonl")]
M = lambda flat: np.array(flat, dtype=float).reshape(4, 4).T

out = bundle / "photos"
shutil.rmtree(out, ignore_errors=True)
out.mkdir()
subprocess.run(["ffmpeg", "-v", "error", "-y", "-noautorotate", "-i", str(cap / "video.mov"),
                "-vf", f"select='not(mod(n\\,{step}))',transpose=1", "-fps_mode", "passthrough", "-q:v", "4",
                str(out / "p%04d.jpg")], check=True)

photos = []
for f in sorted(out.glob("p*.jpg")):
    fr = frames[(int(f.stem[1:]) - 1) * step]
    if fr.get("tracking", "normal").lower() != "normal":  # poses from limited tracking can be off by tens of cm
        f.unlink()
        continue
    K = np.array(fr["intrinsics"]).reshape(3, 3).T
    sw, sh = fr["w"], fr["h"]  # sensor (landscape) size; the photo is that turned 90° clockwise
    photos.append({"file": f"photos/{f.name}", "cam_to_room": (W2R @ M(fr["transform"])).round(4).tolist(),
                   "fx": K[1, 1], "fy": K[0, 0], "cx": sh - 1 - K[1, 2], "cy": K[0, 2], "w": sh, "h": sw})

assert photos and all(p["w"] < p["h"] for p in photos), "expected upright photos"
room["photos"] = photos
(bundle / "room.json").write_text(json.dumps(room, indent=1))
size = sum(f.stat().st_size for f in out.glob("*.jpg")) / 1e6
print(f"photos: {len(photos)} frames at {photos[0]['w']}×{photos[0]['h']}, {size:.0f} MB")
