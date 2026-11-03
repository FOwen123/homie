// Realistic preview: pick the video frame that sees the placed product best, then ask Muse Image to
// insert the product there (frame + product photo + where it goes, at what size). Always labelled
// "AI-generated preview" in the UI.
import type { Keyframe, Placement, Product, Room } from "../../src/lib/types";
import { type Env, json, loadCatalog, loadRoom, meta, underLimit } from "../_lib";

function project(k: Keyframe, p: [number, number, number]) {
  const M = k.cam_to_room; // camera → room, row-major; invert the rigid transform
  const R = [[M[0][0], M[0][1], M[0][2]], [M[1][0], M[1][1], M[1][2]], [M[2][0], M[2][1], M[2][2]]];
  const d = [p[0] - M[0][3], p[1] - M[1][3], p[2] - M[2][3]];
  const c = [0, 1, 2].map((i) => R[0][i] * d[0] + R[1][i] * d[1] + R[2][i] * d[2]); // Rᵀ·d
  const z = -c[2]; // ARKit cameras look down -z
  if (z < 0.2) return null;
  // keyframes are the sensor image rotated 90° clockwise, so camera y maps to image x (see pipeline/room.py)
  return { x: k.fx * (c[1] / z) + k.cx, y: k.fy * (c[0] / z) + k.cy, z };
}

function bestView(room: Room, pl: Placement, pr: Product) {
  const s = pr.size!;
  const y0 = pl.y ?? 0, c = Math.cos(pl.yaw), sn = Math.sin(pl.yaw);
  const pts: [number, number, number][] = [];
  for (const i of [-1, 1]) for (const j of [-1, 1]) for (const h of [y0, y0 + s.h]) {
    const lx = (i * s.w) / 2, lz = (j * s.d) / 2;
    pts.push([pl.x + lx * c + lz * sn, h, pl.z - lx * sn + lz * c]);
  }
  let best: { k: Keyframe; box: number[]; score: number } | null = null;
  for (const k of room.keyframes) {
    const q = pts.map((p) => project(k, p));
    if (q.some((v) => !v)) continue;
    const xs = q.map((v) => v!.x), ys = q.map((v) => v!.y);
    const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const inside = box[0] > -0.05 * k.w && box[2] < 1.05 * k.w && box[1] > -0.05 * k.h && box[3] < 1.05 * k.h;
    if (!inside) continue;
    const area = ((box[2] - box[0]) * (box[3] - box[1])) / (k.w * k.h);
    const score = Math.min(area, 0.25) - Math.abs((box[0] + box[2]) / 2 / k.w - 0.5) * 0.1; // big enough, roughly centred
    if (!best || score > best.score) best = { k, box, score };
  }
  return best;
}

async function toDataUrl(res: Response) {
  const buf = new Uint8Array(await res.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return `data:${res.headers.get("content-type") ?? "image/jpeg"};base64,${btoa(bin)}`;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { roomId, placement } = await request.json<{ roomId: string; placement: Placement }>();
  if (!(await underLimit(env, request, "photo", 8, 120))) return json({ error: "busy" }, 429);
  const [room, catalog] = await Promise.all([loadRoom(env, request, roomId), loadCatalog(env, request)]);
  const pr = catalog.find((p) => p.id === placement.productId);
  if (!pr?.size) return json({ error: "unknown product" }, 400);
  const view = bestView(room, placement, pr);
  if (!view) return json({ error: "no frame shows that spot" }, 422);
  const [frame, photo] = await Promise.all([
    env.ASSETS.fetch(new URL(`/rooms/${roomId}/${view.k.file}`, request.url)).then(toDataUrl),
    fetch(pr.image).then(toDataUrl),
  ]);
  const pct = (v: number, n: number) => Math.round(Math.min(100, Math.max(0, (v / n) * 100)));
  const [l, t, r, b] = view.box;
  const prompt =
    `Photo 1 is a real photo of a bedroom. Photo 2 is a product from an online shop (${pr.title_en ?? pr.category}). ` +
    `Edit photo 1 so the product from photo 2 stands in the room, occupying roughly the region from ${pct(l, view.k.w)}% to ${pct(r, view.k.w)}% across ` +
    `and ${pct(t, view.k.h)}% to ${pct(b, view.k.h)}% down the image, at its real size (${Math.round(pr.size.w * 100)} × ${Math.round(pr.size.d * 100)} × ${Math.round(pr.size.h * 100)} cm), ` +
    `${placement.y ? "standing on the furniture below it" : "standing on the floor"}, with matching perspective, lighting and shadows. ` +
    `Keep everything else in photo 1 exactly as it is: same room, same furniture, same framing. Photorealistic.`;
  try {
    const r = await meta(env, "/images/edits", { model: "muse-image-1.0", prompt, images: [{ image_url: frame }, { image_url: photo }], n: 1, reasoning_strength: "low" });
    const img = r.data?.[0];
    return json({ image: img?.b64_json ? `data:image/webp;base64,${img.b64_json}` : img?.url, frame: `/rooms/${roomId}/${view.k.file}` });
  } catch (e: any) {
    return json({ error: String(e.message ?? e) }, 502);
  }
};
