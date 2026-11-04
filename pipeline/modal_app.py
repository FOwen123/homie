"""Homie room processing on Modal: takes uploads, builds rooms, serves them to the website.

- POST /upload        iPhone app capture (video.mov, frames.jsonl, features.jsonl, planes.json, meta.json),
                      forwarded by the Pages Function /api/upload with the shared token.
- POST /upload-video  from the browser: ~60 upright stills of a plain phone video ("frames", the usual way) or the
                      video itself ("video"), with a short-lived single-use ticket signed by the Pages Function
                      /api/upload-ticket (HMAC of its expiry with the shared token).
- GET  /status/<id>   {state, stage, detail, error} for the loading screen (token).
- GET  /rooms/<id>/…  room.json, keyframes, crops (token; the Pages Function /rooms/* proxies here).

A plain video first goes through MapAnything on a GPU (frames → 3D points and cameras), then
pipeline/video_capture.py turns that into the capture format, so pipeline/process.ts runs unchanged.
Raw uploads are deleted once a room is built; rooms (with their keyframes and crops) are deleted after 30 days.

Deploy (from the repo root; Modal tokens and the secret come from .env):
  set -a; . ./.env; set +a
  uv run --with modal modal deploy pipeline/modal_app.py
The secret "homie" must hold META_MODEL_API_KEY and ROOMIE_UPLOAD_TOKEN.
"""
import hashlib
import hmac
import io
import json
import os
import re
import shutil
import subprocess
import time
from pathlib import Path

import modal

ROOT = Path(__file__).parent.parent
app = modal.App("homie")
data = modal.Volume.from_name("homie-rooms", create_if_missing=True)
status = modal.Dict.from_name("homie-status", create_if_missing=True)
secret = modal.Secret.from_name("homie")
hf_cache = modal.Volume.from_name("roomie-hf-cache", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg", "curl", "unzip")
    .pip_install("uv", "fastapi[standard]", "python-multipart")
    .run_commands("curl -fsSL https://bun.sh/install | bash")
    .env({"PATH": "/root/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"})
    .run_commands("uv run -q --with numpy --with pillow python -c 'import numpy, PIL'")  # warm uv's cache
    .add_local_dir(ROOT / "pipeline", "/app/pipeline", copy=True,
                   ignore=["node_modules", "uploads", "catalog", "spend.jsonl", "__pycache__", "modal_app.py"])
    .run_commands("cd /app/pipeline && bun install")
)
gpu_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git", "libgl1", "libglib2.0-0")
    .pip_install("torch==2.7.1", "torchvision==0.22.1", "numpy<2.3", "pillow")
    .run_commands("pip install 'git+https://github.com/facebookresearch/map-anything.git'")
)

FILES = ["video.mov", "frames.jsonl", "features.jsonl", "planes.json", "meta.json"]
MAX_VIDEO = 300 * 1024 * 1024
DAILY_MAX = 20
MAX_FRAMES = 60
ID = re.compile(r"^r[a-z0-9]{6,30}$")
# pipeline/process.ts step names → loading-screen stage
STAGES = [("keyframes", "measure"), ("labels", "objects"), ("measure", "objects"), ("room shell", "objects"), ("real-world scale", "objects"),
          ("line furniture", "objects"), ("fit estimated", "objects"), ("line up again", "objects"),
          ("builder", "build"), ("line up after building", "build"), ("judge", "check"), ("re-square", "check")]


def set_status(rid: str, **kw):
    cur = status.get(rid, {})
    cur.update(kw)
    status[rid] = cur


@app.function(image=gpu_image, gpu="A100-80GB", timeout=900, volumes={"/root/.cache/huggingface": hf_cache})
def reconstruct(jpegs: list[bytes]) -> bytes:
    """MapAnything, images only (see eval/mapanything_modal.py): per frame 3D points, confidence and camera."""
    import numpy as np
    import torch
    from PIL import Image
    from mapanything.models import MapAnything
    from mapanything.utils.image import preprocess_inputs

    model = MapAnything.from_pretrained("facebook/map-anything-apache").to("cuda")
    views = [{"img": torch.from_numpy(np.array(Image.open(io.BytesIO(b)).convert("RGB")))} for b in jpegs]
    preds = model.infer(preprocess_inputs(views), memory_efficient_inference=True, use_amp=True, amp_dtype="bf16",
                        apply_mask=True, mask_edges=True, apply_confidence_mask=False)
    hf_cache.commit()
    out = {}
    for i, p in enumerate(preds):
        out[f"pts{i}"] = p["pts3d"][0, ::2, ::2].float().cpu().numpy().astype(np.float16)
        out[f"conf{i}"] = p["conf"][0, ::2, ::2].float().cpu().numpy().astype(np.float16)
        out[f"mask{i}"] = p["mask"][0, ::2, ::2, 0].cpu().numpy().astype(bool)
        out[f"rgb{i}"] = (p["img_no_norm"][0, ::2, ::2].float().cpu().numpy() * 255).clip(0, 255).astype(np.uint8)
        out[f"pose{i}"] = p["camera_poses"][0].float().cpu().numpy()
    buf = io.BytesIO()
    np.savez_compressed(buf, **out)
    return buf.getvalue()


