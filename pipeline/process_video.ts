// One command from a plain video's upright stills to a website room bundle, with Muse only:
//   floor plan (Muse watches the frames, pipeline/muse_room.ts) → builder agents → line up.
// No room judge here: its fixes need real camera positions, and these are Muse's rough guesses.
// Lines starting with "progress " are for the loading screen (pipeline/modal_app.py reads them).
// Usage: bun pipeline/process_video.ts <upright_frames_dir> <bundle_dir>
import { $ } from "bun";
import { join, resolve } from "node:path";

const [frames, bundle] = process.argv.slice(2).map((p) => resolve(p));
if (!frames || !bundle) throw new Error("usage: bun pipeline/process_video.ts <upright_frames_dir> <bundle_dir>");
const py = (script: string, ...args: string[]) => $`uv run -q --with numpy --with pillow python ${join(import.meta.dir, script)} ${args}`;
const step = async (name: string, fn: () => Promise<unknown>) => {
  const t = Date.now();
  process.stdout.write(`▸ ${name}… `);
  await fn();
  console.log(`${((Date.now() - t) / 1000).toFixed(0)} s`);
};

await step("floor plan from the video (Muse)", () => $`bun ${join(import.meta.dir, "muse_room.ts")} ${frames} ${bundle}`);
await step("line up with the walls", () => py("layout.py", bundle));
await step("builder agents: parts, self-check, rebuild (Muse)", () => $`bun ${join(import.meta.dir, "parts.ts")} ${bundle}`);
await step("final line-up", () => py("layout.py", bundle));
console.log(`done → ${bundle}`);
