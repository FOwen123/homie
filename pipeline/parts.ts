// Builder agents: Muse rebuilds each object as simple coloured parts (boxes and cylinders) at its measured
// size, then checks its own work: code draws the blocks alone from the object's best camera view, Muse compares
// them with the photo crop, and the object is rebuilt with that note (up to 2 times). The check also says which
// face is the real front (code turns the object) and, for approximate pieces, the real size (code limits it).
// All objects build at once. Code clamps every part inside the object's box: the model proposes, code enforces.
// Usage: bun pipeline/parts.ts <bundle_dir>   (reads and rewrites <bundle_dir>/room.json)
// pipeline/judge.ts imports buildObject to send an object back with a note.
import { $ } from "bun";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { chatJSON, dataUrl, spent } from "./meta";

const MODEL = process.env.PARTS_MODEL ?? "muse-spark-1.3-contributor";
const TRIES = 3, GOOD = 7;

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
  properties: { wall: { type: "string", description: "#rrggbb" }, floor: { type: "string", description: "#rrggbb" }, ceiling: { type: "string", description: "#rrggbb" },
    floor_material: { type: "string" }, style: { type: "string", description: "2-5 words, e.g. 'small rental, mixed IKEA'" } },
};

const prompt = (o: any) =>
  `Rebuild this ${o.label} from the photo as 3 to 16 simple parts (boxes and cylinders) for a clean 3D room view. ` +
  `Its bounding box is ${o.size.w.toFixed(2)} m wide (x), ${o.size.h.toFixed(2)} m tall (y), ${o.size.d.toFixed(2)} m deep (z). ` +
  `Coordinates: origin at the centre of its footprint on the floor, y up, the front faces +z. Every part must stay inside ` +
  `x ∈ [${(-o.size.w / 2).toFixed(2)}, ${(o.size.w / 2).toFixed(2)}], y ∈ [0, ${o.size.h.toFixed(2)}], z ∈ [${(-o.size.d / 2).toFixed(2)}, ${(o.size.d / 2).toFixed(2)}]. ` +
  `Use the real colours you see (hex). Capture the recognisable structure (legs, top, drawers, backrest, shade) but no tiny details. ` +
  `Ignore loose clutter on top of it. White areas in the photo are background, not part of the object. ` +
  `A patterned surface (stripes, prints, checks) is one part in its main colour: don't model the pattern. ` +
  `Thin things stay thin (a seat, a shell or a top is 2-4 cm). A chair is a seat, one backrest and its legs: side panels only if it has armrests.` +
  (o.label === "bed" ? ` The bed is long along ${long(o) === 0 ? "x" : "z"}; its headboard spans the short side at the ${long(o) === 0 ? "-x" : "-z"} end.` : "");
const long = (o: any) => (o.size.w >= o.size.d ? 0 : 2); // part axis the object is long along

// A bed's head is the end against a wall: Muse can't tell which end that is from a crop, so code mirrors it.
function headToWall(room: any, o: any, parts: any[]) {
  const a = long(o), L = (a === 0 ? o.size.w : o.size.d) / 2, c = Math.cos(o.yaw), s = Math.sin(o.yaw);
  const end = (sign: number) => { const lx = a === 0 ? sign * L : 0, lz = a === 2 ? sign * L : 0; return [o.center[0] + lx * c + lz * s, o.center[2] - lx * s + lz * c]; };
  const toWall = ([x, z]: number[]) => Math.min(...room.shell.walls.map((w: any) => {
    const [ax, az] = w.a, dx = w.b[0] - ax, dz = w.b[1] - az, t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
    return Math.hypot(x - ax - t * dx, z - az - t * dz);
  }));
  if (toWall(end(1)) < toWall(end(-1))) for (const p of parts) p.pos[a] = -p.pos[a];
  return parts;
}

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

