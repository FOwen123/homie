"""Shrink a trained 3D Gaussian Splatting .ply into the compact 32-byte-per-splat ".splat" format
(position, scale, RGBA, rotation) that browser viewers such as Spark load, keeping the most visible
splats. Drops view-dependent colour (SH bands); fine for a room viewer.

Usage: uv run --with numpy python pipeline/splat_pack.py <in.ply> <out.splat> [max_splats]
"""
import sys

import numpy as np

src, dst = sys.argv[1], sys.argv[2]
keep_n = int(sys.argv[3]) if len(sys.argv) > 3 else 450_000  # ~14 MB, under Cloudflare Pages' 25 MB file limit

with open(src, "rb") as f:
    header = b""
    while not header.endswith(b"end_header\n"):
        header += f.readline()
    lines = header.decode().splitlines()
    n = int(next(l for l in lines if l.startswith("element vertex")).split()[2])
    names = [l.split()[2] for l in lines if l.startswith("property float")]
    assert all(l.split()[1] == "float" for l in lines if l.startswith("property")), "expected all-float properties"
    data = np.fromfile(f, dtype=np.float32, count=n * len(names)).reshape(n, len(names))
col = {k: data[:, i] for i, k in enumerate(names)}

pos = np.c_[col["x"], col["y"], col["z"]]
scale = np.exp(np.c_[col["scale_0"], col["scale_1"], col["scale_2"]])
alpha = 1 / (1 + np.exp(-col["opacity"]))
rgb = np.clip(0.5 + 0.28209479 * np.c_[col["f_dc_0"], col["f_dc_1"], col["f_dc_2"]], 0, 1)
rot = np.c_[col["rot_0"], col["rot_1"], col["rot_2"], col["rot_3"]]  # w, x, y, z
rot /= np.linalg.norm(rot, axis=1, keepdims=True)

# Keep the splats that contribute most: opaque and not microscopic. Big faint "floaters" rank low.
importance = alpha * np.cbrt(scale.prod(1))
order = np.argsort(-importance)
order = order[alpha[order] > 0.05][:keep_n]

out = np.zeros(len(order), dtype=[("p", "<f4", 3), ("s", "<f4", 3), ("c", "u1", 4), ("r", "u1", 4)])
out["p"] = pos[order]
out["s"] = scale[order]
out["c"] = np.c_[rgb[order] * 255, alpha[order] * 255].round().clip(0, 255)
out["r"] = (rot[order] * 128 + 128).round().clip(0, 255)
out.tofile(dst)
assert out.nbytes == len(order) * 32
print(f"{n:,} → {len(order):,} splats, {out.nbytes / 1e6:.1f} MB → {dst}")
