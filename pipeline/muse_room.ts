// Room from a plain video with Muse alone: Muse watches ~12 frames in order and draws the floor plan (room
// size from things of known size, which wall each piece stands against and where, its size, which frame shows
// it best, and roughly where the camera stood in each frame). Code turns that into room.json (walls, openings,
// pieces, crops, approximate camera poses), so pipeline/parts.ts and layout.py run on it as usual.
// Every size is approx. (MapAnything was tried for this first and bent the rooms; see eval/mapanything_*.py.)
// Usage: bun pipeline/muse_room.ts <upright_frames_dir> <bundle_dir>   (ROOM_FRAMES, ROOM_EFFORT to experiment)
import { $ } from "bun";
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { chatJSON, dataUrl, spent } from "./meta";

const [frames, bundle] = process.argv.slice(2);
if (!frames || !bundle) throw new Error("usage: bun pipeline/muse_room.ts <upright_frames_dir> <bundle_dir>");
const MODEL = process.env.SEGMENT_MODEL ?? "muse-spark-1.3";
const N = Number(process.env.ROOM_FRAMES ?? 12); // 12 frames at medium effort: ~3 min; 16 at high: 4.5-9 min, about as accurate
process.env.META_TIMEOUT_MS ??= "480000"; // one long look at all frames: 3-6 min is normal, and a retry costs more than waiting

const WALLS = ["A", "B", "C", "D"] as const;
const SCHEMA = {
  type: "object", additionalProperties: false, required: ["room", "openings", "objects", "frames"],
  properties: {
    room: { type: "object", additionalProperties: false, required: ["width_cm", "depth_cm", "height_cm", "horizontal_fov_deg", "how"],
      properties: {
        width_cm: { type: "number", description: "length of walls A and C" }, depth_cm: { type: "number", description: "length of walls B and D" },
        height_cm: { type: "number" }, horizontal_fov_deg: { type: "number", description: "the camera's horizontal field of view in these upright frames" },
        how: { type: "string", description: "one line: which known-size things set the scale" },
      } },
    openings: { type: "array", items: { type: "object", additionalProperties: false, required: ["type", "wall", "from_cm", "to_cm", "bottom_cm", "top_cm"],
      properties: { type: { type: "string", enum: ["door", "window"] }, wall: { type: "string", enum: WALLS },
        from_cm: { type: "number" }, to_cm: { type: "number" }, bottom_cm: { type: "number" }, top_cm: { type: "number" } } } },
    objects: { type: "array", items: { type: "object", additionalProperties: false,
      required: ["label", "wall", "along_cm", "gap_cm", "w_cm", "d_cm", "h_cm", "on_cm", "frame", "box"],
      properties: {
        label: { type: "string" }, wall: { type: "string", enum: WALLS, description: "the wall it stands against, or the nearest wall if it stands free" },
        along_cm: { type: "number", description: "its centre, measured along that wall from the wall's left end as you face the wall" },
        gap_cm: { type: "number", description: "distance from that wall to the back of the piece; 0 when it stands against it" },
        w_cm: { type: "number", description: "size along the wall" }, d_cm: { type: "number", description: "size away from the wall" }, h_cm: { type: "number" },
        on_cm: { type: "number", description: "height of what it stands on, 0 on the floor (a lamp on a desk: the desk's height)" },
        frame: { type: "integer", description: "index of the frame that shows it best" },
        box: { type: "array", items: { type: "integer" }, description: "[x_min, y_min, x_max, y_max] of it in that frame, 0-1000" },
      } } },
    frames: { type: "array", items: { type: "object", additionalProperties: false, required: ["heading_deg", "x_cm", "z_cm"],
      properties: {
        heading_deg: { type: "number", description: "where the camera looks: 0 = straight at wall A, 90 = at wall B, 180 = C, 270 = D" },
        x_cm: { type: "number", description: "camera distance from wall D" }, z_cm: { type: "number", description: "camera distance from wall A" },
      } } },
  },
};
const PROMPT = (n: number) =>
  `These ${n} frames, in order, are a slow walk-around video of one rectangular room in Taiwan (frame 0 first). ` +
  `Draw its floor plan. Name the walls A, B, C, D: A is the wall frame 0 looks at most directly; B is the wall to the right of A ` +
  `(you turn right from A to face B), then C opposite A, D opposite B. ` +
  `Measure the room in cm using things of known size you can see: a door is about 90 cm wide and 205 cm tall, a single bed about ` +
  `186-190 × 90-105 cm (one pillow, one person), a double bed about 188 × 150 (two pillows), a desk about 75 cm tall, a power socket about 7 cm, floor tiles often 60 cm. ` +
  `List the doors and windows and every piece of furniture (beds, desks, chairs, wardrobes, shelves, cabinets, fridges, mirrors, ` +
  `air conditioners, bins, lamps; skip clothes, bags and small clutter), each with the wall it stands against, where along it, ` +
  `its size, and the frame and box that show it best. For each frame give where the camera stood and looked. ` +
  `Keep everything consistent: pieces must fit inside the room and not overlap.`;

