// Room judge: render the block room from real camera poses (chosen so every object is seen) next to the real
// frames, ask Muse what's wrong, apply its fixes (clamped by code), repeat up to 4 rounds or until every view
// scores ≥ 8/10. Besides move/resize/recolor/rotate it can push a piece against the wall, turn it to face the
// room, or send an object that makes no sense back to its builder (pipeline/parts.ts) with a note.
// Muse scores a little differently each time, so a round that doesn't help is undone and the next round
// asks again from the best layout so far; two bad rounds in a row end it.
// Scores per round are saved in room.json → "judge" for the quality panel.
// Usage: bun pipeline/judge.ts <bundle_dir>
import { $ } from "bun";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { chatJSON, dataUrl, spent } from "./meta";
import { buildObject } from "./parts";

const dir = process.argv[2];
if (!dir) throw new Error("usage: bun pipeline/judge.ts <bundle_dir>");
const MODEL = process.env.JUDGE_MODEL ?? "muse-spark-1.3";
const ROUNDS = Number(process.env.JUDGE_ROUNDS ?? 4), PASS = 8, MAX_VIEWS = 5; // JUDGE_ROUNDS=0: score only
const roomPath = join(dir, "room.json");
const room = await Bun.file(roomPath).json();
const work = join(tmpdir(), "roomie-judge", basename(dir)); // outside the bundle, so it is never published

// Camera helpers: keyframes are upright, so image right = camera +y and forward = camera -z (pipeline/room.py).
const col = (M: number[][], j: number) => [M[0][j], M[1][j], M[2][j]];
function visible(k: any, p: number[]) {
  const M = k.cam_to_room, d = [p[0] - M[0][3], p[1] - M[1][3], p[2] - M[2][3]];
  const c = [0, 1, 2].map((i) => M[0][i] * d[0] + M[1][i] * d[1] + M[2][i] * d[2]);
  const z = -c[2];
  if (z < 0.3) return false;
  const x = k.fx * (c[1] / z) + k.cx, y = k.fy * (c[0] / z) + k.cy;
  return x > 0 && x < k.w && y > 0 && y < k.h;
}
// Pick views so every object is seen at least once (greedy: each next view sees the most unseen objects).
const sees = room.keyframes.map((k: any) => new Set(room.objects.filter((o: any) => visible(k, o.center)).map((o: any) => o.id)));
const views: number[] = [], seen = new Set<string>();
while (views.length < MAX_VIEWS) {
  const gain = (i: number) => [...sees[i]].filter((id) => !seen.has(id)).length + sees[i].size / 100;
  const i = sees.map((_: any, i: number) => i).filter((i: number) => !views.includes(i)).sort((a: number, b: number) => gain(b) - gain(a))[0];
  if (i === undefined || (views.length >= 3 && gain(i) < 1)) break;
  views.push(i);
  for (const id of sees[i]) seen.add(id);
}

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["score", "issues", "fixes"],
  properties: {
    issues: { type: "array", items: { type: "string" }, description: "the 1-3 biggest mismatches that cost points, a few words each" },
    score: { type: "integer", description: "0-10: how well the right image matches the left in layout, size and colour" },
    fixes: { type: "array", items: { type: "object", additionalProperties: false, required: ["object_id", "action"],
      properties: {
        object_id: { type: "string" }, action: { type: "string", enum: ["move", "resize", "recolor", "rotate", "against_wall", "face_room", "rebuild"] },
        right_m: { type: "number", description: "move: meters to the right in this view (negative = left)" },
        forward_m: { type: "number", description: "move: meters away from the camera (negative = closer)" },
        scale_w: { type: "number" }, scale_d: { type: "number" }, scale_h: { type: "number" },
        yaw_deg: { type: "number", description: "rotate: degrees, positive = counter-clockwise seen from above" },
        color: { type: "string", description: "recolor: #rrggbb of the object's main colour" },
        note: { type: "string", description: "rebuild: what is wrong with the object's shape, e.g. 'two backrests, the real chair has one'" },
      } } },
  },
};
const prompt = (objs: any[]) =>
  `Left: a real photo of a room. Right: our 3D block model of the same room, drawn from the exact same camera position. ` +
  `Score 0-10 how well the blocks match the photo (positions, sizes, colours; ignore missing small clutter and the simple block style). ` +
  `Name the 1-3 biggest mismatches that cost points, then list at most 5 concrete fixes for the biggest mismatches, using only these object ids:\n` +
  objs.map((o) => `${o.id} = ${o.label}, ${Math.round(o.size.w * 100)}×${Math.round(o.size.d * 100)}×${Math.round(o.size.h * 100)} cm`).join("\n") +
  `\nActions: move, resize, recolor, rotate; against_wall = the real piece stands against a wall but the block doesn't; ` +
  `face_room = its front (doors, drawers, open side) faces the wrong way, it should face into the room; ` +
  `rebuild = the block shape makes no sense for this object (e.g. a chair with two backrests), with a note. ` +
  `Only fix objects you can clearly see in both images. Moves are relative to this camera view.`;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const W = room.shell.width / 2, D = room.shell.depth / 2;