def video_to_capture(rid: str, cap: Path):
    """Plain video → frames in the sensor orientation → MapAnything → capture folder (pipeline/video_capture.py)."""
    work = Path("/tmp") / rid
    frames = work / "frames"
    frames.mkdir(parents=True, exist_ok=True)
    # ffmpeg turns frames upright (rotation metadata); transpose=2 then gives the phone-sensor orientation the
    # pipeline expects (it turns frames 90° clockwise for people and Muse), cut to the 4:3 1920×1440 it assumes
    fit = "transpose=2,crop='min(iw,ih*4/3)':'min(ih,iw*3/4)',scale=1920:1440"
    if (cap / "up").exists():  # the browser sent upright stills (the usual way: a few MB instead of the video)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-start_number", "0", "-i", str(cap / "up" / "f%03d.jpg"), "-vf", fit,
                        "-q:v", "3", "-start_number", "0", str(frames / "f%03d.jpg")], check=True)
    else:
        src = next(cap.glob("upload.*"))
        secs = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(src)],
                                    capture_output=True, text=True, check=True).stdout.strip() or 60)
        fps = min(1.0, MAX_FRAMES / max(secs, 1))
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-vf", f"fps={fps:.4f},{fit}",
                        "-q:v", "3", "-start_number", "0", str(frames / "f%03d.jpg")], check=True)
    names = sorted(frames.glob("f*.jpg"))
    set_status(rid, stage="measure", detail=f"3D map from {len(names)} frames")
    npz = work / "ma.npz"
    npz.write_bytes(reconstruct.remote([(frames / f"f{k:03d}.jpg").read_bytes() for k in range(len(names))]))
    subprocess.run(["uv", "run", "-q", "--with", "numpy", "--with", "pillow", "python", "/app/pipeline/video_capture.py",
                    str(npz), str(frames), str(cap)], check=True, cwd="/app")


