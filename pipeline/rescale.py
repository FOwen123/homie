"""Real-world scale for a room built from a plain video (MapAnything's own scale ran ~10% large on the demo).

Each known-size object suggests a factor = typical size / our size: a door's height (2.05 m), a bed's long side
(1.88 m, a Taiwan single), a desk's height (0.74 m). The median wins, so one odd object can't skew it; with none
the room keeps MapAnything's scale. Everything is scaled together, and every size becomes approx.

Usage: uv run --with numpy python pipeline/rescale.py <bundle_dir>   (rewrites <bundle_dir>/room.json)
"""
import json
import sys
from pathlib import Path

import numpy as np

path = Path(sys.argv[1]) / "room.json"
room = json.loads(path.read_text())
sh = room["shell"]

refs = [("door height", 2.05 / (o["top"] - o["bottom"])) for w in sh["walls"] for o in w["openings"] if o["type"] == "door" and o["top"] > o["bottom"]]
refs += [("bed length", 1.88 / max(o["size"]["w"], o["size"]["d"])) for o in room["objects"] if o["label"] == "bed"]
refs += [("desk height", 0.74 / o["size"]["h"]) for o in room["objects"] if o["label"] == "desk" and o["size"]["h"] > 0.3]
refs = [(n, r) for n, r in refs if 0.7 <= r <= 1.3]  # a "door" twice too short is a mislabel, not a scale
f = float(np.median([r for _, r in refs])) if refs else 1.0

sh["width"], sh["depth"], sh["height"] = sh["width"] * f, sh["depth"] * f, sh["height"] * f
for w in sh["walls"]:
    w["a"], w["b"] = [v * f for v in w["a"]], [v * f for v in w["b"]]
    for o in w["openings"]:
        for k in ("from", "to", "bottom", "top"):
            o[k] *= f
for o in room["objects"]:
    o["center"] = [v * f for v in o["center"]]
    o["size"] = {k: v * f for k, v in o["size"].items()}
    for p in o.get("parts") or []:
        p["size"], p["pos"] = [v * f for v in p["size"]], [v * f for v in p["pos"]]
    o["source"] = "approx"  # nothing from a plain video is measured
    o["pm_cm"] = max(o.get("pm_cm", 0) * f, 8 * max(o["size"].values()))  # at least ±8% of the longest side
for k in room["keyframes"]:
    for r in range(3):
        k["cam_to_room"][r][3] *= f
room["capture"] = "video"
room["scale"] = {"factor": round(f, 4), "refs": [[n, round(r, 4)] for n, r in refs]}
path.write_text(json.dumps(room, indent=1))

assert 0.7 <= f <= 1.3
print(f"rescale: ×{f:.3f} from {', '.join(f'{n} ×{r:.3f}' for n, r in refs) or 'no known-size objects (kept as is)'}")
