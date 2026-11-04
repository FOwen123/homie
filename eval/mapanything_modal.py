"""MapAnything (Meta, Apache 2.0 checkpoint) on a Modal GPU: dense metric 3D points for a room bundle.

Sends the room's keyframes with their ARKit poses and intrinsics and saves a subsampled point cloud per
keyframe to eval/out/mapanything_<room>.npz. The output frame is MapAnything's (first camera at the origin);
mapanything_measure.py fits it back onto the ARKit cameras.
Images only: given our intrinsics and poses as well, MapAnything predicted a focal length ~0.77× ours and depths
that disagree with the poses (floor 1 m off). From images alone it stays self-consistent; mapanything_measure.py
then fits its cameras onto the ARKit ones for metric scale and room coordinates. Keyframes go in landscape, the
phone sensor's own orientation.

Usage (from the repo root; Modal tokens come from .env):
  set -a; . ./.env; set +a
  uv run --with modal --with numpy --with pillow modal run eval/mapanything_modal.py --room web/public/rooms/demo

Cost: one A100-80GB for a few minutes (about US$2.50/hour, per second); the function times out after 15 minutes.
"""
import io
import json
from pathlib import Path

import modal

app = modal.App("roomie-mapanything")
image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git", "libgl1", "libglib2.0-0")
    .pip_install("torch==2.7.1", "torchvision==0.22.1", "numpy<2.3", "pillow")
    .run_commands("pip install 'git+https://github.com/facebookresearch/map-anything.git'")
)
hf_cache = modal.Volume.from_name("roomie-hf-cache", create_if_missing=True)
STEP = 2  # keep every 2nd pixel of the model's output grid


@app.function(image=image, gpu="A100-80GB", timeout=900, volumes={"/root/.cache/huggingface": hf_cache})
def reconstruct(jpegs: list[bytes], intrinsics: list, poses: list, model_name: str, use_inputs: bool) -> bytes:
    import numpy as np
    import torch
    from PIL import Image
    from mapanything.models import MapAnything
    from mapanything.utils.image import preprocess_inputs

    model = MapAnything.from_pretrained(model_name).to("cuda")
    views = [{
        "img": torch.from_numpy(np.array(Image.open(io.BytesIO(b)).convert("RGB"))),
        "intrinsics": torch.tensor(K, dtype=torch.float32),
        "camera_poses": torch.tensor(T, dtype=torch.float32),
        "is_metric_scale": torch.tensor([True]),
    } for b, K, T in zip(jpegs, intrinsics, poses)]
    processed = preprocess_inputs(views)
    preds = model.infer(processed, memory_efficient_inference=True, use_amp=True, amp_dtype="bf16",
                        apply_mask=True, mask_edges=True, apply_confidence_mask=False,
                        ignore_calibration_inputs=not use_inputs, ignore_pose_inputs=not use_inputs)
    print("view 0 image", tuple(processed[0]["img"].shape), "K in", processed[0]["intrinsics"][0].tolist(), "K out", preds[0]["intrinsics"][0].tolist())
    hf_cache.commit()
    out = {}
    for i, p in enumerate(preds):
        out[f"pts{i}"] = p["pts3d"][0, ::STEP, ::STEP].float().cpu().numpy().astype(np.float16)
        out[f"conf{i}"] = p["conf"][0, ::STEP, ::STEP].float().cpu().numpy().astype(np.float16)
        out[f"mask{i}"] = p["mask"][0, ::STEP, ::STEP, 0].cpu().numpy().astype(bool)
        out[f"rgb{i}"] = (p["img_no_norm"][0, ::STEP, ::STEP].float().cpu().numpy() * 255).clip(0, 255).astype(np.uint8)
        out[f"pose{i}"] = p["camera_poses"][0].float().cpu().numpy()
    buf = io.BytesIO()
    np.savez_compressed(buf, **out)
    return buf.getvalue()


# Landscape (sensor) camera in ARKit camera axes: image right = +X, image down = -Y, forward = -Z.
ARKIT_TO_OPENCV = [[1, 0, 0, 0], [0, -1, 0, 0], [0, 0, -1, 0], [0, 0, 0, 1]]


@app.local_entrypoint()
def main(room: str = "web/public/rooms/demo", model: str = "facebook/map-anything-apache", use_inputs: bool = False):
    import numpy as np

    bundle = Path(room)
    r = json.loads((bundle / "room.json").read_text())
    from PIL import Image

    jpegs, Ks, Ts = [], [], []
    for k in r["keyframes"]:
        # upright keyframe (sensor turned 90° clockwise) back to landscape: upright (x, y) -> landscape (y, W-1-x)
        img = Image.open(bundle / k["file"]).transpose(Image.Transpose.ROTATE_90)
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=92)
        jpegs.append(buf.getvalue())
        Ks.append([[k["fy"], 0, k["cy"]], [0, k["fx"], k["w"] - 1 - k["cx"]], [0, 0, 1]])
        Ts.append((np.array(k["cam_to_room"]) @ np.array(ARKIT_TO_OPENCV)).tolist())

    # Self-check: a point seen at upright pixel (x, y) must land at landscape pixel (y, W-1-x).
    k, K, T = r["keyframes"][0], np.array(Ks[0]), np.array(Ts[0])
    Xc, Yc, Zc = 0.2, -0.1, -1.5  # 1.5 m in front of the camera, in ARKit camera axes
    x, y = k["fx"] * Yc / -Zc + k["cx"], k["fy"] * Xc / -Zc + k["cy"]  # room.py's upright projection
    c = np.linalg.inv(T) @ np.array(k["cam_to_room"]) @ np.array([Xc, Yc, Zc, 1.0])
    assert c[2] > 0 and np.allclose((K @ (c[:3] / c[2]))[:2], [y, k["w"] - 1 - x]), "landscape pose or intrinsics are wrong"

    print(f"sending {len(jpegs)} keyframes to Modal…")
    data = reconstruct.remote(jpegs, Ks, Ts, model, use_inputs)
    out = Path("eval/out") / f"mapanything_{bundle.name}.npz"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(data)
    print(f"saved {out} ({len(data) / 1e6:.1f} MB)")
