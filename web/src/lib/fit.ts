// Deterministic fit checks and placement search (the model proposes, code enforces).
// Shared by the browser and the API functions.
import type { FitResult, Placement, Product, Room, RoomObject, RoomState, Size } from "./types";

type Box = { x: number; z: number; w: number; d: number; yaw: number; y0: number; y1: number; id: string; label: string };
const ON_TOP = new Set(["lamp", "desk lamp", "plant", "decor", "monitor", "speaker"]); // may sit on furniture
const DOOR_CLEAR = 0.6; // keep 60 cm in front of the door free

export function objectBoxes(room: Room, state: RoomState): Box[] {
  return room.objects
    .filter((o) => !state.removed.includes(o.id))
    .map((o) => {
      const s = state.sizeEdits[o.id] ?? o.size;
      const y0 = Math.max(0, o.center[1] - o.size.h / 2);
      return { x: o.center[0], z: o.center[2], w: s.w, d: s.d, yaw: o.yaw, y0, y1: y0 + s.h, id: o.id, label: o.label };
    });
}

export function placementBoxes(state: RoomState, products: Map<string, Product>, skip?: string): Box[] {
  return state.placements.filter((p) => p.id !== skip).flatMap((p) => {
    const pr = products.get(p.productId);
    if (!pr?.size) return [];
    const y0 = p.y ?? 0;
    return [{ x: p.x, z: p.z, w: pr.size.w, d: pr.size.d, yaw: p.yaw, y0, y1: y0 + pr.size.h, id: p.id, label: pr.category }];
  });
}

function corners(b: { x: number; z: number; w: number; d: number; yaw: number }) {
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => {
    const lx = (i * b.w) / 2, lz = (j * b.d) / 2;
    return [b.x + lx * c + lz * s, b.z - lx * s + lz * c] as [number, number];
  });
}

/** Signed gap between two rotated rectangles along the separating axes (negative = overlap). */
function gap(a: Box | (Box & {}), b: Box): number {
  const ca = corners(a), cb = corners(b);
  let best = -Infinity;
  for (const poly of [ca, cb]) {
    for (let i = 0; i < 2; i++) {
      const [x1, z1] = poly[i], [x2, z2] = poly[i + 1];
      const nx = -(z2 - z1), nz = x2 - x1, len = Math.hypot(nx, nz);
      const pa = ca.map(([x, z]) => (x * nx + z * nz) / len), pb = cb.map(([x, z]) => (x * nx + z * nz) / len);
      best = Math.max(best, Math.min(...pb) - Math.max(...pa), Math.min(...pa) - Math.max(...pb));
    }
  }
  return best;
}

function doorZones(room: Room): Box[] {
  return room.shell.walls.flatMap((w) => w.openings.filter((o) => o.type === "door").map((o) => {
    const dx = w.b[0] - w.a[0], dz = w.b[1] - w.a[1], len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len, mid = (o.from + o.to) / 2;
    // inward normal of a counter-clockwise wall is (-uz, ux)
    const x = w.a[0] + ux * mid - uz * DOOR_CLEAR / 2, z = w.a[1] + uz * mid + ux * DOOR_CLEAR / 2;
    return { x, z, w: o.to - o.from, d: DOOR_CLEAR, yaw: Math.atan2(-uz, ux), y0: 0, y1: 2, id: "door-zone", label: "door" };
  }));
}

function entryCheck(room: Room, size: Size): FitResult | null {
  const door = room.shell.walls.flatMap((w) => w.openings).find((o) => o.type === "door");
  if (!door) return null;
  const [d1, d2] = [door.to - door.from, door.top - door.bottom].sort((p, q) => p - q);
  const [a, b] = [size.w, size.d, size.h].sort((p, q) => p - q); // carried in on its two smallest sides
  if (a > d1 || b > d2) return { status: "no", clearance_cm: null, reason_en: `Won't go through your ${Math.round(d1 * 100)} cm door`, reason_zh: `${Math.round(d1 * 100)} cm 的門搬不進來` };
  if (a > d1 - 0.03 || b > d2 - 0.03) return { status: "check", clearance_cm: null, reason_en: "Tight through the door", reason_zh: "進門很勉強" };
  return null;
}

