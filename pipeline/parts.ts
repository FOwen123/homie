// Muse rebuilds each object as simple coloured parts (boxes and cylinders) at its measured size, like
// Rumi's simulated room; also reads the room's wall/floor/ceiling finishes. Code then clamps every part
// inside the object's measured box, so the model proposes and code enforces.
// Usage: bun pipeline/parts.ts <bundle_dir>   (reads and rewrites <bundle_dir>/room.json)
import { join } from "node:path";
import { chatJSON, dataUrl, spent } from "./meta";

const dir = process.argv[2];
if (!dir) throw new Error("usage: bun pipeline/parts.ts <bundle_dir>");
const MODEL = process.env.PARTS_MODEL ?? "muse-spark-1.3-contributor";
const roomPath = join(dir, "room.json");
const room = await Bun.file(roomPath).json();

const PART = {
  type: "object", additionalProperties: false, required: ["name", "shape", "size", "pos", "color"],
  properties: {
    name: { type: "string" }, shape: { type: "string", enum: ["box", "cylinder"] },
    size: { type: "array", items: { type: "number" }, description: "[x, y, z] in meters; cylinder: [diameter, height, diameter]" },
    pos: { type: "array", items: { type: "number" }, description: "part centre [x, y, z] in meters" },
    color: { type: "string", description: "#rrggbb" },
  },
};
const PARTS = { type: "object", additionalProperties: false, required: ["parts"], properties: { parts: { type: "array", items: PART } } };
const FINISH = {
  type: "object", additionalProperties: false, required: ["wall", "floor", "ceiling", "floor_material", "style"],
  properties: { wall: { type: "string" }, floor: { type: "string" }, ceiling: { type: "string" },
    floor_material: { type: "string" }, style: { type: "string", description: "2-5 words, e.g. 'small rental, mixed IKEA'" } },
};

const prompt = (o: any) =>
  `Rebuild this ${o.label} from the photo as 3 to 16 simple parts (boxes and cylinders) for a clean 3D room view. ` +
  `Its bounding box is ${o.size.w.toFixed(2)} m wide (x), ${o.size.h.toFixed(2)} m tall (y), ${o.size.d.toFixed(2)} m deep (z). ` +
  `Coordinates: origin at the centre of its footprint on the floor, y up, the front faces +z. Every part must stay inside ` +
  `x ∈ [${(-o.size.w / 2).toFixed(2)}, ${(o.size.w / 2).toFixed(2)}], y ∈ [0, ${o.size.h.toFixed(2)}], z ∈ [${(-o.size.d / 2).toFixed(2)}, ${(o.size.d / 2).toFixed(2)}]. ` +
  `Use the real colours you see (hex). Capture the recognisable structure (legs, top, drawers, backrest, shade) but no tiny details. ` +
  `Ignore loose clutter on top of it. White areas in the photo are background, not part of the object.`;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
function enforce(o: any, parts: any[]) {
  const half = [o.size.w / 2, o.size.h, o.size.d / 2];
  return parts.filter((p) => p.size?.length === 3 && p.pos?.length === 3).map((p) => {
    const size = p.size.map((s: number, i: number) => clamp(Math.abs(s), 0.005, i === 1 ? half[1] : 2 * half[i]));
    const pos = [
      clamp(p.pos[0], -half[0] + size[0] / 2, half[0] - size[0] / 2),
      clamp(p.pos[1], size[1] / 2, half[1] - size[1] / 2),
      clamp(p.pos[2], -half[2] + size[2] / 2, half[2] - size[2] / 2),
    ];
    return { ...p, size, pos, color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : "#b8b2a7" };
  });
}

const todo = room.objects.filter((o: any) => o.crop);
await Promise.all(Array.from({ length: 4 }, async () => {
  for (let o; (o = todo.shift()); ) {
    try {
      const r = await chatJSON(MODEL, [{ type: "text", text: prompt(o) }, { type: "image_url", image_url: { url: await dataUrl(join(dir, o.crop)) } }], PARTS, "parts");
      o.parts = enforce(o, r.parts);
      console.log(`${o.id} ${o.label}: ${o.parts.length} parts`);
    } catch (e: any) {
      console.error(`${o.id} ${o.label}: ${e.message}`);
    }
  }
}));

const views = room.keyframes.filter((_: any, i: number, a: any[]) => i % Math.ceil(a.length / 3) === 0).slice(0, 3);
room.finishes = await chatJSON(MODEL, [
  { type: "text", text: "These are frames from one room. Give the main wall colour, floor colour, ceiling colour (hex), the floor material, and the room's style." },
  ...(await Promise.all(views.map(async (k: any) => ({ type: "image_url", image_url: { url: await dataUrl(join(dir, k.file)) } })))),
], FINISH, "finishes");
await Bun.write(roomPath, JSON.stringify(room, null, 1));
console.log(`finishes: ${JSON.stringify(room.finishes)} · Muse/SAM spend so far: $${spent().toFixed(3)}`);
