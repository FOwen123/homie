import { useEffect, useRef, useState } from "react";
import { LABEL_ZH, useLang, useT } from "../lib/i18n";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { collision, magnet, moveIn, withMoves } from "../lib/fit";
import type { Part, Pose, Product, Room, RoomState, Size } from "../lib/types";

export type ViewMode = "blocks" | "walk";
type Props = {
  room: Room; state: RoomState; products: Map<string, Product>; mode: ViewMode;
  selected: string | null; onSelect: (id: string | null) => void;
  onLabel?: (pos: { x: number; y: number } | null) => void; // screen position of the selected object's top
  onMove?: (id: string, pose: Pose) => void; // the user dragged or nudged a piece
};
type Edit = "move" | "rotate";
const RED = 0xd6453d;

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

export function RoomViewer({ room, state, products, mode, selected, onSelect, onLabel, onMove }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<{ pos: THREE.Vector3; target: THREE.Vector3; mode: ViewMode } | null>(null); // the camera survives room updates while it builds
  const api = useRef<{ rebuild: () => void; reset: () => void; hold: Hold; nudge: (h: Hold) => void; shift: (right: number, away: number, turn: number) => void } | null>(null);
  const t = useT();
  const { lang } = useLang();
  const [edit, setEdit] = useState<Edit>("move");
  const [hit, setHit] = useState<string | null>(null); // what the selected piece runs into
  const dimLabels = useRef<(HTMLSpanElement | null)[]>([]);
  const live = useRef({ state, products, mode, selected, onSelect, onLabel, onMove, edit, setHit });
  live.current = { state, products, mode, selected, onSelect, onLabel, onMove, edit, setHit };

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
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005; // without these, parts shadow themselves in stripes (shadow acne)
    sun.shadow.normalBias = 0.02;
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

    // Dimension lines (overview only): width along the near +z edge, depth along the +x edge, height up the
    // far +x/-z corner, each with extension lines and end ticks; labels are HTML pinned in the frame loop.
    const { width: W, depth: D, height: H } = room.shell, O = 0.25, T = 0.06;
    const seg: number[] = [];
    const line = (a: number[], b: number[]) => seg.push(...a, ...b);
    line([-W / 2, 0, D / 2 + O], [W / 2, 0, D / 2 + O]);
    line([W / 2 + O, 0, -D / 2], [W / 2 + O, 0, D / 2]);
    line([W / 2 + O, 0, -D / 2], [W / 2 + O, H, -D / 2]);
    for (const s of [-1, 1]) {
      line([(s * W) / 2, 0, D / 2], [(s * W) / 2, 0, D / 2 + O + T]);
      line([W / 2, 0, (s * D) / 2], [W / 2 + O + T, 0, (s * D) / 2]);
    }
    for (const y of [0, H]) line([W / 2 + O - T, y, -D / 2], [W / 2 + O + T, y, -D / 2]);
    const dimLines = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(seg, 3)),
      new THREE.LineBasicMaterial({ color: IRIS }));
    dimLines.position.y = 0.005; // just above the floor so it doesn't flicker
    scene.add(dimLines);
    const dimAt = [new THREE.Vector3(0, 0, D / 2 + O), new THREE.Vector3(W / 2 + O, 0, 0), new THREE.Vector3(W / 2 + O, H / 2, -D / 2)];

    // Move and rotate (like Rumi): floor arrows only, or the turning ring only; the piece turns red while it
    // runs into something, and lets go flush against a wall it ends up within 8 cm of.
    const gizmo = new TransformControls(camera, renderer.domElement);
    gizmo.setSpace("world");
    gizmo.setRotationSnap(Math.PI / 12);
    scene.add(gizmo.getHelper());
    const sizeOf = (id: string): Size | undefined => {
      const { state, products: pm } = live.current;
      const p = state.placements.find((x) => x.id === id);
      return p ? pm.get(p.productId)?.size : state.sizeEdits[id] ?? room.objects.find((o) => o.id === id)?.size;
    };
    const poseOf = (g: THREE.Object3D): Pose => {
      const f = new THREE.Vector3(0, 0, 1).applyQuaternion(g.quaternion); // the front is local +z
      return { x: g.position.x, z: g.position.z, yaw: Math.atan2(f.x, f.z) };
    };
    const check = (id: string, pose?: Pose) => {
      const { state, products: pm, setHit } = live.current;
      const st = pose ? moveIn(state, id, pose) : state;
      const h = collision(withMoves(room, st), st, pm, id);
      setHit(h);
      gizmo.object?.traverse((c) => { if (c instanceof THREE.LineSegments) (c.material as THREE.LineBasicMaterial).color.setHex(h ? RED : IRIS); });
    };
    gizmo.addEventListener("objectChange", () => { if (gizmo.object) check(gizmo.object.userData.id, poseOf(gizmo.object)); });
    gizmo.addEventListener("dragging-changed", (e) => {
      controls.enabled = !e.value;
      const g = gizmo.object, size = g && sizeOf(g.userData.id);
      if (!e.value && g && size) live.current.onMove?.(g.userData.id, magnet(room, poseOf(g), size));
    });

    const mats = new Map<string, THREE.MeshStandardMaterial>();
    const mat = (c: string) => mats.get(c) ?? mats.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.75 })).get(c)!;

    const rebuild = () => {
      const { state, products: pm, mode, selected } = live.current;
      blocks.clear();
      products.clear();
      if (mode !== lastMode) { lastMode = mode; home(); }
      for (const o of withMoves(room, state).objects) {
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
      const target = mode === "blocks" && live.current.onMove ? [...blocks.children, ...products.children].find((c) => c.userData.id === selected) : undefined;
      if (target) {
        const move = live.current.edit === "move";
        gizmo.attach(target);
        gizmo.setMode(move ? "translate" : "rotate");
        Object.assign(gizmo, { showX: move, showZ: move, showY: !move });
        check(target.userData.id);
      } else gizmo.detach();
    };

    // the keyframe taken nearest the middle of the room, facing into it
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
    let lastMode: ViewMode = "blocks";
    const home = () => {
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
    // around and forward walks.
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
        if (h.fwd) clampIn(camera.position.addScaledVector(look.clone().setY(0).normalize(), h.fwd * 1.2 * dt));
        controls.target.copy(camera.position).add(look);
      }
    };
    // Nudge buttons move the selected piece 5 cm left/right/away/closer as seen from the camera (snapped to
    // the room's axes) or turn it 15°, so phones don't need to grab the small arrows.
    const shift = (right: number, away: number, turn: number) => {
      const g = gizmo.object;
      if (!g) return;
      const f = new THREE.Vector3().subVectors(controls.target, camera.position).setY(0);
      const fw = Math.abs(f.x) > Math.abs(f.z) ? new THREE.Vector3(Math.sign(f.x), 0, 0) : new THREE.Vector3(0, 0, Math.sign(f.z));
      const pose = poseOf(g);
      live.current.onMove?.(g.userData.id, { x: pose.x + (away * fw.x - right * fw.z) * 0.05, z: pose.z + (away * fw.z + right * fw.x) * 0.05, yaw: pose.yaw + turn * (Math.PI / 12) });
    };
    api.current = { rebuild, reset: home, hold, nudge: (h) => step(h, 0.3), shift };
    home();
    if (view.current?.mode === live.current.mode) { // same viewer, newer room data: stay where the user was looking
      lastMode = view.current.mode;
      camera.position.copy(view.current.pos);
      controls.target.copy(view.current.target);
      controls.update();
    }
    rebuild();

    const ray = new THREE.Raycaster();
    let down: { x: number; y: number } | null = null, onGizmo = false;
    // the gizmo's own pointerdown runs first (registered earlier) and sets axis; by pointerup it is cleared
    const pointerDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; onGizmo = !!gizmo.axis; };
    const pointerUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return; // a drag, not a tap
      if (onGizmo) return; // a tap on the move arrows, not on the room
      const rect = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
      const hit = ray.intersectObjects([blocks, products].filter((g) => g.visible).flatMap((g) => g.children), true)[0]; // raycasts ignore .visible
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
      dimLines.visible = overview;
      dimAt.forEach((p, i) => {
        const label = dimLabels.current[i];
        if (!label) return;
        v.copy(p).project(camera);
        const x = ((v.x + 1) / 2) * el.clientWidth;
        const show = overview && v.z < 1 && x < el.clientWidth - 110; // keep clear of the move buttons on the right edge
        label.style.display = show ? "block" : "none";
        if (show) label.style.transform = `translate(${x}px, ${((1 - v.y) / 2) * el.clientHeight}px) translate(-50%, -50%)`;
      });
      const { selected, onLabel } = live.current;
      if (onLabel) {
        const g = [blocks, products].filter((x) => x.visible).flatMap((x) => x.children).find((c) => c.userData.id === selected);
        if (g) {
          const box = new THREE.Box3().setFromObject(g);
          v.set((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2).project(camera);
          onLabel(v.z < 1 ? { x: ((v.x + 1) / 2) * el.clientWidth, y: ((1 - v.y) / 2) * el.clientHeight } : null);
        } else onLabel(null);
      }
      renderer.render(scene, camera);
    });
    return () => {
      view.current = { pos: camera.position.clone(), target: controls.target.clone(), mode: live.current.mode };
      renderer.setAnimationLoop(null);
      ro.disconnect();
      controls.dispose();
      gizmo.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [room]);

  useEffect(() => { api.current?.rebuild(); }, [state, products, mode, selected, edit]);

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
  const fwdLabel = mode === "blocks" ? [t("zoomIn"), t("zoomOut")] : [t("forward"), t("back")];

  return (
    <div className="relative h-full w-full">
      <div ref={host} tabIndex={0} role="application" aria-label={`${t("viewerLabel")} ${t("keysHint")}`}
        onKeyDown={(e) => key(e, true)} onKeyUp={(e) => key(e, false)} onBlur={() => api.current && Object.assign(api.current.hold, { fwd: 0, turn: 0 })}
        className="relative h-full w-full touch-none rounded-[24px] focus-visible:outline-offset-[-4px]" />
      {[room.shell.width, room.shell.depth, room.shell.height].map((m, i) => (
        <span key={i} ref={(e) => { dimLabels.current[i] = e; }} aria-hidden
          className="num pointer-events-none absolute top-0 left-0 z-10 hidden whitespace-nowrap rounded-full border-[1.5px] border-iris bg-paper-white px-2.5 py-0.5 text-[13px] text-iris">
          {Math.round(m * 100)} cm
        </span>
      ))}
      <div className="absolute top-1/2 right-2 flex -translate-y-1/2 flex-col gap-0.5 rounded-full bg-paper-white/90 p-1 shadow-float" aria-label={t("moveControls")} role="group">
        <PadButton label={fwdLabel[0]} hold={{ fwd: 1 }} api={api}>{mode === "blocks" ? <><path d="M12 5v14" /><path d="M5 12h14" /></> : <path d="m6 15 6-6 6 6" />}</PadButton>
        <PadButton label={fwdLabel[1]} hold={{ fwd: -1 }} api={api}>{mode === "blocks" ? <path d="M5 12h14" /> : <path d="m6 9 6 6 6-6" />}</PadButton>
        <PadButton label={t("turnLeft")} hold={{ turn: -1 }} api={api}><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-2" /></PadButton>
        <PadButton label={t("turnRight")} hold={{ turn: 1 }} api={api}><path d="m15 14 5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h2" /></PadButton>
        <button onClick={() => api.current?.reset()} aria-label={t("reset")} title={t("reset")} className="grid h-11 w-11 place-items-center rounded-full text-graphite">
          <Icon><circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></Icon>
        </button>
      </div>
      {selected && mode === "blocks" && onMove && (
        <div role="group" aria-label={t("editPiece")} className="absolute top-3 right-3 flex flex-col items-end gap-1.5">
          <div className="flex rounded-full bg-paper-white/90 p-1 shadow-float">
            {(["move", "rotate"] as const).map((m) => (
              <button key={m} aria-pressed={edit === m} onClick={() => setEdit(m)}
                className={`min-h-9 rounded-full px-3 text-[13px] ${edit === m ? "bg-charcoal text-paper-white" : "text-graphite"}`}>{t(m)}</button>
            ))}
          </div>
          <div className="flex gap-0.5 rounded-full bg-paper-white/90 p-1 shadow-float">
            {(edit === "move"
              ? [[t("moveLeft"), -1, 0, 0, "m15 18-6-6 6-6"], [t("moveAway"), 0, 1, 0, "m6 15 6-6 6 6"], [t("moveCloser"), 0, -1, 0, "m6 9 6 6 6-6"], [t("moveRight"), 1, 0, 0, "m9 18 6-6-6-6"]]
              : [[t("turnLeft"), 0, 0, 1, "M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-2"], [t("turnRight"), 0, 0, -1, "m15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h2"]]
            ).map(([label, r, a, turn, d]) => (
              <button key={label as string} aria-label={label as string} title={label as string} onClick={() => api.current?.shift(r as number, a as number, turn as number)}
                className="grid h-9 w-9 place-items-center rounded-full text-ink active:bg-powder-blue"><Icon><path d={d as string} /></Icon></button>
            ))}
          </div>
          <span role="status" className={`rounded-full px-2.5 py-1 text-[12px] ${hit ? "bg-peach-wash text-fit-no" : "bg-mint-wash text-fit-yes"}`}>
            {!hit ? `✓ ${t("fitsHere")}` : hit === "door-zone" ? `✕ ${t("blocksDoor")}` : `✕ ${t("hits")} ${hit === "wall" ? t("theWall") : lang === "zh" ? LABEL_ZH[hit] ?? hit : hit}`}
          </span>
        </div>
      )}
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