export function checkFit(room: Room, state: RoomState, products: Map<string, Product>, p: Placement): FitResult {
  const pr = products.get(p.productId);
  if (!pr?.size) return { status: "check", clearance_cm: null, reason_en: "No size listed", reason_zh: "尺寸未標示" };
  const me: Box = { x: p.x, z: p.z, w: pr.size.w, d: pr.size.d, yaw: p.yaw, y0: p.y ?? 0, y1: (p.y ?? 0) + pr.size.h, id: p.id, label: pr.category };
  const hw = room.shell.width / 2, hd = room.shell.depth / 2;
  const wallGap = Math.min(...corners(me).map(([x, z]) => Math.min(hw - Math.abs(x), hd - Math.abs(z))));
  if (wallGap < -0.03) return { status: "no", clearance_cm: null, reason_en: "Goes through a wall here", reason_zh: "這裡會穿牆，放不下" };
  if (me.y1 > room.shell.height) return { status: "no", clearance_cm: null, reason_en: "Taller than your ceiling", reason_zh: "比天花板還高" };
  const entry = entryCheck(room, pr.size);
  if (entry?.status === "no") return entry;
  let nearest = Infinity; // spare space to other furniture; touching a wall is intended
  const others = [...objectBoxes(room, state), ...placementBoxes(state, products, p.id), ...doorZones(room)];
  const flat = pr.size.h <= 0.03; // a rug lies under furniture
  for (const o of others) {
    if (flat) break;
    const vertical = me.y0 >= o.y1 - 0.02 || o.y0 >= me.y1 - 0.02; // stacked, e.g. a lamp on the desk
    if (vertical) continue;
    const g = gap(me, o);
    if (g < -0.02) {
      const what = o.id === "door-zone" ? "the door's swing" : o.label;
      return { status: "no", clearance_cm: null, reason_en: `Overlaps ${what}`, reason_zh: o.id === "door-zone" ? "擋到開門" : `會撞到${o.label}` };
    }
    nearest = Math.min(nearest, Math.max(g, 0));
  }
  if (!Number.isFinite(nearest) || nearest > 1.5) { // nothing close by: no spare-space number to show
    if (entry) return entry;
    return pr.size_source === "estimated"
      ? { status: "check", clearance_cm: null, reason_en: "Fits (size estimated)", reason_zh: "放得下（尺寸為估計）" }
      : { status: "yes", clearance_cm: null, reason_en: "Fits", reason_zh: "放得下" };
  }
  const cm = Math.round(nearest * 100);
  if (entry) return { ...entry, clearance_cm: cm };
  if (pr.size_source === "estimated") return { status: "check", clearance_cm: cm, reason_en: `Fits, ${cm} cm spare (size estimated)`, reason_zh: `放得下・剩 ${cm} cm（尺寸為估計）` };
  if (cm < 3) return { status: "check", clearance_cm: cm, reason_en: `Very tight, ${cm} cm spare`, reason_zh: `很剛好・剩 ${cm} cm` };
  return { status: "yes", clearance_cm: cm, reason_en: `Fits, ${cm} cm spare`, reason_zh: `放得下・剩 ${cm} cm` };
}

/** Find a free spot: back against a wall (or on top of `near` for small items), closest to `near`. */
export function findSpot(room: Room, state: RoomState, products: Map<string, Product>, productId: string, near?: RoomObject): Placement | null {
  const pr = products.get(productId);
  if (!pr?.size) return null;
  const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const ns = near && (state.sizeEdits[near.id] ?? near.size); // the user's corrected size wins
  if (near && ns && ON_TOP.has(pr.category) && ns.w > pr.size.w && ns.d > pr.size.d) {
    const top = Math.max(0, near.center[1] - near.size.h / 2) + ns.h;
    const cand = { id, productId, x: near.center[0], z: near.center[2], y: top, yaw: near.yaw };
    if (checkFit(room, state, products, cand).status !== "no") return cand;
  }
  const hw = room.shell.width / 2, hd = room.shell.depth / 2;
  let best: { p: Placement; score: number } | null = null;
  for (const w of room.shell.walls) {
    const dx = w.b[0] - w.a[0], dz = w.b[1] - w.a[1], len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len, nx = -uz, nz = ux; // inward normal
    const yaw = Math.atan2(-uz, ux); // object's width along the wall, front facing into the room
    for (let t = pr.size.w / 2 + 0.02; t <= len - pr.size.w / 2 - 0.02; t += 0.05) {
      const x = w.a[0] + ux * t + nx * (pr.size.d / 2 + 0.01), z = w.a[1] + uz * t + nz * (pr.size.d / 2 + 0.01);
      if (Math.abs(x) > hw || Math.abs(z) > hd) continue;
      const cand = { id, productId, x, z, yaw };
      const fit = checkFit(room, state, products, cand);
      if (fit.status === "no") continue;
      const dist = near ? Math.hypot(x - near.center[0], z - near.center[2]) : 0;
      const score = dist - (fit.clearance_cm ?? 0) / 1000;
      if (!best || score < best.score) best = { p: cand, score };
    }
  }
  return best?.p ?? null;
}

/** Catalog categories that can stand in for an existing object (missing: nothing like it in the catalog yet). */
export const SWAP: Record<string, string[]> = {
  wardrobe: ["wardrobe", "cabinet"], cabinet: ["cabinet", "drawer unit", "nightstand"], shelf: ["shelf", "cabinet"],
  "storage box": ["storage box", "drawer unit"], "drawer unit": ["drawer unit", "cabinet", "storage box"], nightstand: ["nightstand", "drawer unit"],
  desk: ["desk"], table: ["desk"], chair: ["chair"], bed: ["bed frame"], bin: ["bin"], lamp: ["lamp", "floor lamp"], rug: ["rug"],
};

/** Stand a product where an existing object stands: same facing, its back where the old back was (so a piece
 *  against a wall stays against it). Check it with `obj` in `removed`. */
export function replaceSpot(state: RoomState, products: Map<string, Product>, obj: RoomObject, productId: string): Placement | null {
  const pr = products.get(productId);
  if (!pr?.size) return null;
  const k = (pr.size.d - (state.sizeEdits[obj.id] ?? obj.size).d) / 2;
  const y = Math.max(0, obj.center[1] - obj.size.h / 2);
  return { id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, productId, yaw: obj.yaw,
    x: obj.center[0] + Math.sin(obj.yaw) * k, z: obj.center[2] + Math.cos(obj.yaw) * k, ...(y > 0.03 ? { y } : {}) };
}

export const productMap =(list: Product[]) => new Map(list.map((p) => [p.id, p]));
