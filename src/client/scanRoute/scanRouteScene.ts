/**
 * The scan view's 3D scene (plan 1.3.3 R-4): the system from above — each body at its place, its orbit as a ring round
 * what it orbits, the route as a line with numbered stops, and the bodies the honk counted but nobody scanned as grey
 * "?" on an outer ring. three.js; drag to pan, right drag to tilt.
 *
 * Two scales (owner, 2026-10-30: "the system map has those squares … 1 ls, 10 ls, 100 ls … depending on the zoom-out
 * level. The further back you are zoomed out, the faster it zooms in to your mouse"):
 * - **true**: light-seconds as they are, under a grid of squares whose size follows the zoom (1 ls to 100,000 ls, every
 *   tenth line brighter, the size in the corner); the wheel zooms to the mouse, by more a notch the further out; the
 *   bodies keep their size on screen, so a moon a light-second out is there next to a companion 100,000 ls away, and
 *   a name shows once its orbit is big enough on screen to tell it apart (route stops always);
 * - **compact**: each orbit on a log scale per level (orbitPositions.ts `systemViewPositions`), everything at once.
 */
import * as THREE from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { ScanRouteBodyDTO, ScanRouteDTO } from "@shared/dto/routeSystem.js";

export type ScanScale = "true" | "compact";

/** Star colours by the first letter of the type; neutron stars and white dwarfs by theirs. */
function starColour(cls: string | null): number {
  const c = (cls ?? "").toUpperCase();
  if (c.startsWith("N")) return 0x9fd8ff;
  if (c.startsWith("D")) return 0xe8f1ff;
  if (c.startsWith("H")) return 0x222222;
  const by: Record<string, number> = { O: 0x9bb0ff, B: 0xaabfff, A: 0xcad7ff, F: 0xf8f7ff, G: 0xfff4ea, K: 0xffd2a1, M: 0xffb06b, L: 0xff8a5c, T: 0xd06a4a, Y: 0x9a4a3a, W: 0xb9c8ff };
  return by[c[0] ?? ""] ?? 0xffe0a0;
}

function planetColour(cls: string | null): number {
  const c = (cls ?? "").toLowerCase();
  if (c.includes("earth")) return 0x3fa9f5;
  if (c.includes("water world")) return 0x2f6fe0;
  if (c.includes("ammonia")) return 0xc9a14a;
  if (c.includes("gas giant")) return 0xd99a5b;
  if (c.includes("icy")) return 0xdfe9f2;
  if (c.includes("rocky ice")) return 0xb8c4cf;
  if (c.includes("metal rich")) return 0x9a8f86;
  if (c.includes("high metal")) return 0xb08a68;
  return 0xa8927a;
}

/** Drawn size in the compact view (its units), and in pixels in the true one; a moon smaller than a planet. */
function bodySize(b: ScanRouteBodyDTO): number {
  if (b.kind === "star") return 1.4;
  const c = (b.cls ?? "").toLowerCase();
  if (c.includes("gas giant")) return b.moon ? 0.6 : 0.9;
  return b.moon ? 0.35 : 0.55;
}
/** Pixels on screen for a body of size 1 in the true view. */
const PX_PER_SIZE = 7;
/** A name shows in the true view once its orbit is this many pixels across (route stops always). */
const LABEL_MIN_PX = 28;
/** The grid's squares: 1 ls to 100,000 ls. */
const GRID_MIN = 1;
const GRID_MAX = 100_000;

const TARGET_COLOUR = { dss: "#40d9cc", bio: "#5ce675", both: "#ffd166", codex: "#c792ff" } as const;

export interface ScanRouteScene {
  show(d: ScanRouteDTO, scale: ScanScale): void;
  /** Nothing shown (a system loading). */
  clear(): void;
  /** Frame every body. */
  fit(): void;
  /** Centre on a body, close enough to see what orbits it. */
  focus(id: number): void;
  dispose(): void;
}

type Drawn = {
  id: number;
  mesh: THREE.Mesh;
  halo: THREE.Mesh | null;
  size: number;
  label: CSS2DObject | null;
  /** Route stops keep their names at any zoom. */
  stop: boolean;
  /** The orbit's size (scene units): the name shows once it is big enough on screen. */
  orbit: number;
};

