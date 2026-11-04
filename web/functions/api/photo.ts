// Realistic preview: pick the video frame that sees the placed product best, then ask Muse Image to
// insert the product there (frame + product photo + where it goes, at what size). Always labelled
// "AI-generated preview" in the UI.
import type { Keyframe, Placement, Product, Room } from "../../src/lib/types";
import { type Env, json, loadCatalog, loadRoom, meta, underLimit } from "../_lib";

const NEAR = 0.2; // m in front of the camera
/** Room point → camera coordinates (ARKit: the camera looks down -z). */
function toCam(k: Keyframe, p: number[]) {
  const M = k.cam_to_room; // camera → room, row-major; invert the rigid transform
  const d = [p[0] - M[0][3], p[1] - M[1][3], p[2] - M[2][3]];
  return [0, 1, 2].map((i) => M[0][i] * d[0] + M[1][i] * d[1] + M[2][i] * d[2]); // Rᵀ·d
}
// keyframes are the sensor image rotated 90° clockwise, so camera y maps to image x (see pipeline/room.py)
const toPixel = (k: Keyframe, c: number[]) => ({ x: (k.fx * c[1]) / -c[2] + k.cx, y: (k.fy * c[0]) / -c[2] + k.cy });

/** The box's outline in the image: corners in front of the camera, plus where its edges cross the near plane
 *  (a big rug around the camera is partly behind it; dropping those corners alone would shrink it to a sliver). */
function outlinePixels(k: Keyframe, pts: number[][]) {
  const cs = pts.map((p) => toCam(k, p)), out: { x: number; y: number }[] = [];
  cs.forEach((c) => { if (-c[2] >= NEAR) out.push(toPixel(k, c)); });
  for (let a = 0; a < 8; a++) for (const bit of [1, 2, 4]) {
    const b = a | bit;
    if (b === a) continue; // corners a and b differ in one bit: an edge of the box
    const za = -cs[a][2], zb = -cs[b][2];
    if ((za >= NEAR) === (zb >= NEAR)) continue;
    const t = (NEAR - za) / (zb - za);
    out.push(toPixel(k, cs[a].map((v, i) => v + t * (cs[b][i] - v))));
  }
  return out;
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
    const q = outlinePixels(k, pts);
    if (q.length < 3) continue; // entirely behind the camera
    const xs = q.map((v) => v.x), ys = q.map((v) => v.y);
    const whole = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    const box = [Math.max(0, Math.min(...xs)), Math.max(0, Math.min(...ys)), Math.min(k.w, Math.max(...xs)), Math.min(k.h, Math.max(...ys))];
    const shown = box[2] > box[0] && box[3] > box[1] ? ((box[2] - box[0]) * (box[3] - box[1])) / whole : 0;
    if (box[2] <= box[0] || box[3] <= box[1]) continue; // off screen
    const area = ((box[2] - box[0]) * (box[3] - box[1])) / (k.w * k.h);
    if (shown < 0.35 && area < 0.15) continue; // enough of the spot in frame, or a big part of the frame (a rug around the camera)
    const score = Math.min(area, 0.25) * shown - Math.abs((box[0] + box[2]) / 2 / k.w - 0.5) * 0.1; // big, whole, roughly centred
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
