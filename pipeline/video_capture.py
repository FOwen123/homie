"""Turn a MapAnything reconstruction of a plain phone video into a capture folder (ios/RoomCapture format).

MapAnything (images only, metric scale) gives, per frame i: world points on every 2nd pixel of its processed
image (pts{i}), their confidence (conf{i}), validity (mask{i}), colours (rgb{i}) and the camera pose (pose{i},
cam→world, OpenCV axes). We fit a pinhole per frame, convert poses to ARKit axes, level the world (floor y=0,
up +y) and find the floor, walls and tables. The output is read unchanged by measure.py and room.py.

Usage: uv run -q --with numpy --with pillow python pipeline/video_capture.py <ma.npz> <sensor_frames_dir> <out_capture_dir>
  sensor_frames_dir holds f000.jpg, f001.jpg, ... in the npz's order (4:3 landscape, sensor orientation).
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

npz_path, frames_dir, out = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
SENSOR_W, SENSOR_H = 1920, 1440  # measure.py and room.py assume this sensor size (height 1440)
CONF_KEEP = 70                   # % of each frame's valid points kept, most confident first
PLANE_TOL = 0.02                 # m, floor inlier distance (= the 2 cm voxel)
WALL_TOL = 0.10                  # m, wall inlier distance: MapAnything's wall noise is 5–15 cm
VOXEL = 0.02
FEATURES = 800                   # points per frame in features.jsonl
D = np.diag([1.0, -1.0, -1.0, 1.0])  # OpenCV camera axes → ARKit camera axes
rng = np.random.default_rng(0)

Z = np.load(npz_path)
n = sum(k.startswith("pts") for k in Z.files)
names = [f"f{i:03d}.jpg" for i in range(n)]
missing = [x for x in names if not (frames_dir / x).exists()]
assert not missing, f"sensor frames missing: {missing[:3]}"
w0, h0 = Image.open(frames_dir / names[0]).size
assert abs(w0 / h0 - SENSOR_W / SENSOR_H) < 0.01, f"sensor frames must be 4:3 landscape, got {w0}x{h0}"


def valid_points(i):
    """Confident, valid world points of frame i with their grid pixel (processed-image index) and colour."""
    P, mask, conf = Z[f"pts{i}"].astype(float), Z[f"mask{i}"], Z[f"conf{i}"].astype(float)
    rows, cols = np.mgrid[0:P.shape[0], 0:P.shape[1]]
    keep = mask & (conf >= np.percentile(conf[mask], 100 - CONF_KEEP))
    return P[keep], 2.0 * cols[keep], 2.0 * rows[keep], Z[f"rgb{i}"][keep], P.shape[:2]


def voxel_first(P):
    _, first = np.unique(np.floor(P / VOXEL).astype(np.int64), axis=0, return_index=True)
    return P[first]


def fit(a, px):
    """px ≈ f·a + c, a = x/z or y/z. Least squares, then one pass without the outliers. Processed pixels."""
    A = np.c_[a, np.ones_like(a)]
    sol = np.linalg.lstsq(A, px, rcond=None)[0]
    r = np.abs(px - A @ sol)
    good = r < max(3 * np.median(r), 2.0)
    return np.linalg.lstsq(A[good], px[good], rcond=None)[0]


# --- pass 1: intrinsics per frame, poses, samples for features, fused cloud for planes --------------------
K, POSE, samples, fused, ups = [], [], [], [], []
for i in range(n):
    Pw, u, v, _, (h, w) = valid_points(i)
    T = Z[f"pose{i}"].astype(float)
    cam = (np.linalg.inv(T) @ np.c_[Pw, np.ones(len(Pw))].T)[:3]
    ok = cam[2] > 0.05
    fx, cx = fit(cam[0, ok] / cam[2, ok], u[ok])
    fy, cy = fit(cam[1, ok] / cam[2, ok], v[ok])
    sx, sy = SENSOR_W / (2 * w), SENSOR_H / (2 * h)  # the processed image is a plain resize of the sensor frame
    K.append(np.array([[fx * sx, 0, (cx + 0.5) * sx - 0.5], [0, fy * sy, (cy + 0.5) * sy - 0.5], [0, 0, 1]]))
    POSE.append(T)
    ups.append(T[:3, :3] @ np.array([-1.0, 0, 0]))  # the upright image's up is the camera's −x
    samples.append(Pw[rng.choice(len(Pw), min(FEATURES, len(Pw)), replace=False)])
    fused.append(voxel_first(Pw))
F = voxel_first(np.concatenate(fused))
up = np.mean(ups, 0)
up /= np.linalg.norm(up)


def convex_hull(p):
    """Monotone chain on the 2 cm voxel corners of 2D points (counter-clockwise)."""
    p = np.unique(np.floor(p / VOXEL).astype(np.int64), axis=0) * VOXEL
    if len(p) < 3:
        return p

    def half(seq):
        h = []
        for q in seq:
            while len(h) >= 2 and (h[-1][0] - h[-2][0]) * (q[1] - h[-2][1]) - (h[-1][1] - h[-2][1]) * (q[0] - h[-2][0]) <= 0:
                h.pop()
            h.append(q)
        return h

    lower, upper = half(p), half(p[::-1])
    return np.array(lower[:-1] + upper[:-1])


def outline(L):
    """Hull (x, z) of plane-local points (x, 0, z), without the outer 0.5% on each side."""
    xz = L[:, [0, 2]]
    lo, hi = np.percentile(xz, 0.5, axis=0), np.percentile(xz, 99.5, axis=0)
    return convex_hull(xz[np.all((xz >= lo) & (xz <= hi), axis=1)])


def area(poly):
    x, y = poly[:, 0], poly[:, 1]
    return 0.5 * abs(np.dot(x, np.roll(y, -1)) - np.dot(np.roll(x, -1), y))


def biggest_blob(xz, cell=0.05):
    """Mask of the points in the largest 8-connected cluster of 5 cm cells. A slab through the noisy room volume
    scatters over the whole room; a real surface (bed, desk top) is one connected patch."""
    cells, inv = np.unique(np.floor(xz / cell).astype(np.int64), axis=0, return_inverse=True)
    inv = inv.reshape(-1)
    index = {tuple(c): j for j, c in enumerate(cells)}
    label = np.full(len(cells), -1)
    best, best_size = -1, 0
    for s in range(len(cells)):
        if label[s] >= 0:
            continue
        label[s], stack, size = s, [s], 0
        while stack:
            c = stack.pop()
            size += 1
            for dx in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    j = index.get((cells[c][0] + dx, cells[c][1] + dz))
                    if j is not None and label[j] < 0:
                        label[j] = s
                        stack.append(j)
        if size > best_size:
            best, best_size = s, size
    return label[inv] == best


# --- gravity: the floor is the lowest large plane whose normal is near the mean up direction -------------
S = F if len(F) <= 200_000 else F[rng.choice(len(F), 200_000, replace=False)]
cands = []
for _ in range(800):
    a, b, c = S[rng.choice(len(S), 3, replace=False)]
    nrm = np.cross(b - a, c - a)
    if np.linalg.norm(nrm) < 1e-9:
        continue
    nrm = nrm / np.linalg.norm(nrm)
    if abs(nrm @ up) < np.cos(np.radians(25)):
        continue
    cands.append((np.count_nonzero(np.abs((S - a) @ nrm) < PLANE_TOL), nrm, a))
assert cands, "no plane close to the mean up direction: not a floor-level capture"
cands.sort(key=lambda c: -c[0])
pool = [c for c in cands if c[0] >= 0.3 * cands[0][0]][:40]
height = lambda c: np.median(S[np.abs((S - c[2]) @ c[1]) < PLANE_TOL] @ up)
_, nrm, a = min(pool, key=height)
inl = np.abs((S - a) @ nrm) < PLANE_TOL
nrm = np.linalg.svd(S[inl] - S[inl].mean(0), full_matrices=False)[2][-1]
if nrm @ up < 0:
    nrm = -nrm
inl = np.abs((F - S[inl].mean(0)) @ nrm) < PLANE_TOL
floor_pt = F[inl].mean(0)

# rotation R with R·nrm = +y, and a shift that puts the floor at y=0
e = np.eye(3)[np.argmin(np.abs(nrm))]
r0 = np.cross(nrm, e) / np.linalg.norm(np.cross(nrm, e))
R = np.array([r0, nrm, np.cross(r0, nrm)])
t = np.array([0.0, -(R @ floor_pt)[1], 0.0])
A = np.eye(4)
A[:3, :3], A[:3, 3] = R, t
F_al = F @ R.T + t
Pose_al = [A @ T for T in POSE]
cam_h = np.array([T[1, 3] for T in Pose_al])
print(f"floor: {inl.sum()} points, normal {np.degrees(np.arccos(abs(nrm @ up))):.1f}° from mean up; "
      f"cameras {np.median(cam_h):.2f} m above it")
assert np.median(cam_h) > 0.3, "floor found on the wrong side (cameras below it)"

# --- planes ---------------------------------------------------------------------------------------------
planes = []


def add_plane(alignment, cls, origin, xa, ya, za, local):
    hull = outline(local)
    T = np.eye(4)
    T[:3, 0], T[:3, 1], T[:3, 2], T[:3, 3] = xa, ya, za, origin
    planes.append({"id": f"p{len(planes)}", "alignment": alignment, "classification": cls,
                   "transform": T.T.reshape(-1).tolist(), "center": [0.0, 0.0, 0.0],
                   "extent": {"width": float(np.ptp(hull[:, 0])), "height": float(np.ptp(hull[:, 1])), "rotationOnYAxis": 0},
                   "boundary": [[float(x), 0.0, float(z)] for x, z in hull]})


def local_of(P, origin, xa, za):
    d = P - origin
    return np.c_[d @ xa, np.zeros(len(P)), d @ za]


ex, ey, ez = np.eye(3)
on_floor = F_al[np.abs(F_al[:, 1]) < PLANE_TOL]
o = on_floor.mean(0) * np.array([1, 0, 1])
add_plane("horizontal", "floor", o, ex, ey, ez, local_of(on_floor, o, ex, ez))

cams_xz = np.array([T[[0, 2], 3] for T in Pose_al]).mean(0)
rest = F_al[(F_al[:, 1] > 0.1) & (F_al[:, 1] < 2.6)]
for _ in range(8):  # walls: vertical planes at least 1 m long
    if len(rest) < 300:
        break
    S2 = rest if len(rest) <= 60000 else rest[rng.choice(len(rest), 60000, replace=False)]
    best = (0, None)
    for _ in range(1500):
        pa, pb = S2[rng.choice(len(S2), 2, replace=False)][:, [0, 2]]
        dv = pb - pa
        if np.linalg.norm(dv) < 0.05:
            continue
        nd = np.array([-dv[1], dv[0]]) / np.linalg.norm(dv)
        cnt = np.count_nonzero(np.abs((S2[:, [0, 2]] - pa) @ nd) < WALL_TOL)
        if cnt > best[0]:
            best = (cnt, (pa, nd))
    if best[1] is None:
        break
    pa, nd = best[1]
    xz = rest[np.abs((rest[:, [0, 2]] - pa) @ nd) < WALL_TOL][:, [0, 2]]
    mean = xz.mean(0)
    dv = np.linalg.svd(xz - mean, full_matrices=False)[2][0]
    nd = np.array([-dv[1], dv[0]])
    if (cams_xz - mean) @ nd < 0:
        nd = -nd  # the normal points into the room
    inl = np.abs((rest[:, [0, 2]] - mean) @ nd) < WALL_TOL
    if inl.sum() < 200 or np.ptp((rest[inl][:, [0, 2]] - mean) @ dv) < 1.0:
        break
    yl = np.array([nd[0], 0.0, nd[1]])
    zl = np.array([0.0, 1.0, 0.0])
    xl = np.cross(yl, zl)  # x × y = z keeps the frame right-handed
    origin = np.array([mean[0], 0.0, mean[1]])
    add_plane("vertical", "wall", origin, xl, yl, zl, local_of(rest[inl], origin, xl, zl))
    rest = rest[~inl]

for _ in range(6):  # other flat surfaces (bed, desk tops) of at least 0.15 m²
    band = np.flatnonzero((rest[:, 1] > 0.15) & (rest[:, 1] < 2.2))
    cand = rest[band]
    if len(cand) < 300:
        break
    S2 = cand if len(cand) <= 60000 else cand[rng.choice(len(cand), 60000, replace=False)]
    best = (0, None)
    for _ in range(800):
        pa, pb, pc = S2[rng.choice(len(S2), 3, replace=False)]
        nh = np.cross(pb - pa, pc - pa)
        if np.linalg.norm(nh) < 1e-9 or abs(nh[1]) / np.linalg.norm(nh) < np.cos(np.radians(15)):
            continue
        nh = nh / np.linalg.norm(nh)
        cnt = np.count_nonzero(np.abs((S2 - pa) @ nh) < PLANE_TOL)
        if cnt > best[0]:
            best = (cnt, (pa, nh))
    if best[1] is None:
        break
    pa, nh = best[1]
    inl = np.abs((cand - pa) @ nh) < PLANE_TOL
    nh = np.linalg.svd(cand[inl] - cand[inl].mean(0), full_matrices=False)[2][-1]
    nh = nh if nh[1] > 0 else -nh
    inl = np.abs((cand - cand[inl].mean(0)) @ nh) < PLANE_TOL
    patch = biggest_blob(cand[inl][:, [0, 2]])
    pts = cand[inl][patch]  # the connected patch is the surface; the rest of the slab is noise
    if len(pts) < 300:
        break
    origin = pts.mean(0)
    xl = np.linalg.svd(pts - origin, full_matrices=False)[2][0]
    zl = np.cross(xl, nh)
    local = local_of(pts, origin, xl, zl)
    if area(outline(local)) < 0.15:
        break
    add_plane("horizontal", "none", origin, xl, nh, zl, local)
    rest = np.delete(rest, band[inl][patch], axis=0)

# --- pass 2: write the capture ---------------------------------------------------------------------------
out.mkdir(parents=True, exist_ok=True)
frames_rec = []
for i in range(n):
    frames_rec.append({"i": i, "t": float(i), "w": SENSOR_W, "h": SENSOR_H,
                       "intrinsics": K[i].T.reshape(-1).tolist(), "transform": (Pose_al[i] @ D).T.reshape(-1).tolist(),
                       "tracking": "Normal"})
(out / "frames.jsonl").write_text("".join(json.dumps(f) + "\n" for f in frames_rec))
feats = [{"i": i, "points": np.round(samples[i] @ R.T + t, 4).tolist()} for i in range(n)]
(out / "features.jsonl").write_text("".join(json.dumps(f) + "\n" for f in feats))
(out / "planes.json").write_text(json.dumps(planes, indent=1))
(out / "meta.json").write_text(json.dumps({"source": "mapanything", "keyframe_every": 1, "frames": n,
                                           "coordinates": "ARKit world: metres, y up, floor at y=0, MapAnything metric scale",
                                           "seconds": float(n)}, indent=1))
subprocess.run(["ffmpeg", "-v", "error", "-y", "-noautorotate", "-framerate", "1", "-start_number", "0",
                "-i", str(frames_dir / "f%03d.jpg"), "-vf", f"scale={SENSOR_W}:{SENSOR_H}", "-c:v", "libx264",
                "-pix_fmt", "yuv420p", "-r", "1", "-an", str(out / "video.mov")], check=True)

# --- self-check on one frame: frames.jsonl (as written) must put each grid point on its sensor pixel,
#     and the colour there must match MapAnything's own colour for that point -----------------------------
i = n // 2
Pw, u_idx, v_idx, rgb, (h, w) = valid_points(i)
sel = rng.choice(len(Pw), min(2000, len(Pw)), replace=False)
Pw, u_idx, v_idx, rgb = Pw[sel], u_idx[sel], v_idx[sel], rgb[sel]
rec = frames_rec[i]
Kx = np.array(rec["intrinsics"]).reshape(3, 3).T
Tx = np.array(rec["transform"]).reshape(4, 4).T
cc = (np.linalg.inv(Tx) @ np.c_[Pw @ R.T + t, np.ones(len(Pw))].T)[:3]
zc = -cc[2]
u = Kx[0, 0] * cc[0] / zc + Kx[0, 2]
v = -Kx[1, 1] * cc[1] / zc + Kx[1, 2]
ue = (u_idx + 0.5) * SENSOR_W / (2 * w) - 0.5
ve = (v_idx + 0.5) * SENSOR_H / (2 * h) - 0.5
geo_err = np.median(np.hypot(u - ue, v - ve))
ok = (zc > 0) & (u >= 0) & (u < SENSOR_W) & (v >= 0) & (v < SENSOR_H)
img = np.asarray(Image.open(frames_dir / names[i]).convert("RGB").resize((SENSOR_W, SENSOR_H), Image.BILINEAR)).astype(float)
col = img[np.clip(np.round(v[ok]), 0, SENSOR_H - 1).astype(int), np.clip(np.round(u[ok]), 0, SENSOR_W - 1).astype(int)]
col_err = np.abs(col - rgb[ok]).mean()
shuffled = np.abs(col - rgb[ok][rng.permutation(ok.sum())]).mean()
print(f"self-check frame {i}: median pixel error {geo_err:.2f} px (sensor), colour error {col_err:.1f} "
      f"(shuffled {shuffled:.1f}), {ok.mean():.0%} in front of and inside the frame")
assert geo_err < 12.0, "projection through frames.jsonl misses the grid pixels"  # fit residual ≈ 3 processed px; axis bugs miss by 100s
assert col_err < 0.5 * shuffled, "sensor frame colours do not match MapAnything's colours"
print(f"{n} frames, {len(planes)} planes "
      f"({', '.join(p['classification'] for p in planes)}) → {out}")
