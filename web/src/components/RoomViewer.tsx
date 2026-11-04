import { useEffect, useRef } from "react";
import { useT } from "../lib/i18n";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Part, Product, Room, RoomState } from "../lib/types";

export type ViewMode = "blocks" | "walk" | "real";
type Props = {
  room: Room; roomUrl: string; state: RoomState; products: Map<string, Product>; mode: ViewMode;
  selected: string | null; onSelect: (id: string | null) => void;
  onLabel?: (pos: { x: number; y: number } | null) => void; // screen position of the selected object's top
};

const IRIS = 0x0069e0;
const WALL_T = 0.06;
const EYE = 1.55; // first-person eye height, m
type Hold = { fwd: number; turn: number }; // -1..1 each: back/forward, left/right

function partMesh(p: Part, mat: (c: string) => THREE.Material) {
  const g = p.shape === "cylinder"
    ? new THREE.CylinderGeometry(p.size[0] / 2, p.size[0] / 2, p.size[1], 24)
    : new THREE.BoxGeometry(...p.size);
  const m = new THREE.Mesh(g, mat(p.color));
  m.position.set(...p.pos);
  if (p.shape === "cylinder" && p.size[2] !== p.size[0]) m.scale.z = p.size[2] / p.size[0];
  m.castShadow = m.receiveShadow = true;
  return m;
}

function furniture(parts: Part[] | undefined, size: { w: number; d: number; h: number }, color: string, mat: (c: string) => THREE.Material) {
  const g = new THREE.Group();
  const list = parts?.length ? parts : [{ name: "body", shape: "box", size: [size.w, size.h, size.d], pos: [0, size.h / 2, 0], color } as Part];
  for (const p of list) g.add(partMesh(p, mat));
  return g;
}

function outline(size: { w: number; d: number; h: number }, color: number) {
  const e = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size.w + 0.02, size.h + 0.02, size.d + 0.02)),
    new THREE.LineBasicMaterial({ color }));
  e.position.y = size.h / 2;
  return e;
}

/** Wall segments around door and window openings: solid below and above each opening. */
function wallGroup(room: Room, wallColor: string) {
  const group = new THREE.Group();
  const H = room.shell.height;
  const mat = new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.95, transparent: true });
  for (const w of room.shell.walls) {
    const dx = w.b[0] - w.a[0], dz = w.b[1] - w.a[1], len = Math.hypot(dx, dz);
    const wall = new THREE.Group();
    wall.position.set(w.a[0], 0, w.a[1]);
    wall.rotation.y = Math.atan2(-dz, dx);
    const ops = [...w.openings].sort((a, b) => a.from - b.from);
    const pieces: [number, number, number, number][] = []; // from, to, bottom, top along the wall
    let t = 0;
    for (const o of ops) {
      if (o.from > t) pieces.push([t, o.from, 0, H]);
      if (o.bottom > 0.02) pieces.push([o.from, o.to, 0, o.bottom]);
      if (o.top < H - 0.02) pieces.push([o.from, o.to, o.top, H]);
      t = Math.max(t, o.to);
    }
    if (t < len) pieces.push([t, len, 0, H]);
    for (const [a, b, y0, y1] of pieces) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(b - a, y1 - y0, WALL_T), mat.clone());
      m.position.set((a + b) / 2, (y0 + y1) / 2, -WALL_T / 2); // wall thickness sits outside the room
      m.receiveShadow = true;
      wall.add(m);
    }
    for (const o of ops) { // a thin frame so openings read clearly
      const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(o.to - o.from, o.top - o.bottom, WALL_T)),
        new THREE.LineBasicMaterial({ color: o.type === "door" ? 0x535862 : IRIS }));
      frame.position.set((o.from + o.to) / 2, (o.bottom + o.top) / 2, -WALL_T / 2);
      wall.add(frame);
    }
    wall.userData = { normal: new THREE.Vector3(dz / len, 0, -dx / len) }; // outward normal of a counter-clockwise wall
    group.add(wall);
  }
  return group;
}

