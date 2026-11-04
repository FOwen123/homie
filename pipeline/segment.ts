// Muse Spark finds and labels furniture in each upright keyframe; SAM 3.1 turns each box into a mask.
// Usage: bun pipeline/segment.ts <keyframe_dir> <out_dir>
// Writes <out_dir>/<name>.json per frame, plus <name>_<id>.mask (one byte per pixel, 0/1) for each mask.
import { readdir, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { buildObjectPrompt, decodeMaskToRaster, parseImageStream, recordsOfKind } from "@meta-sam/parser";
import { call, chatJSON, spent } from "./meta";

const [dir, out] = process.argv.slice(2);
if (!dir || !out) throw new Error("usage: bun pipeline/segment.ts <keyframe_dir> <out_dir>");
// Standard mode: in a side-by-side test contributor mode split the bed and measured it 12% narrower (201×88 vs 196×94 cm).
const MODEL = process.env.SEGMENT_MODEL ?? "muse-spark-1.3";

const LABELS = ["bed", "desk", "chair", "door", "window", "wardrobe", "shelf", "cabinet", "storage box", "table", "sofa", "mirror", "lamp", "bin"];
const PROMPT =
  `This is a frame from a walk-around video of a bedroom in Taiwan. List every piece of furniture and fixed room feature that is visible, even partly. ` +
  `Use exactly one of these labels when it fits: ${LABELS.join(", ")}; otherwise a 1-2 word label. ` +
  `For each give the box [x_min,y_min,x_max,y_max] on a normalized 0-1000 grid covering the whole visible object, and visible_fraction (0-1, how much of the object is in frame). ` +
  `Skip small loose items (bags, bottles, clothes, cables).`;
const SCHEMA = {
  type: "object", additionalProperties: false, required: ["objects"],
  properties: { objects: { type: "array", items: { type: "object", additionalProperties: false, required: ["label", "box", "visible_fraction"],
    properties: { label: { type: "string" }, box: { type: "array", items: { type: "integer" } }, visible_fraction: { type: "number" } } } } },
};

async function* sse(body: ReadableStream<Uint8Array>) {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line.startsWith("data:") && line.slice(5).trim() && line.slice(5).trim() !== "[DONE]") yield JSON.parse(line.slice(5).trim());
    }
  }
}

async function frame(name: string) {
  const bytes = await Bun.file(join(dir, name)).arrayBuffer();
  const { width, height } = { width: 960, height: 1280 }; // eval keyframes are scaled to this size
  const url = `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`;
  const t0 = Date.now();
  const found: { label: string; box: number[]; visible_fraction: number }[] =
    (await chatJSON(MODEL, [{ type: "text", text: PROMPT }, { type: "image_url", image_url: { url } }], SCHEMA, "objects")).objects;
  const px = (v: number, max: number) => Math.min(max, Math.max(0, Math.round((v * max) / 1000)));
  const objects = found.filter((o) => o.box?.length === 4).slice(0, 16).map((o, id) => ({
    id, label: o.label.toLowerCase(), visible: o.visible_fraction,
    box: { left: px(o.box[0], width), top: px(o.box[1], height), right: px(o.box[2], width), bottom: px(o.box[3], height) },
  })).filter((o) => o.box.right > o.box.left && o.box.bottom > o.box.top);
  const tMuse = Date.now() - t0;

  const masks: Record<string, unknown> = {};
  if (objects.length) {
    const prompt = buildObjectPrompt({ size: { width, height }, objects: objects.map((o) => ({ id: o.id, prompts: [{ box: o.box }] })) });
    const res = await call("/responses", {
      model: "sam-3.1", stream: true,
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: prompt }, { type: "input_image", image_url: url }] }],
    }, true);
    const result = await parseImageStream(sse(res.body!) as any).finalResult;
    for (const r of recordsOfKind(result.records, "mask")) {
      await Bun.write(join(out, `${name.replace(".jpg", "")}_${r.objectId}.mask`), decodeMaskToRaster(r.mask));
      masks[r.objectId] = { bounds: r.bounds, width: r.mask.width, height: r.mask.height, confidence: r.confidence };
    }
  }
  const record = { name, width, height, timings: { museMs: tMuse, samMs: Date.now() - t0 - tMuse }, objects: objects.map((o) => ({ ...o, mask: masks[String(o.id)] ?? null })) };
  await Bun.write(join(out, name.replace(".jpg", ".json")), JSON.stringify(record, null, 1));
  console.log(`${name}: ${objects.length} objects (${objects.map((o) => o.label).join(", ")}) muse ${tMuse} ms, sam ${record.timings.samMs} ms`);
}

await mkdir(out, { recursive: true });
const names = (await readdir(dir)).filter((n) => n.endsWith(".jpg")).sort();
const only = process.env.ONLY; // e.g. ONLY=k08.jpg for a single-frame check
const queue = only ? [only] : names;
await Promise.all(Array.from({ length: 8 }, async () => { // 8 frames in flight
  for (let n; (n = queue.shift()); ) await frame(n).catch((e) => console.error(`${n}: ${e.message}`));
}));

console.log(`Muse/SAM spend so far: $${spent().toFixed(3)}`);
