// One command from a Room Capture recording to a website room bundle:
//   keyframes → Muse labels + SAM masks → measurements → room.json → Muse parts → splat.
// Usage: bun pipeline/process.ts <capture_dir> <bundle_dir> [--no-splat]
import { $ } from "bun";
import { mkdir, cp } from "node:fs/promises";
import { join, resolve } from "node:path";

const [capture, bundle] = process.argv.slice(2).map((p) => resolve(p));
if (!capture || !bundle) throw new Error("usage: bun pipeline/process.ts <capture_dir> <bundle_dir> [--no-splat]");
const work = join(bundle, ".work");
const py = (script: string, ...args: string[]) =>
  $`uv run -q --with numpy --with pillow python ${join(import.meta.dir, script)} ${args}`;
const step = async (name: string, fn: () => Promise<unknown>) => {
  const t = Date.now();
  process.stdout.write(`▸ ${name}… `);
  await fn();
  console.log(`${((Date.now() - t) / 1000).toFixed(0)} s`);
};

await mkdir(join(work, "kf"), { recursive: true });
await step("keyframes", () =>
  $`ffmpeg -v error -y -noautorotate -i ${join(capture, "video.mov")} -vf ${"select='not(mod(n\\,50))',transpose=1,scale=960:-1"} -fps_mode passthrough -q:v 3 ${join(work, "kf", "k%02d.jpg")}`);
await step("labels + masks (Muse, SAM)", () => $`bun ${join(import.meta.dir, "segment.ts")} ${join(work, "kf")} ${join(work, "seg")}`.quiet());
await step("measure on ARKit planes", () => py("measure.py", capture, join(work, "seg"), join(work, "measure.json")).quiet());
await step("room shell + objects", () => py("room.py", capture, join(work, "seg"), join(work, "kf"), join(work, "measure.json"), bundle));
await cp(join(work, "kf"), join(bundle, "keyframes"), { recursive: true });
await step("furniture parts + finishes (Muse)", () => $`bun ${join(import.meta.dir, "parts.ts")} ${bundle}`.quiet());
await step("judge: blocks vs real frames (Muse)", () => $`bun ${join(import.meta.dir, "judge.ts")} ${bundle}`.quiet());
if (!process.argv.includes("--no-splat")) {
  await step("splat dataset", () => $`uv run -q --with numpy python ${join(import.meta.dir, "splat_dataset.py")} ${capture} ${join(work, "splat_ds")} 10 960`.quiet());
  await step("splat fit (msplat)", () =>
    $`uv run -q --with msplat --with numpy --with pillow python ${join(import.meta.dir, "splat_train.py")} ${join(work, "splat_ds")} ${join(work, "room.ply")} 7000`.quiet());
  await step("splat pack", () => $`uv run -q --with numpy python ${join(import.meta.dir, "splat_pack.py")} ${join(work, "room.ply")} ${join(bundle, "room.splat")}`.quiet());
}
console.log(`done → ${bundle}`);