const CHECK = {
  type: "object", additionalProperties: false, required: ["score", "problems", "front", "w_cm", "d_cm", "h_cm"],
  properties: {
    score: { type: "integer", description: "0-10: how well the blocks capture the real object (shape, parts, proportions, colours)" },
    problems: { type: "array", items: { type: "string" }, description: "0-3 concrete problems with the blocks, e.g. 'two backrests, real chair has one curved shell'" },
    front: { type: "string", enum: ["left_visible_face", "right_visible_face", "hidden", "none"],
      description: "of the block model's side faces you can see, the one that should carry the real object's front (doors, drawers, open shelves, seat, screen); hidden if it should be a face you can't see; none if the object has no front" },
    w_cm: { type: "number" }, d_cm: { type: "number" }, h_cm: { type: "number" },
  },
};
const checkPrompt = (o: any) =>
  `Left: a photo of a real ${o.label}. Right: our 3D block model of it (${cm(o.size.w)} wide × ${cm(o.size.d)} deep × ${cm(o.size.h)} cm tall), ` +
  `drawn from another camera angle. Blocks can only be plain-coloured boxes and cylinders, so never mention textures, ` +
  `wood grain, transparency, logos, small handles, pillows or fabric patterns. Score only the overall shape, the layout ` +
  `of the main parts, the proportions and the main colours, and name what is wrong with those (missing or extra main parts, ` +
  `wrong proportions, wrong main colour). ` +
  `Say which side face of the block model should carry the real front. Also give your best estimate of the real object's ` +
  `width, depth and height in cm, using typical sizes of such furniture and anything of known size in the photo.`;
const cm = (m: number) => Math.round(m * 100);

const saves = new Map<string, Promise<unknown>>();
/** Write room.json, one write at a time, so the website can show progress while builders run. */
export function save(dir: string, room: any) {
  const p = (saves.get(dir) ?? Promise.resolve()).then(() => Bun.write(join(dir, "room.json"), JSON.stringify(room, null, 1)));
  saves.set(dir, p);
  return p;
}

async function check(dir: string, room: any, o: any) {
  const work = join(tmpdir(), "homie-build", basename(dir));
  await mkdir(work, { recursive: true });
  const own = join(work, `${o.id}.room.json`);
  await Bun.write(own, JSON.stringify({ keyframes: room.keyframes, objects: [o] }));
  await $`uv run -q --with numpy --with pillow python ${join(import.meta.dir, "render_blocks.py")} ${dir} ${work} --object ${o.id}`.env({ ...process.env, ROOM_JSON: own }).quiet();
  const view = await Bun.file(join(work, `obj_${o.id}.json`)).json().catch(() => null);
  if (!view) return null;
  const r = await chatJSON(MODEL, [{ type: "text", text: checkPrompt(o) }, { type: "image_url", image_url: { url: await dataUrl(join(work, `obj_${o.id}.jpg`)) } }], CHECK, "check");
  return { ...r, view };
}

/** Turn the object so the face the check named becomes its front; a quarter turn keeps the footprint (w, d swap). */
// Against a wall, the back stays on a wall (pipeline/layout.py's rule beats the check's eye on an oblique view).
function face(room: any, o: any, front: string, view: any) {
  const n = front === "left_visible_face" ? view.faces[0] : front === "right_visible_face" ? view.faces.at(-1) : null;
  if (!n || room.method === "muse") return false; // in a Muse floor plan the back wall is known; its camera guesses are not
  const q = Math.round(o.yaw / (Math.PI / 2)) % 2 !== 0, hx = (q ? o.size.d : o.size.w) / 2, hz = (q ? o.size.w : o.size.d) / 2;
  const W = room.shell.width / 2, D = room.shell.depth / 2, [cx, , cz] = o.center;
  const walls = [[1, 0, W - cx - hx], [-1, 0, cx - hx + W], [0, 1, D - cz - hz], [0, -1, cz - hz + D]].filter((w) => w[2] < 0.1);
  if (walls.length && !walls.some(([x, z]) => x === -n[0] && z === -n[1])) return false;
  const yaw = Math.atan2(n[0], n[1]), turn = Math.round((((yaw - o.yaw) / (Math.PI / 2)) % 4 + 4) % 4);
  if (!turn) return false;
  o.yaw = Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2);
  if (turn % 2) [o.size.w, o.size.d] = [o.size.d, o.size.w];
  return true;
}

/** Approximate pieces take the check's size estimate once, when it differs clearly: width and depth within
 *  ×0.7–1.4, height within ×0.85–1.15 (the top of a piece is usually measured well; the eye overshoots it). */