export function createScanRouteScene(
  host: HTMLElement,
  onPick: (id: number) => void,
  onGrid?: (lsPerSquare: number | null) => void,
): ScanRouteScene {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, logarithmicDepthBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x05070c);
  host.appendChild(renderer.domElement);
  const labels = new CSS2DRenderer();
  labels.domElement.className = "scan-route-labels";
  host.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1e7);
  camera.up.set(0, 0, 1);
  camera.position.set(0, 0, 120);
  const controls = new MapControls(camera, renderer.domElement);
  controls.screenSpacePanning = true;
  controls.maxPolarAngle = Math.PI / 2.2;
  controls.enableDamping = false;
  // The wheel is ours: to the mouse, faster the further out (below).
  controls.enableZoom = false;

  const group = new THREE.Group();
  const grid = new THREE.Group();
  scene.add(grid, group);
  let mode: ScanScale = "true";
  let bounds = 40;
  let shownKey = "";
  let drawn: Drawn[] = [];
  let shownData: ScanRouteDTO | null = null;
  const meshes = new Map<THREE.Object3D, number>();

  const camDist = () => camera.position.distanceTo(controls.target);
  /** Scene units per pixel at the target's depth. */
  const unitsPerPx = () => (2 * camDist() * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, host.clientHeight);

  /** The grid of squares round the target, its size chosen for about eight to eighty squares across the view. */
  let gridSize = 0;
  let gridAt = new THREE.Vector2(NaN, NaN);
  function drawGrid(): void {
    if (mode !== "true") {
      if (grid.children.length) clearGroup(grid);
      onGrid?.(null);
      return;
    }
    const across = unitsPerPx() * Math.max(host.clientWidth, host.clientHeight);
    const step = Math.min(GRID_MAX, Math.max(GRID_MIN, 10 ** Math.floor(Math.log10(Math.max(1e-9, across / 8)))));
    const t = controls.target;
    // Redrawn when the size changes or the view has moved a fair way.
    if (step === gridSize && Math.hypot(t.x - gridAt.x, t.y - gridAt.y) < across / 4) return;
    gridSize = step;
    gridAt = new THREE.Vector2(t.x, t.y);
    clearGroup(grid);
    const half = across * 1.5;
    const minor: number[] = [];
    const major: number[] = [];
    const x0 = Math.floor((t.x - half) / step);
    const x1 = Math.ceil((t.x + half) / step);
    const y0 = Math.floor((t.y - half) / step);
    const y1 = Math.ceil((t.y + half) / step);
    for (let i = x0; i <= x1; i++) (i % 10 === 0 ? major : minor).push(i * step, y0 * step, -0.001, i * step, y1 * step, -0.001);
    for (let j = y0; j <= y1; j++) (j % 10 === 0 ? major : minor).push(x0 * step, j * step, -0.001, x1 * step, j * step, -0.001);
    const lines = (pts: number[], colour: number, opacity: number) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      grid.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity })));
    };
    lines(minor, 0x1a2234, 0.55);
    lines(major, 0x2b3a58, 0.9);
    onGrid?.(step);
  }

  /** Bodies at their size on screen, names where their orbit is big enough to tell apart (the true view). */
  function scaleToZoom(): void {
    if (mode !== "true") return;
    const upp = unitsPerPx();
    for (const d of drawn) {
      const s = d.size * PX_PER_SIZE * upp;
      d.mesh.scale.setScalar(s);
      d.halo?.scale.setScalar(s);
      if (d.label) d.label.visible = d.stop || d.orbit / upp >= LABEL_MIN_PX || d.orbit === 0;
    }
  }

  // Drawn when something moves (the camera, the bodies, the window), not every frame: the tab costs nothing idle.
  let frame = 0;
  const render = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      drawGrid();
      scaleToZoom();
      renderer.render(scene, camera);
      labels.render(scene, camera);
    });
  };
  controls.addEventListener("change", render);

  const resize = () => {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    renderer.setSize(w, h);
    labels.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    gridSize = 0;
    render();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  const ndc = (e: { clientX: number; clientY: number }) => {
    const r = renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  };
  const raycaster = new THREE.Raycaster();
  const onClick = (e: MouseEvent) => {
    raycaster.setFromCamera(ndc(e), camera);
    const hit = raycaster.intersectObjects([...meshes.keys()], false)[0];
    if (hit) onPick(meshes.get(hit.object)!);
  };
  renderer.domElement.addEventListener("click", onClick);

  /*
    The wheel: towards the point under the mouse on the system's plane, by a factor a notch. The factor grows with how
    far out the camera is (owner: "the further back you are zoomed out, the faster it zooms in to your mouse"): from
    1.15 a notch close in to about 1.6 at a hundred thousand light-seconds.
  */
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    raycaster.setFromCamera(ndc(e), camera);
    const p = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, p)) p.copy(controls.target);
    const dist = camDist();
    const notch = 0.15 + 0.09 * Math.max(0, Math.log10(Math.max(1, dist / 20)));
    const ticks = Math.max(-3, Math.min(3, e.deltaY / 100));
    let k = (1 + notch) ** ticks;
    // Not past a light-second's view, nor out past the whole system three times over.
    const far = Math.max(60, bounds * 6);
    k = Math.max(0.5 / dist, Math.min(far / dist, k));
    camera.position.sub(p).multiplyScalar(k).add(p);
    controls.target.sub(p).multiplyScalar(k).add(p);
    controls.update();
    render();
  };
  renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

  function clearGroup(g: THREE.Group): void {
    for (const o of [...g.children]) {
      g.remove(o);
      o.traverse((x) => {
        if (x instanceof CSS2DObject) x.element.remove();
        const m = x as THREE.Mesh;
        m.geometry?.dispose?.();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((q) => q.dispose());
        else mat?.dispose?.();
      });
    }
  }
  const clear = () => {
    clearGroup(group);
    meshes.clear();
    drawn = [];
  };

  const label = (text: string, cls: string, at: THREE.Vector3) => {
    const el = document.createElement("div");
    el.className = cls;
    el.textContent = text;
    const o = new CSS2DObject(el);
    o.position.copy(at);
    // Under the body, whatever its size on screen.
    o.center.set(0.5, -0.4);
    group.add(o);
    return o;
  };

  const flat = (p: { x: number; y: number }) => new THREE.Vector3(p.x, p.y, 0);
  /** Where the scale draws a body, and what it orbits. */
  const placeOf = (b: ScanRouteBodyDTO) => (mode === "true" ? flat(b.pos) : flat(b.viewPos));
  const centreOf = (b: ScanRouteBodyDTO) => {
    const c = mode === "true" ? b.parentPos : b.ringCentre;
    return c ? flat(c) : null;
  };

  function fit() {
    camera.position.set(0, 0, Math.max(mode === "true" ? 2 : 30, bounds * 2.4));
    controls.target.set(0, 0, 0);
    camera.up.set(0, 0, 1);
    camera.lookAt(0, 0, 0);
    controls.update();
    gridSize = 0;
    render();
  }

  function focus(id: number) {
    const b = shownData?.bodies.find((x) => x.id === id);
    if (!b) return;
    const at = placeOf(b);
    // Its own moons in view, and what it orbits at the edge: the widest orbit round it, or its own orbit.
    const kids = shownData!.bodies.filter((x) => x.parentId === b.id).map((x) => placeOf(x).distanceTo(at));
    const c = centreOf(b);
    const own = c ? c.distanceTo(at) : 0;
    const span = Math.max(kids.length ? Math.max(...kids) * 1.3 : own * 0.7, mode === "true" ? 1 : 3);
    camera.position.set(at.x, at.y, span * 3);
    controls.target.copy(at);
    camera.up.set(0, 0, 1);
    camera.lookAt(at);
    controls.update();
    gridSize = 0;
    render();
  }

  function show(d: ScanRouteDTO, scale: ScanScale) {
    const modeChanged = scale !== mode;
    mode = scale;
    shownData = d;
    clear();
    let far = mode === "true" ? 1 : 10;
    const ringMat = new THREE.LineBasicMaterial({ color: 0x2a3550, transparent: true, opacity: 0.85 });
    const sphere = new THREE.SphereGeometry(1, 20, 14);
    for (const b of d.bodies) {
      const at = placeOf(b);
      far = Math.max(far, Math.hypot(at.x, at.y));
      // The orbit: a circle round what it orbits, through the body (seen from above).
      const c = centreOf(b);
      const r = c ? Math.hypot(at.x - c.x, at.y - c.y) : 0;
      if (c && r > 0) {
        const pts = Array.from({ length: 129 }, (_, k) => {
          const a = (k / 128) * Math.PI * 2;
          return new THREE.Vector3(c.x + r * Math.cos(a), c.y + r * Math.sin(a), 0);
        });
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), ringMat));
      }
      const size = bodySize(b);
      const mesh = new THREE.Mesh(
        mode === "true" ? sphere : new THREE.SphereGeometry(size, 20, 14),
        new THREE.MeshBasicMaterial({
          color: b.kind === "star" ? starColour(b.cls) : planetColour(b.cls),
          transparent: b.mapped,
          opacity: b.mapped ? 0.45 : 1,
        }),
      );
      mesh.position.copy(at);
      group.add(mesh);
      meshes.set(mesh, b.id);
      let halo: THREE.Mesh | null = null;
      if (b.target) {
        const k = mode === "true" ? 1 : size;
        halo = new THREE.Mesh(
          new THREE.RingGeometry(k * 1.5, k * 1.5 + (mode === "true" ? 0.3 : 0.18), 32),
          new THREE.MeshBasicMaterial({ color: TARGET_COLOUR[b.target], side: THREE.DoubleSide }),
        );
        halo.position.copy(at);
        group.add(halo);
      }
      const near = d.route.order.indexOf(b.id);
      // Compact: moons named only on the route (they crowd their planet); true: by their size on screen (scaleToZoom).
      let lab: CSS2DObject | null = null;
      if (mode === "true" || !b.moon || near >= 0)
        lab = label(
          (near >= 0 ? `${near + 1}. ` : "") + b.short,
          `scan-route-label scan-route-label--${b.target ?? (b.kind === "star" ? "star" : "plain")}`,
          mode === "true" ? at : at.clone().add(new THREE.Vector3(0, -size - 0.4, 0)),
        );
      drawn.push({ id: b.id, mesh, halo, size, label: lab, stop: near >= 0, orbit: 2 * r });
    }
    // The route: from the arrival star through the stops in order.
    const start = d.bodies.find((b) => b.id === d.startId);
    const stops = d.route.order.map((id) => d.bodies.find((b) => b.id === id)).filter((b): b is ScanRouteBodyDTO => !!b);
    if (start && stops.length) {
      const pts = [start, ...stops].map((b) => placeOf(b).setZ(mode === "true" ? 0 : 0.05));
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xff9e33 })));
    }
    // Bodies the honk counted and nobody has scanned: on a ring outside the system, filling in as they are found.
    const missing = d.bodyCount.missing;
    const ring = mode === "true" ? far * 1.15 + 1 : far + 6;
    for (let k = 0; k < missing; k++) {
      const a = (k / Math.max(1, missing)) * Math.PI * 2 + 0.3;
      const at = new THREE.Vector3(ring * Math.cos(a), ring * Math.sin(a), 0);
      const m = new THREE.Mesh(mode === "true" ? sphere : new THREE.SphereGeometry(0.45, 12, 8), new THREE.MeshBasicMaterial({ color: 0x55606f }));
      m.position.copy(at);
      group.add(m);
      const lab = label("?", "scan-route-label scan-route-label--missing", mode === "true" ? at : at.clone().add(new THREE.Vector3(0, -0.9, 0)));
      drawn.push({ id: -1, mesh: m, halo: null, size: 0.45, label: lab, stop: true, orbit: 0 });
    }
    // Framed again for another system or scale, or when this one grew or shrank a good deal.
    const key = `${d.addr}|${mode}`;
    const grew = Math.abs(far + 8 - bounds) > bounds * 0.25;
    bounds = mode === "true" ? far * 1.25 : far + 8;
    if (key !== shownKey || modeChanged || grew) fit();
    shownKey = key;
    gridSize = 0;
    render();
  }

  return {
    show,
    clear() {
      clear();
      render();
    },
    fit,
    focus,
    dispose() {
      cancelAnimationFrame(frame);
      ro.disconnect();
      controls.removeEventListener("change", render);
      renderer.domElement.removeEventListener("click", onClick);
      renderer.domElement.removeEventListener("wheel", onWheel);
      clear();
      clearGroup(grid);
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      labels.domElement.remove();
    },
  };
}