// gaps from the object's footprint to each wall, as [direction x, direction z, gap]
function gaps(o: any) {
  const q = Math.round(o.yaw / (Math.PI / 2)) % 2 !== 0, hx = (q ? o.size.d : o.size.w) / 2, hz = (q ? o.size.w : o.size.d) / 2;
  const [cx, , cz] = o.center;
  return { hx, hz, list: [[1, 0, W - cx - hx], [-1, 0, cx - hx + W], [0, 1, D - cz - hz], [0, -1, cz - hz + D]].sort((a, b) => a[2] - b[2]) };
}
async function apply(view: number, f: any) {
  const o = room.objects.find((x: any) => x.id === f.object_id);
  if (!o) return false;
  if (f.action === "rebuild") {
    if (!o.crop) return false;
    await buildObject(dir, room, o, String(f.note ?? "").slice(0, 300));
    return true;
  }
  if (o.source === "measured" && f.action !== "recolor") return false; // measured sizes beat the judge's eye
  const M = room.keyframes[view].cam_to_room, right = col(M, 1), fwd = col(M, 2).map((v) => -v);
  if (f.action === "move") {
    const r = clamp(f.right_m ?? 0, -0.4, 0.4), d = clamp(f.forward_m ?? 0, -0.4, 0.4);
    o.center[0] += r * right[0] + d * fwd[0];
    o.center[2] += r * right[2] + d * fwd[2];
  } else if (f.action === "against_wall") {
    const g = gaps(o), [x, z, gap] = g.list[0];
    if (gap > 0.6) return false; // too far to be the wall it stands against
    o.center[0] += x * (gap - 0.01);
    o.center[2] += z * (gap - 0.01);
  } else if (f.action === "face_room") {
    const [x, z] = gaps(o).list[0], yaw = Math.atan2(-x, -z); // back to the nearest wall
    const turn = Math.round((((yaw - o.yaw) / (Math.PI / 2)) % 4 + 4) % 4);
    if (!turn) return false;
    o.yaw = Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2);
    if (turn % 2) {
      [o.size.w, o.size.d] = [o.size.d, o.size.w]; // same footprint, so the parts are rebuilt for it
      if (o.crop) await buildObject(dir, room, o, "the front now faces into the room");
    }
  } else if (f.action === "resize") {
    // small steps: the builder already sized the piece, and the judge's eye overshoots (a chair went 52 → 34 cm)
    const k = (s: number | undefined, lo: number, hi: number) => clamp(s ?? 1, lo, hi);
    const [sw, sd, sh] = [k(f.scale_w, 0.8, 1.25), k(f.scale_d, 0.8, 1.25), k(f.scale_h, 0.9, 1.1)];
    o.size = { w: o.size.w * sw, d: o.size.d * sd, h: o.size.h * sh };
    o.center[1] = o.center[1] * sh;
    for (const p of o.parts ?? []) {
      p.size = [p.size[0] * sw, p.size[1] * sh, p.size[2] * sd];
      p.pos = [p.pos[0] * sw, p.pos[1] * sh, p.pos[2] * sd];
    }
  } else if (f.action === "recolor" && /^#[0-9a-f]{6}$/i.test(f.color ?? "")) {
    const parts = o.parts ?? [];
    const main = parts.reduce((a: any, p: any) => (!a || p.size[0] * p.size[1] * p.size[2] > a.size[0] * a.size[1] * a.size[2] ? p : a), null);
    for (const p of parts) if (p.color === main?.color) p.color = f.color;
  } else if (f.action === "rotate") {
    o.yaw += (clamp(f.yaw_deg ?? 0, -90, 90) * Math.PI) / 180;
  } else return false;
  return true;
}