function resize(o: any, r: any) {
  if (o.source === "measured" || o.resized) return false;
  const want = [r.w_cm, r.d_cm, r.h_cm].map((v: number) => v / 100), cur = [o.size.w, o.size.d, o.size.h];
  if (want.some((v) => !(v > 0)) || want.every((v, i) => Math.abs(v / cur[i] - 1) < 0.15)) return false;
  const [w, d, h] = want.map((v, i) => clamp(v, cur[i] * (i === 2 ? 0.85 : 0.7), cur[i] * (i === 2 ? 1.15 : 1.4)));
  o.center[1] += (h - o.size.h) / 2;
  o.size = { w, d, h };
  o.resized = true;
  return true;
}

/** One builder agent: parts → self-check → rebuild with the check's note, keeping the best try. */
export async function buildObject(dir: string, room: any, o: any, note = "") {
  let best: any = null;
  for (let t = 0; ; t++) {
    const content: any[] = [{ type: "text", text: prompt(o) + (note ? ` A reviewer said about the last try: ${note}. Fix that.` : "") },
      { type: "image_url", image_url: { url: await dataUrl(join(dir, o.crop)) } }];
    const r = await chatJSON(MODEL, content, PARTS, "parts");
    o.parts = enforce(o, r.parts);
    if (o.label === "bed") headToWall(room, o, o.parts);
    if (t === TRIES) break; // rebuilt after a late turn or resize: no checks left
    const c = await check(dir, room, o).catch((e) => (console.error(`${o.id} check: ${e.message}`), null));
    if (!c) break;
    if (!best || c.score > best.score) best = { score: c.score, parts: o.parts, yaw: o.yaw, size: { ...o.size }, center: [...o.center] };
    const turned = c.front !== "none" && o.label !== "bed" && face(room, o, c.front, c.view);
    const sized = resize(o, c);
    console.log(`${o.id} ${o.label} try ${t + 1}: ${c.score}/10${turned ? " · turned" : ""}${sized ? ` · resized ${cm(o.size.w)}×${cm(o.size.d)}×${cm(o.size.h)}` : ""}${c.problems.length ? " · " + c.problems.join("; ") : ""}`);
    note = c.problems.join("; ");
    if (turned || sized) { best = null; continue; } // geometry changed: earlier tries no longer apply
    if (c.score >= GOOD || t === TRIES - 1) break;
  }
  if (best) Object.assign(o, { parts: best.parts, yaw: best.yaw, size: best.size, center: best.center });
  o.build_score = best?.score;
  delete o.resized;
  return o.parts.length;
}

if (import.meta.main) {
  const dir = process.argv[2];
  if (!dir) throw new Error("usage: bun pipeline/parts.ts <bundle_dir>");
  const room = await Bun.file(join(dir, "room.json")).json();
  const todo = room.objects.filter((o: any) => o.crop), total = todo.length;
  let done = 0;
  console.log(`progress build 0/${total}`);
  // every object at once (12 in flight), each its own builder
  await Promise.all(Array.from({ length: 12 }, async () => {
    for (let o; (o = todo.shift()); ) {
      try {
        await buildObject(dir, room, o);
      } catch (e: any) {
        console.error(`${o.id} ${o.label}: ${e.message}`);
      }
      await save(dir, room);
      console.log(`progress build ${++done}/${total}`);
    }
  }));

  const views = room.keyframes.filter((_: any, i: number, a: any[]) => i % Math.ceil(a.length / 3) === 0).slice(0, 3);
  room.finishes = await chatJSON(MODEL, [
    { type: "text", text: "These are frames from one room. Give the main wall colour, floor colour, ceiling colour (hex), the floor material, and the room's style." },
    ...(await Promise.all(views.map(async (k: any) => ({ type: "image_url", image_url: { url: await dataUrl(join(dir, k.file)) } })))),
  ], FINISH, "finishes");
  for (const k of ["wall", "floor", "ceiling"]) if (!/^#[0-9a-f]{6}$/i.test(room.finishes[k])) delete room.finishes[k]; // the views fall back to defaults
  await save(dir, room);
  console.log(`finishes: ${JSON.stringify(room.finishes)} · Muse/SAM spend so far: $${spent().toFixed(3)}`);
}
