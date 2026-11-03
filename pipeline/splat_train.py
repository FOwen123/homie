"""Fit a Gaussian splat to a dataset from splat_dataset.py with msplat (Metal, Apple Silicon).

Usage: uv run --with msplat --with numpy --with pillow python pipeline/splat_train.py <dataset_dir> <out.ply> [iterations]
Also writes <out>.check.jpg: real frame (left) vs splat render from the same ARKit pose (right).
"""
import sys
import time

import msplat
import numpy as np
from PIL import Image

ds_dir, out = sys.argv[1], sys.argv[2]
iters = int(sys.argv[3]) if len(sys.argv) > 3 else 7000
t0 = time.time()
dataset = msplat.load_dataset(ds_dir, eval_mode=True)
trainer = msplat.GaussianTrainer(dataset, msplat.TrainingConfig(iterations=iters, num_downscales=0))
trainer.train(lambda s: print(f"step={s.iteration} splats={s.splat_count:,}", flush=True), callback_every=1000)
train_s = time.time() - t0
trainer.export_ply(out)
m = trainer.evaluate()
print(f"trained {iters} steps in {train_s:.0f} s · PSNR {m['psnr']:.2f} · SSIM {m['ssim']:.3f}")

render = (np.clip(trainer.render_from_pose(dataset.camera_pose(0)), 0, 1) * 255).astype(np.uint8)
real = Image.open(f"{ds_dir}/images/f00001.jpg").convert("RGB").resize((render.shape[1], render.shape[0]))
check = Image.new("RGB", (render.shape[1] * 2, render.shape[0]))
check.paste(real, (0, 0))
check.paste(Image.fromarray(render), (render.shape[1], 0))
check.rotate(-90, expand=True).save(out.replace(".ply", ".check.jpg"))  # sensor frames are landscape; show upright