const names = (await readdir(frames)).filter((f) => /\.jpe?g$/i.test(f)).sort();
const pick = names.filter((_, i) => names.length <= N || i % (names.length / N) < 1).slice(0, N);
await mkdir(join(bundle, "keyframes"), { recursive: true });
await mkdir(join(bundle, "crops"), { recursive: true });
const kfNames = pick.map((_, i) => `k${String(i + 1).padStart(2, "0")}.jpg`);
for (const [i, f] of pick.entries()) await $`ffmpeg -v error -y -i ${join(frames, f)} -vf scale=960:-2 -q:v 3 ${join(bundle, "keyframes", kfNames[i])}`;

const content: any[] = [{ type: "text", text: PROMPT(pick.length) }];
for (const [i, k] of kfNames.entries()) {
  const small = join(bundle, `.small_${k}`); // 768 px is plenty to read a room and keeps the call fast
  await $`ffmpeg -v error -y -i ${join(bundle, "keyframes", k)} -vf scale=768:-2 -q:v 4 ${small}`;
  content.push({ type: "text", text: `frame ${i}` }, { type: "image_url", image_url: { url: await dataUrl(small) } });
  await $`rm -f ${small}`;
}
const plan = await chatJSON(MODEL, content, SCHEMA, "room", 2, process.env.ROOM_EFFORT ?? "medium");
await Bun.write(join(bundle, ".plan.json"), JSON.stringify(plan, null, 1)); // Muse's raw answer, for debugging (never served)

// Room coordinates: x to the right when facing wall A, z away from A, y up; A at z = -D/2, B at x = +W/2.
const cm = (v: number) => v / 100;
const W = cm(plan.room.width_cm), D = cm(plan.room.depth_cm), H = cm(plan.room.height_cm);
const ends: Record<string, [number[], number[]]> = { // each wall's left and right end, facing it from inside
  A: [[-W / 2, -D / 2], [W / 2, -D / 2]], B: [[W / 2, -D / 2], [W / 2, D / 2]],
  C: [[W / 2, D / 2], [-W / 2, D / 2]], D: [[-W / 2, D / 2], [-W / 2, -D / 2]],
};
const inward: Record<string, number[]> = { A: [0, 1], B: [-1, 0], C: [0, -1], D: [1, 0] };
const yawOf: Record<string, number> = { A: 0, B: -Math.PI / 2, C: Math.PI, D: Math.PI / 2 }; // front (local +z) faces into the room
const at = (wall: string, along: number, off: number) => {
  const [[ax, az], [bx, bz]] = ends[wall], L = Math.hypot(bx - ax, bz - az), [nx, nz] = inward[wall];
  return [ax + ((bx - ax) * along) / L + nx * off, az + ((bz - az) * along) / L + nz * off];
};

const walls = WALLS.map((id) => ({
  id, a: ends[id][0], b: ends[id][1],
  openings: plan.openings.filter((o: any) => o.wall === id).map((o: any) => ({
    type: o.type, from: cm(Math.min(o.from_cm, o.to_cm)), to: cm(Math.max(o.from_cm, o.to_cm)), bottom: cm(o.bottom_cm), top: cm(o.top_cm),
  })),
}));

