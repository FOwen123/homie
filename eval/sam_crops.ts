// Experiment: replace a Muse floor plan's box crops (pipeline/muse_room.ts) with SAM 3.1 outlines, to test whether
// clean cut-outs make the builder agents' blocks better. Rewrites <bundle>/crops/objN.jpg in place.
// Usage: bun eval/sam_crops.ts <muse_room_bundle>
import { join } from "node:path";
import { $ } from "bun";
import { buildObjectPrompt, decodeMaskToRaster, parseImageStream, recordsOfKind } from "../pipeline/node_modules/@meta-sam/parser/dist/index.js";
import { call, spent } from "../pipeline/meta";

const dir = process.argv[2];
const room = await Bun.file(join(dir, "room.json")).json();
const plan = await Bun.file(join(dir, ".plan.json")).json();

async function* sse(body: ReadableStream<Uint8Array>) {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = chunk.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
      if (data && data !== "[DONE]") yield JSON.parse(data);
    }
  }
}

let done = 0;
await Promise.all(room.objects.map(async (o: any) => {
  const p = plan.objects[Number(o.id.slice(3))], kf = room.keyframes[p.frame] ?? room.keyframes[0];
  const W = kf.w, H = kf.h, px = (v: number, m: number) => Math.round((Math.min(Math.max(v, 0), 1000) * m) / 1000);
  const box = { left: px(p.box[0], W), top: px(p.box[1], H), right: px(p.box[2], W), bottom: px(p.box[3], H) };
  const url = `data:image/jpeg;base64,${Buffer.from(await Bun.file(join(dir, kf.file)).arrayBuffer()).toString("base64")}`;
  const res = await call("/responses", { model: "sam-3.1", stream: true, input: [{ type: "message", role: "user", content: [
    { type: "input_text", text: buildObjectPrompt({ size: { width: W, height: H }, objects: [{ id: 0, prompts: [{ box }] }] }) },
    { type: "input_image", image_url: url }] }] }, true);
  const m = recordsOfKind((await parseImageStream(sse(res.body!) as any).finalResult).records, "mask")[0];
  if (!m) return console.log(`${o.id} ${o.label}: no mask, box crop kept`);
  const raw = join(dir, `.${o.id}.mask`);
  await Bun.write(raw, decodeMaskToRaster(m.mask));
  const b = m.bounds;
  await $`uv run -q --with numpy --with pillow python -c ${`
import numpy as np, sys
from PIL import Image
img = Image.open(sys.argv[1]).convert("RGB").crop((${b.left}, ${b.top}, ${b.right}, ${b.bottom}))
r = np.fromfile(sys.argv[2], np.uint8).reshape(${m.mask.height}, ${m.mask.width})
bg = Image.new("RGB", img.size, (255, 255, 255))
bg.paste(img, (0, 0), Image.fromarray((r > 0).astype(np.uint8) * 255).resize(img.size))
bg.save(sys.argv[3], quality=88)`} ${join(dir, kf.file)} ${raw} ${join(dir, "crops", `${o.id}.jpg`)}`;
  await $`rm -f ${raw}`;
  console.log(`${o.id} ${o.label}: SAM crop (${++done})`);
}));
console.log(`SAM crops done · spend $${spent().toFixed(3)}`);
