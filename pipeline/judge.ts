// Judge loop: render the block room from 3 real camera poses next to the real frames, ask Muse what's
// wrong, apply its fixes (clamped by code), repeat up to 6 rounds or until every view scores ≥ 8/10.
// Muse scores a little differently each time, so a round that doesn't help is undone and the next round
// asks again from the best layout so far; two bad rounds in a row end it.
// Scores per round are saved in room.json → "judge" for the quality panel.
// Usage: bun pipeline/judge.ts <bundle_dir>
import { $ } from "bun";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { chatJSON, dataUrl, spent } from "./meta";

const dir = process.argv[2];
if (!dir) throw new Error("usage: bun pipeline/judge.ts <bundle_dir>");
const MODEL = process.env.JUDGE_MODEL ?? "muse-spark-1.3";
const ROUNDS = Number(process.env.JUDGE_ROUNDS ?? 6), PASS = 8; // JUDGE_ROUNDS=0: score only
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
// Pick 3 views that together see the most furniture, spread over the walk.
const counts = room.keyframes.map((k: any, i: number) => ({ i, n: room.objects.filter((o: any) => visible(k, o.center)).length }));
const views: number[] = [];
for (const third of [0, 1, 2]) {
  const lo = Math.floor((third * counts.length) / 3), hi = Math.floor(((third + 1) * counts.length) / 3);
  views.push(counts.slice(lo, hi).sort((a: any, b: any) => b.n - a.n)[0].i);
}

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["score", "issues", "fixes"],
  properties: {
    issues: { type: "array", items: { type: "string" }, description: "the 1-3 biggest mismatches that cost points, a few words each" },
    score: { type: "integer", description: "0-10: how well the right image matches the left in layout, size and colour" },
    fixes: { type: "array", items: { type: "object", additionalProperties: false, required: ["object_id", "action"],
      properties: {
        object_id: { type: "string" }, action: { type: "string", enum: ["move", "resize", "recolor", "rotate"] },
        right_m: { type: "number", description: "move: meters to the right in this view (negative = left)" },
        forward_m: { type: "number", description: "move: meters away from the camera (negative = closer)" },
        scale_w: { type: "number" }, scale_d: { type: "number" }, scale_h: { type: "number" },
        yaw_deg: { type: "number", description: "rotate: degrees, positive = counter-clockwise seen from above" },
        color: { type: "string", description: "recolor: #rrggbb of the object's main colour" },
      } } },
  },
};
const prompt = (objs: any[]) =>
  `Left: a real photo of a room. Right: our 3D block model of the same room, drawn from the exact same camera position. ` +
  `Score 0-10 how well the blocks match the photo (positions, sizes, colours; ignore missing small clutter and the simple block style). ` +
  `Name the 1-3 biggest mismatches that cost points, then list at most 5 concrete fixes for the biggest mismatches, using only these object ids:\n` +
  objs.map((o) => `${o.id} = ${o.label}, ${Math.round(o.size.w * 100)}×${Math.round(o.size.d * 100)}×${Math.round(o.size.h * 100)} cm`).join("\n") +
  `\nOnly fix objects you can clearly see in both images. Moves are relative to this camera view.`;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
function apply(view: number, f: any) {
  const o = room.objects.find((x: any) => x.id === f.object_id);
  if (!o) return false;
  if (o.source === "measured" && f.action !== "recolor") return false; // measured sizes beat the judge's eye
  const M = room.keyframes[view].cam_to_room, right = col(M, 1), fwd = col(M, 2).map((v) => -v);
  if (f.action === "move") {
    const r = clamp(f.right_m ?? 0, -0.4, 0.4), d = clamp(f.forward_m ?? 0, -0.4, 0.4);
    o.center[0] += r * right[0] + d * fwd[0];
    o.center[2] += r * right[2] + d * fwd[2];
  } else if (f.action === "resize") {
    const k = (s?: number) => clamp(s ?? 1, 0.6, 1.4);
    const [sw, sd, sh] = [k(f.scale_w), k(f.scale_d), k(f.scale_h)];
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
  let applied = 0;
  for (const r of results) for (const f of r.fixes.slice(0, 5)) applied += Number(apply(r.v, f));
  history.push({ round, scores, fixes: applied, kept: better, issues: results.map((r) => r.issues) });
  console.log(`round ${round}: scores ${scores.join(", ")} · ${applied} fixes applied · ${results.map((r) => r.issues.join("; ")).join(" | ")}`);
  if (!applied) break;
}
const kept = history.filter((h) => h.kept).at(-1)!;
room.judge = { model: MODEL, views, rounds: history, final: kept.scores, issues: kept.issues };
await Bun.write(roomPath, JSON.stringify(room, null, 1));
console.log(`judge final scores ${room.judge.final.join(", ")} after ${history.length} round(s) · Muse spend so far $${spent().toFixed(3)}`);