const [fw, fh] = (await $`ffprobe -v error -select_streams v -show_entries stream=width,height -of csv=p=0 ${join(bundle, "keyframes", kfNames[0])}`.text()).trim().split(",").map(Number);
const fov = Math.min(Math.max(plan.room.horizontal_fov_deg || 70, 40), 120);
const keyframes = kfNames.map((file, i) => {
  const f = plan.frames[i] ?? { heading_deg: 0, x_cm: plan.room.width_cm / 2, z_cm: plan.room.depth_cm / 2 };
  const h = (f.heading_deg * Math.PI) / 180, fwd = [Math.sin(h), 0, -Math.cos(h)], right = [Math.cos(h), 0, Math.sin(h)];
  const pos = [cm(f.x_cm) - W / 2, 1.4, cm(f.z_cm) - D / 2];
  // upright keyframe camera (pipeline/room.py): camera x = image down, camera y = image right, camera z = backward
  const M = [0, 1, 2].map((r) => [[0, -1, 0][r], right[r], -fwd[r], pos[r]]).concat([[0, 0, 0, 1]]);
  const f_px = fw / 2 / Math.tan((fov * Math.PI) / 360);
  return { file: `keyframes/${file}`, cam_to_room: M, fx: f_px, fy: f_px, cx: fw / 2, cy: fh / 2, w: fw, h: fh };
});

const objects = [];
for (const [i, o] of plan.objects.entries()) {
  const w = cm(o.w_cm), d = cm(o.d_cm), h = cm(o.h_cm), y0 = cm(o.on_cm ?? 0);
  if (!(w > 0.05 && d > 0.02 && h > 0.02) || !ends[o.wall]) continue;
  const [x, z] = at(o.wall, cm(o.along_cm), cm(o.gap_cm) + d / 2);
  const id = `obj${i}`, k = keyframes[o.frame] ? o.frame : 0;
  // crop: the box in its best frame, a little padded
  const [x0, y0b, x1, y1] = (o.box ?? [0, 0, 1000, 1000]).map((v: number) => Math.min(Math.max(v, 0), 1000) / 1000);
  const pw = (x1 - x0) * 0.06, ph = (y1 - y0b) * 0.06;
  const [l, t, r, b] = [Math.max(0, x0 - pw), Math.max(0, y0b - ph), Math.min(1, x1 + pw), Math.min(1, y1 + ph)];
  const crop = `crops/${id}.jpg`;
  const cut = r - l > 0.02 && b - t > 0.02 &&
    (await $`ffmpeg -v error -y -i ${join(bundle, keyframes[k].file)} -vf ${`crop=iw*${(r - l).toFixed(4)}:ih*${(b - t).toFixed(4)}:iw*${l.toFixed(4)}:ih*${t.toFixed(4)}`} ${join(bundle, crop)}`.quiet().nothrow()).exitCode === 0;
  objects.push({ label: o.label.toLowerCase(), center: [x, y0 + h / 2, z], yaw: yawOf[o.wall], size: { w, d, h },
    pm_cm: Math.round(Math.max(10, 12 * Math.max(w, d, h))), source: "approx", id, ...(cut ? { crop } : {}) });
}

const room = { version: 1, units: "meters", capture: "video", method: "muse", scale_note: plan.room.how,
  shell: { width: W, depth: D, height: H, walls }, objects, keyframes, world_to_room: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]] };
await Bun.write(join(bundle, "room.json"), JSON.stringify(room, null, 1));
console.log(`muse room: ${plan.room.width_cm}×${plan.room.depth_cm}×${plan.room.height_cm} cm (${plan.room.how}), ${objects.length} pieces, ${plan.openings.length} openings · spend $${spent().toFixed(3)}`);
for (const o of objects) console.log(`  ${o.label.padEnd(16)} ${Math.round(o.size.w * 100)} × ${Math.round(o.size.d * 100)} × ${Math.round(o.size.h * 100)} cm`);
