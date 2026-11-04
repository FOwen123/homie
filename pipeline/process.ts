// One command from a Room Capture recording to a website room bundle:
//   keyframes → Muse labels + SAM masks → measurements → room.json → fit + crops → Muse parts → judge.
// Usage: bun pipeline/process.ts <capture_dir> <bundle_dir>
import { $ } from "bun";
import { mkdir, cp } from "node:fs/promises";
import { join, resolve } from "node:path";

const [capture, bundle] = process.argv.slice(2).map((p) => resolve(p));
if (!capture || !bundle) throw new Error("usage: bun pipeline/process.ts <capture_dir> <bundle_dir>");
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
await step("line furniture up with the walls", () => py("layout.py", bundle));
await cp(join(work, "kf"), join(bundle, "keyframes"), { recursive: true });
await step("fit estimated pieces to their outlines, one crop each", () => py("fit_boxes.py", bundle, join(work, "seg")));
await step("line up again after fitting", () => py("layout.py", bundle));
await step("furniture parts + finishes (Muse)", () => $`bun ${join(import.meta.dir, "parts.ts")} ${bundle}`.quiet());
await step("judge: blocks vs real frames (Muse)", () => $`bun ${join(import.meta.dir, "judge.ts")} ${bundle}`.quiet());
await step("re-square after the judge's moves", () => py("layout.py", bundle));
console.log(`done → ${bundle}`);