@app.function(image=image, secrets=[secret], volumes={"/data": data}, cpu=4.0, memory=8192, timeout=3600)
def process(rid: str, kind: str):
    cap, bundle = Path("/data/uploads") / rid, Path("/data/rooms") / rid
    data.reload()  # a warm container may predate the upload
    set_status(rid, state="processing", stage="measure")
    try:
        if kind == "video":
            video_to_capture(rid, cap)
        env = {**os.environ, "SEGMENT_MODEL": "muse-spark-1.3", "PARTS_MODEL": "muse-spark-1.3"}  # visitors: no training
        proc = subprocess.Popen(["bun", "/app/pipeline/process.ts", str(cap), str(bundle)], cwd="/app", env=env,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
        last_commit, tail = 0.0, []
        for line in proc.stdout:
            tail = (tail + [line])[-30:]
            for m in re.finditer(r"▸ ([^…]+)…", line):
                stage = next((s for k, s in STAGES if m.group(1).startswith(k)), None)
                if stage:
                    set_status(rid, stage=stage, detail="")
            m = re.search(r"progress (build|check) (.+)", line)
            if m:
                set_status(rid, detail=m.group(2).strip())
            if time.time() - last_commit > 5:  # let the website see the room as it builds
                data.commit()
                last_commit = time.time()
        if proc.wait() != 0:
            raise RuntimeError("".join(tail)[-400:])
        shutil.rmtree(bundle / ".work", ignore_errors=True)
        data.commit()  # the final room is readable before anyone hears "done"
        set_status(rid, state="done", stage="done", detail="")
    except Exception as e:  # noqa: BLE001 (the visitor sees the reason)
        print(rid, e)
        set_status(rid, state="failed", error=str(e)[-300:])
    finally:
        # raw uploads and everything made from them (frames, MapAnything points, masks) never outlive processing
        # (builders and the judge keep their photo comparisons in /tmp/homie-build and /tmp/roomie-judge)
        for d in (cap, Path("/tmp") / rid, bundle / ".work", Path("/tmp/homie-build") / rid, Path("/tmp/roomie-judge") / rid):
            shutil.rmtree(d, ignore_errors=True)
        data.commit()


@app.function(image=image, volumes={"/data": data}, schedule=modal.Period(days=1))
def cleanup():
    """Rooms are deleted 30 days after they were made; stray uploads after a day."""
    now = time.time()
    for d, days in ((Path("/data/rooms"), 30), (Path("/data/uploads"), 1)):
        for r in d.glob("*") if d.exists() else []:
            if now - r.stat().st_mtime > days * 86400:
                shutil.rmtree(r, ignore_errors=True)
    data.commit()


@app.function(image=image, secrets=[secret], volumes={"/data": data})
@modal.concurrent(max_inputs=20)
@modal.asgi_app()
def web():
    from fastapi import FastAPI, Request, UploadFile
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import FileResponse, JSONResponse

    token = os.environ["ROOMIE_UPLOAD_TOKEN"]
    api = FastAPI()
    api.add_middleware(CORSMiddleware, allow_origin_regex=r"https://([a-z0-9-]+\.)?homie-tw\.pages\.dev|http://localhost:\d+",
                       allow_methods=["POST", "OPTIONS"], allow_headers=["x-homie-ticket"])

    def authed(req: Request):
        return hmac.compare_digest(req.headers.get("x-roomie-token", ""), token)

    def new_room():
        """Reserve one of today's slots and a fresh room id, or None when today's uploads are used up."""
        day = time.strftime("%Y-%m-%d")
        # numbered slots, each taken atomically, so two containers can't both get the last one
        if not any(status.put(f"day:{day}:{k}", 1, skip_if_exists=True) for k in range(DAILY_MAX)):
            return None
        rid = f"r{int(time.time() * 1000):x}{os.urandom(3).hex()}"
        (Path("/data/uploads") / rid).mkdir(parents=True, exist_ok=True)
        status[rid] = {"state": "queued"}
        return rid

    async def save(f: UploadFile, dest: Path, limit: int):
        size = 0
        with dest.open("wb") as out:
            while chunk := await f.read(1 << 20):
                size += len(chunk)
                if size > limit:
                    raise ValueError("too big")
                out.write(chunk)

    def too_big(req: Request):
        """Refuse before the body is read: the multipart parser would spool any size to disk first."""
        n = req.headers.get("content-length", "")
        if not n.isdigit():
            return JSONResponse({"error": "length required"}, 411)
        if int(n) > MAX_VIDEO:
            return JSONResponse({"error": "upload too big"}, 413)
        return None

    @api.post("/upload")
    async def upload(req: Request):
        if not authed(req):
            return JSONResponse({"error": "unauthorized"}, 401)
        if (too := too_big(req)):
            return too
        form = await req.form()
        if any(not hasattr(form.get(n), "read") for n in FILES):
            return JSONResponse({"error": "bad upload"}, 400)
        rid = new_room()
        if not rid:
            return JSONResponse({"error": "busy"}, 429)
        for n in FILES:
            await save(form[n], Path("/data/uploads") / rid / n, MAX_VIDEO)
        data.commit()
        process.spawn(rid, "arkit")
        return {"id": rid}

    @api.post("/upload-video")
    async def upload_video(req: Request):
        exp, nonce, sig = (req.headers.get("x-homie-ticket", "").split(".") + ["", "", ""])[:3]
        good = hmac.new(token.encode(), f"{exp}.{nonce}".encode(), hashlib.sha256).hexdigest()
        if not exp.isdigit() or int(exp) < time.time() or not nonce or not hmac.compare_digest(sig, good):
            return JSONResponse({"error": "ticket expired, try again"}, 403)
        if not status.put(f"ticket:{nonce}", 1, skip_if_exists=True):  # atomic: one upload per ticket
            return JSONResponse({"error": "ticket already used"}, 403)
        if (too := too_big(req)):
            return too
        form = await req.form(max_files=MAX_FRAMES + 1)
        f, stills = form.get("video"), [x for x in form.getlist("frames") if hasattr(x, "read")]
        if not hasattr(f, "read") and not 8 <= len(stills) <= MAX_FRAMES:
            return JSONResponse({"error": "no video"}, 400)
        rid = new_room()
        if not rid:
            return JSONResponse({"error": "busy"}, 429)
        up = Path("/data/uploads") / rid
        try:
            if stills:
                (up / "up").mkdir()
                for k, x in enumerate(stills):
                    await save(x, up / "up" / f"f{k:03d}.jpg", 4 * 1024 * 1024)
            else:
                ext = re.sub(r"[^a-z0-9]", "", Path(f.filename or "v.mp4").suffix.lower())[:5] or "mp4"
                await save(f, up / f"upload.{ext}", MAX_VIDEO)
        except ValueError:
            shutil.rmtree(up, ignore_errors=True)
            return JSONResponse({"error": "upload too big"}, 413)
        data.commit()
        process.spawn(rid, "video")
        return {"id": rid}

    @api.get("/status/{rid}")
    async def get_status(rid: str, req: Request):
        if not authed(req):
            return JSONResponse({"error": "unauthorized"}, 401)
        return status.get(rid) or {"state": "failed", "error": "unknown room"}

    @api.get("/rooms/{rid}/{path:path}")
    async def room_file(rid: str, path: str, req: Request):
        if not authed(req) or not ID.match(rid) or not re.fullmatch(r"room\.json|(keyframes|crops)/[a-z0-9_]+\.jpg", path):
            return JSONResponse({"error": "not found"}, 404)
        try:
            data.reload()  # see what process() committed since
        except Exception:  # noqa: BLE001 (another request is streaming a file: serve what we have)
            pass
        f = Path("/data/rooms") / rid / path
        if not f.exists():
            return JSONResponse({"error": "not found"}, 404)
        return FileResponse(f, headers={"cache-control": "no-store" if path == "room.json" else "public, max-age=86400"})

    return api