const history: { round: number; scores: number[]; fixes: number; kept: boolean; issues: string[][] }[] = [];
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
// Render the current layout from the 3 views and ask Muse for a score and fixes per view.
async function ask() {
  await Bun.write(roomPath, JSON.stringify(room, null, 1));
  await $`uv run -q --with numpy --with pillow python ${join(import.meta.dir, "render_blocks.py")} ${dir} ${work} ${views.map(String)}`.quiet();
  return Promise.all(views.map(async (v) => {
    const objs = room.objects.filter((o: any) => visible(room.keyframes[v], o.center));
    const r = await chatJSON(MODEL, [{ type: "text", text: prompt(objs) }, { type: "image_url", image_url: { url: await dataUrl(join(work, `judge_${v}.jpg`)) } }], SCHEMA, "judge");
    return { v, ...r };
  }));
}

let snapshot = JSON.stringify(room.objects), best = -1, misses = 0;
for (let round = 1; round <= ROUNDS + 1; round++) {
  let results = await ask();
  const scores = results.map((r) => r.score);
  console.log(`progress check round ${round} · ${scores.join(", ")}`);
  // Keep the last round's fixes only if they made the match better; otherwise undo them and ask for new
  // fixes on the best layout (fixes proposed for a layout we just threw away would point the wrong way).
  const better = best < 0 || mean(scores) > best;
  if (better) {
    best = mean(scores);
    snapshot = JSON.stringify(room.objects);
    misses = 0;
  } else {
    room.objects = JSON.parse(snapshot);
    console.log(`round ${round}: scores ${scores.join(", ")} not better, last fixes reverted`);
  }
  if ((better && scores.every((s) => s >= PASS)) || round > ROUNDS || (!better && ++misses >= 2)) {
    history.push({ round, scores, fixes: 0, kept: better, issues: results.map((r) => r.issues) });
    break;
  }
  if (!better) results = await ask();
  // simple fixes land at once; rebuilds run side by side, one per object
  const jobs: Promise<boolean>[] = [], rebuilding = new Set<string>();
  for (const r of results) for (const f of r.fixes.slice(0, 5)) {
    if (f.action === "rebuild" || f.action === "face_room") {
      if (rebuilding.has(f.object_id)) continue;
      rebuilding.add(f.object_id);
    }
    jobs.push(apply(r.v, f));
  }
  const applied = (await Promise.all(jobs)).filter(Boolean).length;
  history.push({ round, scores, fixes: applied, kept: better, issues: results.map((r) => r.issues) });
  console.log(`round ${round}: scores ${scores.join(", ")} · ${applied} fixes applied · ${results.map((r) => r.issues.join("; ")).join(" | ")}`);
  if (!applied) break;
}
const kept = history.filter((h) => h.kept).at(-1)!;
room.judge = { model: MODEL, views, rounds: history, final: kept.scores, issues: kept.issues };
await Bun.write(roomPath, JSON.stringify(room, null, 1));
console.log(`judge final scores ${room.judge.final.join(", ")} after ${history.length} round(s) · Muse spend so far $${spent().toFixed(3)}`);