export function RoomViewer({ room, roomUrl, state, products, mode, selected, onSelect, onLabel }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ rebuild: () => void; reset: () => void; hold: Hold; nudge: (h: Hold) => void } | null>(null);
  const t = useT();
  const live = useRef({ state, products, mode, selected, onSelect, onLabel });
  live.current = { state, products, mode, selected, onSelect, onLabel };

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
        el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 100);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2.05;
    controls.minDistance = 1.2;
    controls.maxDistance = 14;

    scene.add(new THREE.HemisphereLight(0xffffff, 0xd8e4f0, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(2.5, 6, 3.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4 });
    scene.add(sun);

    const fin = room.finishes;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(room.shell.width, room.shell.depth),
      new THREE.MeshStandardMaterial({ color: fin?.floor ?? "#c9c4bb", roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    const walls = wallGroup(room, fin?.wall ?? "#f3efe6");
    const blocks = new THREE.Group();
    const products = new THREE.Group();
    scene.add(floor, walls, blocks, products);

    const mats = new Map<string, THREE.MeshStandardMaterial>();
    const mat = (c: string) => mats.get(c) ?? mats.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.75 })).get(c)!;

    // Realistic view: the splat lives in ARKit world space; world_to_room puts it in room coordinates.
    let splat: THREE.Object3D | null = null;
    let spark: THREE.Object3D | null = null;
    const loadSplat = async () => {
      if (splat) return;
      const { SparkRenderer, SplatMesh } = await import("@sparkjsdev/spark");
      spark = new SparkRenderer({ renderer }) as unknown as THREE.Object3D;
      scene.add(spark);
      const mesh = new SplatMesh({ url: `${roomUrl}/room.splat` }) as unknown as THREE.Object3D;
      const m = room.world_to_room;
      mesh.matrixAutoUpdate = false;
      mesh.matrix.set(...(m.flat() as [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number]));
      splat = mesh;
      scene.add(mesh);
    };

    const rebuild = () => {
      const { state, products: pm, mode, selected } = live.current;
      blocks.clear();
      products.clear();
      const real = mode === "real";
      if (mode !== lastMode) { lastMode = mode; home(); }
      if (real) void loadSplat();
      if (splat) splat.visible = real;
      floor.visible = walls.visible = blocks.visible = !real;
      for (const o of room.objects) {
        if (state.removed.includes(o.id)) continue;
        const size = state.sizeEdits[o.id] ?? o.size;
        const g = furniture(o.parts, size, "#b8b2a7", mat);
        if (state.sizeEdits[o.id]) g.scale.set(size.w / o.size.w, size.h / o.size.h, size.d / o.size.d);
        g.position.set(o.center[0], Math.max(0, o.center[1] - o.size.h / 2), o.center[2]);
        g.rotation.y = o.yaw;
        g.userData.id = o.id;
        if (selected === o.id) g.add(outline(size, IRIS));
        blocks.add(g);
      }
      for (const p of state.placements) {
        const pr = pm.get(p.productId);
        if (!pr?.size) continue;
        const g = furniture(pr.parts, pr.size, pr.color ?? "#d9cfc0", mat);
        g.position.set(p.x, p.y ?? 0, p.z);
        g.rotation.y = p.yaw;
        g.userData.id = p.id;
        if (!p.accepted || selected === p.id) g.add(outline(pr.size, IRIS));
        products.add(g);
      }
    };

    // Blocks: dollhouse view from above. Real: stand where the phone stood, facing into the room, so the
    // splat is seen from the inside like the video (from outside, a room capture looks like blobs).
    const bestKey = () => {
      let best = room.keyframes[0], score = -Infinity;
      for (const k of room.keyframes) {
        const M = k.cam_to_room, pos = new THREE.Vector3(M[0][3], M[1][3], M[2][3]);
        const fwd = new THREE.Vector3(-M[0][2], -M[1][2], -M[2][2]).setY(0).normalize();
        const s = fwd.dot(pos.clone().setY(0).negate().normalize()) - pos.clone().setY(0).length() * 0.3;
        if (s > score) { score = s; best = k; }
      }
      return best;
    };
    // walkable area: the wall polygon's bounds, kept 25 cm off the walls
    const xs = room.shell.walls.map((w) => w.a[0]), zs = room.shell.walls.map((w) => w.a[1]);
    const bounds = { x0: Math.min(...xs) + 0.25, x1: Math.max(...xs) - 0.25, z0: Math.min(...zs) + 0.25, z1: Math.max(...zs) - 0.25 };
    const clampIn = (p: THREE.Vector3) => p.set(THREE.MathUtils.clamp(p.x, bounds.x0, bounds.x1), EYE, THREE.MathUtils.clamp(p.z, bounds.z0, bounds.z1));
    const firstPerson = (pos: THREE.Vector3, fwd: THREE.Vector3, fov: number) => {
      camera.fov = fov;
      camera.updateProjectionMatrix();
      camera.position.copy(pos);
      controls.target.copy(pos).addScaledVector(fwd, 0.05);
      controls.minDistance = controls.maxDistance = 0.05;
      controls.enableZoom = controls.enablePan = false;
      controls.minPolarAngle = 0.35; // look up and down, but not straight at the ceiling or floor
      controls.maxPolarAngle = Math.PI - 0.35;
      controls.update();
    };
    // Walk in: step through the door (35 cm inside, facing into the room) at eye height. With no door,
    // stand where the phone stood (it was inside the room), facing the middle.
    const walk = () => {
      for (const w of room.shell.walls) {
        const d = w.openings.find((o) => o.type === "door");
        if (!d) continue;
        const dx = w.b[0] - w.a[0], dz = w.b[1] - w.a[1], len = Math.hypot(dx, dz), t = (d.from + d.to) / 2 / len;
        const inward = new THREE.Vector3(-dz / len, 0, dx / len); // minus the wall's outward normal
        return firstPerson(clampIn(new THREE.Vector3(w.a[0] + dx * t, 0, w.a[1] + dz * t).addScaledVector(inward, 0.35)), inward, 70);
      }
      const M = bestKey().cam_to_room;
      const pos = clampIn(new THREE.Vector3(M[0][3], 0, M[2][3]));
      const mid = new THREE.Vector3((bounds.x0 + bounds.x1) / 2, EYE, (bounds.z0 + bounds.z1) / 2);
      const fwd = mid.distanceTo(pos) > 0.5 ? mid.sub(pos).normalize() : new THREE.Vector3(-M[0][2], 0, -M[2][2]).normalize();
      firstPerson(pos, fwd, 70);
    };
    const inside = () => {
      const best = bestKey();
      // the splat is only sharp from where the phone was: use its exact pose and lens, and look around in place
      const M = best.cam_to_room;
      const pos = new THREE.Vector3(M[0][3], M[1][3], M[2][3]);
      const fwd = new THREE.Vector3(-M[0][2], -M[1][2], -M[2][2]).normalize();
      firstPerson(pos, fwd, (2 * Math.atan(best.h / 2 / best.fy) * 180) / Math.PI);
    };
    let lastMode: ViewMode = "blocks";
    const home = () => {
      if (live.current.mode === "real") return inside();
      if (live.current.mode === "walk") return walk();
      const r = Math.max(room.shell.width, room.shell.depth);
      camera.fov = 50;
      camera.updateProjectionMatrix();
      controls.enableZoom = controls.enablePan = true;
      controls.minPolarAngle = 0;
      controls.maxPolarAngle = Math.PI / 2.05;
      controls.maxDistance = 14;
      controls.minDistance = 1.2;
      camera.position.set(r * 0.9, r * 1.25, r * 1.1);
      controls.target.set(0, 0.6, 0);
      controls.update();
    };
    // Buttons and keys: in the overview, turn orbits and forward zooms; in first person, turn looks
    // around and forward walks (the Real view stays where the phone stood, so it only turns).
    // shortcut: walking passes through furniture (walls only), add object collisions if users get lost
    const hold: Hold = { fwd: 0, turn: 0 };
    const Y = new THREE.Vector3(0, 1, 0), look = new THREE.Vector3();
    const step = (h: Hold, dt: number) => {
      const mode = live.current.mode;
      if (mode === "blocks") {
        look.subVectors(camera.position, controls.target).applyAxisAngle(Y, h.turn * 1.2 * dt);
        look.setLength(THREE.MathUtils.clamp(look.length() * Math.exp(-h.fwd * 1.1 * dt), controls.minDistance, controls.maxDistance));
        camera.position.copy(controls.target).add(look);
      } else {
        look.subVectors(controls.target, camera.position).applyAxisAngle(Y, -h.turn * 1.6 * dt);
        if (mode === "walk" && h.fwd) clampIn(camera.position.addScaledVector(look.clone().setY(0).normalize(), h.fwd * 1.2 * dt));
        controls.target.copy(camera.position).add(look);
      }
    };
    api.current = { rebuild, reset: home, hold, nudge: (h) => step(h, 0.3) };
    home();
    rebuild();

    const ray = new THREE.Raycaster();
    let down: { x: number; y: number } | null = null;
    const pointerDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const pointerUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return; // a drag, not a tap
      const rect = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
      const hit = ray.intersectObjects([...blocks.children, ...products.children], true)[0];
      let o: THREE.Object3D | null = hit?.object ?? null;
      while (o && !o.userData.id) o = o.parent;
      live.current.onSelect(o?.userData.id ?? null);
    };
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointerup", pointerUp);

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const v = new THREE.Vector3();
    let last = performance.now();
    renderer.setAnimationLoop((now) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      if (hold.fwd || hold.turn) step(hold, dt);
      controls.update();
      // dollhouse: fade the walls between the camera and the room
      const overview = live.current.mode === "blocks";
      for (const w of walls.children) {
        const toCam = v.copy(camera.position).setY(0).normalize();
        const facing = overview && (w.userData.normal as THREE.Vector3).dot(toCam) > 0.2; // inside, every wall is solid
        for (const m of w.children) {
          if (m instanceof THREE.Mesh) (m.material as THREE.MeshStandardMaterial).opacity = facing ? 0.08 : 1;
          else m.visible = !facing; // opening frames on a faded wall would float in the room
        }
      }
      const { selected, onLabel } = live.current;
      if (onLabel) {
        const g = [...blocks.children, ...products.children].find((c) => c.userData.id === selected);
        if (g) {
          const box = new THREE.Box3().setFromObject(g);
          v.set((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2).project(camera);
          onLabel(v.z < 1 ? { x: ((v.x + 1) / 2) * el.clientWidth, y: ((1 - v.y) / 2) * el.clientHeight } : null);
        } else onLabel(null);
      }
      renderer.render(scene, camera);
    });
    return () => {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [room, roomUrl]);

  useEffect(() => { api.current?.rebuild(); }, [state, products, mode, selected]);

  const KEYS: Record<string, Partial<Hold>> = {
    ArrowUp: { fwd: 1 }, w: { fwd: 1 }, ArrowDown: { fwd: -1 }, s: { fwd: -1 },
    ArrowLeft: { turn: -1 }, a: { turn: -1 }, ArrowRight: { turn: 1 }, d: { turn: 1 },
  };
  const key = (e: React.KeyboardEvent, down: boolean) => {
    const k = KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (!k || !api.current) return;
    e.preventDefault();
    if (k.fwd) api.current.hold.fwd = down ? k.fwd : 0;
    if (k.turn) api.current.hold.turn = down ? k.turn : 0;
  };
  const canMove = mode !== "real";
  const fwdLabel = mode === "blocks" ? [t("zoomIn"), t("zoomOut")] : [t("forward"), t("back")];

  return (
    <div className="relative h-full w-full">
      <div ref={host} tabIndex={0} role="application" aria-label={`${t("viewerLabel")} ${t("keysHint")}`}
        onKeyDown={(e) => key(e, true)} onKeyUp={(e) => key(e, false)} onBlur={() => api.current && Object.assign(api.current.hold, { fwd: 0, turn: 0 })}
        className="h-full w-full touch-none rounded-[24px] focus-visible:outline-offset-[-4px]" />
      <div className="absolute top-1/2 right-2 flex -translate-y-1/2 flex-col gap-0.5 rounded-full bg-paper-white/90 p-1 shadow-float" aria-label={t("moveControls")} role="group">
        <PadButton label={fwdLabel[0]} hold={{ fwd: 1 }} api={api} disabled={!canMove}>{mode === "blocks" ? <><path d="M12 5v14" /><path d="M5 12h14" /></> : <path d="m6 15 6-6 6 6" />}</PadButton>
        <PadButton label={fwdLabel[1]} hold={{ fwd: -1 }} api={api} disabled={!canMove}>{mode === "blocks" ? <path d="M5 12h14" /> : <path d="m6 9 6 6 6-6" />}</PadButton>
        <PadButton label={t("turnLeft")} hold={{ turn: -1 }} api={api}><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-2" /></PadButton>
        <PadButton label={t("turnRight")} hold={{ turn: 1 }} api={api}><path d="m15 14 5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h2" /></PadButton>
        <button onClick={() => api.current?.reset()} aria-label={t("reset")} title={t("reset")} className="grid h-11 w-11 place-items-center rounded-full text-graphite">
          <Icon><circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></Icon>
        </button>
      </div>
    </div>
  );
}

function Icon({ children }: { children: React.ReactNode }) {
  return <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
}

/** Press and hold to keep moving; Enter or Space (click with no pointer) moves one step. */
function PadButton({ label, hold, api, disabled, children }: {
  label: string; hold: Partial<Hold>; disabled?: boolean; children: React.ReactNode;
  api: React.RefObject<{ hold: Hold; nudge: (h: Hold) => void } | null>;
}) {
  const set = (on: boolean) => { if (api.current) Object.assign(api.current.hold, on ? hold : { fwd: 0, turn: 0 }); };
  return (
    <button aria-label={label} title={label} disabled={disabled}
      onPointerDown={(e) => { e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId); set(true); }} // focus first: the viewer's blur clears the hold
      onPointerUp={() => set(false)} onPointerCancel={() => set(false)}
      onClick={(e) => { if (e.detail === 0) api.current?.nudge({ fwd: 0, turn: 0, ...hold }); }}
      className="grid h-11 w-11 touch-none place-items-center rounded-full text-ink active:bg-powder-blue disabled:text-fog/40">
      <Icon>{children}</Icon>
    </button>
  );
}
