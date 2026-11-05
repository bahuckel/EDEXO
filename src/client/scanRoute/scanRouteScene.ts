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
import { SHIP_NEAR_LS, type ScanRouteBodyDTO, type ScanRouteDTO } from "@shared/dto/routeSystem.js";

export type ScanScale = "true" | "compact";
/** Which bodies are named (owner, 2026-11-05): every one (as the zoom allows), the route's stops, or the next stop. */
export type ScanNames = "all" | "route" | "next";

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

/** The ship in the shown system (plan 1.3.5 R-1): the body it is at, the body targeted, the netlog's or the HUD's fix. */
export interface ShipMark {
  atId: number | null;
  atFrom?: "journal" | "netlog" | null;
  targetId: number | null;
  /** The route's next stop: a target that is not it gets a dotted line of its own (owner 2026-11-05). */
  nextInLine?: number | null;
  fix: { refId: number; distLs: number } | null;
}

type P3 = { x: number; y: number; z: number };
/** A place both views can draw: in light-seconds (the true view; 3D) and in the compact view's units. */
export interface ShipSpot {
  pos: P3;
  view: P3;
}
/**
 * The way the ship is flying, from the HUD's distance (or the netlog measuring from the target): from `from` to the
 * target, `t` (0-1) of the way along. `atId` is the body the ship was put at when it began.
 */
export interface ShipLeg {
  addr: string;
  targetId: number;
  atId: number | null;
  from: ShipSpot;
  /** The body the leg began at; null when it began on the way (another target picked in flight). */
  fromId: number | null;
  t: number;
}

const mix = (a: P3, b: P3, t: number): P3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
/** Where a leg has got to. */
export const legSpot = (leg: ShipLeg, to: ShipSpot): ShipSpot => ({ pos: mix(leg.from.pos, to.pos, leg.t), view: mix(leg.from.view, to.view, leg.t) });

/**
 * The ship's leg after a new word on it (owner, 2026-11-05: overshooting, the target off the screen, the ship jumped to
 * another body "instead of using the last known real location"):
 * - the distance to the target moves it on along the leg, never back (passing the target holds it there);
 * - no distance (the target off the screen, a frame not read) keeps it where it was;
 * - the netlog passing near another body does not move it (it measures from barycentres too); reaching the target, or
 *   a journal event putting the ship at a body, ends the leg (the ship is at that body);
 * - another target starts a new leg from where the ship is, not from a body.
 * `spot` gives a body's place; `base` is the body the ship is at without a leg.
 */
export function nextLeg(
  prev: ShipLeg | null,
  ship: { addr: string; atId: number | null; atFrom?: "journal" | "netlog" | null; targetId: number | null; distLs: number | null },
  spot: (id: number) => ShipSpot | null,
  base: number | null,
): ShipLeg | null {
  let leg = prev && prev.addr === ship.addr ? prev : null;
  if (leg && (ship.atId === leg.targetId || (ship.atFrom === "journal" && ship.atId !== leg.atId))) leg = null;
  const to = ship.targetId != null ? spot(ship.targetId) : null;
  if (!to || ship.targetId === base) return leg;
  if (!leg || leg.targetId !== ship.targetId) {
    const prevTo = leg ? spot(leg.targetId) : null;
    const from = leg && prevTo ? legSpot(leg, prevTo) : base != null ? spot(base) : null;
    if (!from) return null;
    const fromId = leg && prevTo ? (leg.t === 0 ? leg.fromId : null) : base;
    leg = { addr: ship.addr, targetId: ship.targetId!, atId: ship.atId, from, fromId, t: 0 };
  }
  if (ship.distLs != null) {
    const len = Math.hypot(to.pos.x - leg.from.pos.x, to.pos.y - leg.from.pos.y, to.pos.z - leg.from.pos.z);
    const t = len > 0 ? Math.max(0, Math.min(1, 1 - ship.distLs / len)) : 1;
    if (t > leg.t) leg = { ...leg, t };
  }
  return leg;
}

export interface ScanRouteScene {
  show(d: ScanRouteDTO, scale: ScanScale): void;
  /** The ship's mark, and a line to the body targeted; null: none (another system shown). */
  setShip(m: ShipMark | null): void;
  /** Nothing shown (a system loading). */
  clear(): void;
  /** Frame every body. */
  fit(): void;
  /** Centre on a body, close enough to see what orbits it. */
  focus(id: number): void;
  /**
   * Keep a body and the ship framed together (null: stop), easing the view over as the ship closes in; the commander
   * panning or zooming the view pauses it until another body is followed.
   */
  follow(id: number | null): void;
  /** Which names show, and the next stop's id (for "next"). */
  setNames(names: ScanNames, nextId: number | null): void;
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
  /** The body under the pointer, or null when it left them all (plan 1.3.4 S-8: its facts while hovered). */
  onHover?: (id: number | null) => void,
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
  // The ship: its own group, drawn again when it moves without drawing the system again.
  const shipGroup = new THREE.Group();
  scene.add(grid, group, shipGroup);
  let ship: ShipMark | null = null;
  /** The way the ship is flying to the target (nextLeg). */
  let leg: ShipLeg | null = null;
  /** The ship's arrow and the line it travels, to turn the arrow towards the target as the view turns. */
  let shipArrow: { el: HTMLElement; from: THREE.Vector3; to: THREE.Vector3 } | null = null;
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

  let names: ScanNames = "all";
  let nextId: number | null = null;
  /**
   * Bodies at their size on screen (the true view), and the names: where their orbit is big enough to tell apart (route
   * stops always), and only the route's or the next stop's when asked.
   */
  function scaleToZoom(): void {
    const upp = unitsPerPx();
    for (const d of drawn) {
      if (mode === "true") {
        const s = d.size * PX_PER_SIZE * upp;
        d.mesh.scale.setScalar(s);
        d.halo?.scale.setScalar(s);
      }
      if (!d.label) continue;
      const fits = mode !== "true" || d.stop || d.orbit / upp >= LABEL_MIN_PX || d.orbit === 0;
      const wanted = names === "all" || (names === "route" ? d.stop : d.id === nextId);
      d.label.visible = fits && wanted;
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
      turnArrow();
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
  // Once a frame at most, and only when the body under the pointer changes; not while dragging the view.
  let hovered: number | null = null;
  let hoverFrame = 0;
  const setHovered = (id: number | null) => {
    if (id === hovered) return;
    hovered = id;
    renderer.domElement.style.cursor = id == null ? "" : "pointer";
    onHover?.(id);
  };
  const onMove = (e: PointerEvent) => {
    if (e.buttons || hoverFrame) return;
    const at = { clientX: e.clientX, clientY: e.clientY };
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = 0;
      raycaster.setFromCamera(ndc(at), camera);
      const hit = raycaster.intersectObjects([...meshes.keys()], false)[0];
      setHovered(hit ? meshes.get(hit.object)! : null);
    });
  };
  const onLeave = () => {
    cancelAnimationFrame(hoverFrame);
    hoverFrame = 0;
    setHovered(null);
  };
  renderer.domElement.addEventListener("pointermove", onMove);
  renderer.domElement.addEventListener("pointerleave", onLeave);

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

  /** How far round a body to show: its own moons, or what it orbits at the edge. */
  function spanOf(b: ScanRouteBodyDTO): number {
    const at = placeOf(b);
    const kids = shownData!.bodies.filter((x) => x.parentId === b.id).map((x) => placeOf(x).distanceTo(at));
    const c = centreOf(b);
    const own = c ? c.distanceTo(at) : 0;
    return Math.max(kids.length ? Math.max(...kids) * 1.3 : own * 0.7, mode === "true" ? 1 : 3);
  }

  function focus(id: number) {
    const b = shownData?.bodies.find((x) => x.id === id);
    if (!b) return;
    // The commander chose where to look: following waits for the next body.
    followPaused = true;
    const at = placeOf(b);
    const span = spanOf(b);
    camera.position.set(at.x, at.y, span * 3);
    controls.target.copy(at);
    camera.up.set(0, 0, 1);
    camera.lookAt(at);
    controls.update();
    gridSize = 0;
    render();
  }

  /*
    Following (owner, 2026-11-05: "the zoom in should always include the player as well, and gradually zoom in to the
    location, keeping the player on the screen"): the body and the ship framed together from above, with room round
    them, never closer than focusing on the body alone; eased there over about half a second, so each new place of the
    ship (four a second in supercruise) slides the view rather than jumping it.
  */
  let followId: number | null = null;
  let followPaused = false;
  let shipAt: THREE.Vector3 | null = null;
  let glide = 0;
  const FOLLOW_MS = 450;
  function followFrame(): void {
    if (followId == null || followPaused || !shownData) return;
    const b = shownData.bodies.find((x) => x.id === followId);
    if (!b) return;
    const at = placeOf(b);
    let centre = at;
    let dist = spanOf(b) * 3;
    if (shipAt) {
      centre = at.clone().add(shipAt).multiplyScalar(0.5);
      const aspect = Math.max(0.2, host.clientWidth / Math.max(1, host.clientHeight));
      const half = Math.max(Math.abs(at.y - shipAt.y) / 2, Math.abs(at.x - shipAt.x) / 2 / aspect);
      dist = Math.max(dist, (half * 1.45) / Math.tan((camera.fov * Math.PI) / 360));
    }
    const goal = new THREE.Vector3(centre.x, centre.y, dist);
    // Close enough already: no glide for a hair's move.
    if (goal.distanceTo(camera.position) < dist * 0.01 && Math.abs(controls.target.x - centre.x) + Math.abs(controls.target.y - centre.y) < dist * 0.01) return;
    const fromPos = camera.position.clone();
    const fromTarget = controls.target.clone();
    const toTarget = new THREE.Vector3(centre.x, centre.y, 0);
    const t0 = performance.now();
    cancelAnimationFrame(glide);
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / FOLLOW_MS);
      const e = 1 - (1 - k) ** 3;
      camera.position.lerpVectors(fromPos, goal, e);
      controls.target.lerpVectors(fromTarget, toTarget, e);
      camera.up.set(0, 0, 1);
      camera.lookAt(controls.target);
      controls.update();
      gridSize = 0;
      render();
      glide = k < 1 ? requestAnimationFrame(step) : 0;
    };
    glide = requestAnimationFrame(step);
  }
  // The commander's own pan, tilt or wheel pauses following (the glide's own moves come through controls.update).
  const pauseFollow = () => {
    if (followId == null) return;
    followPaused = true;
    cancelAnimationFrame(glide);
  };
  renderer.domElement.addEventListener("pointerdown", pauseFollow);
  renderer.domElement.addEventListener("wheel", pauseFollow, { passive: true });

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
    // The route: from the arrival star (or the body the ship is at) through the stops in order.
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
    drawShip();
    render();
  }

  /*
    The ship: at the body the journal or the netlog last put it near (else where the route starts). With a fix from the
    target (the HUD's distance to it, or the netlog measuring from it): on its leg to the target (nextLeg), from where
    it was, never back, held where it was when the fix is lost; else at the netlog's body only when near it and no leg
    has moved it. The fix's direction is in the game's axes, which the orbits' are not (plan 1.3.5 R-1), so only the
    distance is used. A line runs on to the body targeted, the arrow pointing along it.
  */
  function drawShip(): void {
    clearGroup(shipGroup);
    shipArrow = null;
    shipAt = null;
    const d = shownData;
    if (!ship || !d) return;
    const byId = (id: number | null) => (id == null ? undefined : d.bodies.find((b) => b.id === id));
    const base = byId(ship.atId) ?? byId(d.startId);
    const spot = (id: number): ShipSpot | null => {
      const b = byId(id);
      return b ? { pos: b.pos, view: b.viewPos } : null;
    };
    const ref = ship.fix ? byId(ship.fix.refId) : undefined;
    leg = nextLeg(
      leg,
      { addr: d.addr, atId: ship.atId, atFrom: ship.atFrom, targetId: ship.targetId, distLs: ship.fix && ship.fix.refId === ship.targetId ? ship.fix.distLs : null },
      spot,
      base?.id ?? null,
    );
    const target = byId(ship.targetId) && ship.targetId !== base?.id ? byId(ship.targetId) : undefined;
    const legTo = leg ? spot(leg.targetId) : null;
    const draw = (p: ShipSpot) => (mode === "true" ? flat(p.pos) : flat(p.view));
    let at: THREE.Vector3 | null = base ? placeOf(base) : null;
    let travelling = false;
    if (leg && legTo && (leg.t > 0 || leg.fromId == null)) {
      at = draw(legSpot(leg, legTo));
      travelling = true;
    } else if (ref && ship.fix && ref.id !== ship.targetId && ship.fix.distLs <= SHIP_NEAR_LS) at = placeOf(ref);
    if (!at) return;
    shipAt = at.clone();
    if (target) {
      const ends = [at.clone().setZ(0.06), placeOf(target).setZ(0.06)];
      // The route's next stop: a plain line on along the route. Another body targeted (out of order): the route stays
      // as it is and a dotted blue line runs to the body the commander chose.
      const offRoute = ship.nextInLine != null && target.id !== ship.nextInLine;
      const dash = ends[0]!.distanceTo(ends[1]!) / 60;
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(ends),
        offRoute
          ? new THREE.LineDashedMaterial({ color: 0x4d8dff, dashSize: dash, gapSize: dash, transparent: true, opacity: 0.9 })
          : new THREE.LineBasicMaterial({ color: 0x7fe3ff, transparent: true, opacity: 0.7 }),
      );
      if (offRoute) line.computeLineDistances();
      shipGroup.add(line);
    }
    const el = document.createElement("div");
    el.className = "scan-route-ship" + (travelling ? " is-travelling" : "");
    el.title = "Your ship";
    const arrow = document.createElement("span");
    arrow.className = "scan-route-ship__arrow";
    arrow.textContent = "▲";
    el.appendChild(arrow);
    const o = new CSS2DObject(el);
    o.position.copy(at);
    // On the line while travelling; at a body, above it, clear of its name under it.
    if (travelling) o.center.set(0.5, 0.5);
    else o.center.set(0.5, 1.3);
    shipGroup.add(o);
    if (target) shipArrow = { el: arrow, from: at.clone(), to: placeOf(target) };
  }

  /** The arrow turned towards the target as drawn on the screen (the view tilts and turns). */
  function turnArrow(): void {
    if (!shipArrow) return;
    const a = shipArrow.from.clone().project(camera);
    const b = shipArrow.to.clone().project(camera);
    const dx = (b.x - a.x) * host.clientWidth;
    const dy = -(b.y - a.y) * host.clientHeight;
    if (Math.hypot(dx, dy) < 1) return;
    // The ▲ points up: turned by the line's angle on the screen plus a quarter turn.
    shipArrow.el.style.transform = `rotate(${((Math.atan2(dy, dx) * 180) / Math.PI + 90).toFixed(1)}deg)`;
  }

  return {
    show,
    clear() {
      clear();
      clearGroup(shipGroup);
      shipArrow = null;
      leg = null;
      render();
    },
    setShip(m) {
      ship = m;
      drawShip();
      followFrame();
      render();
    },
    follow(id) {
      if (id !== followId) followPaused = false;
      followId = id;
      if (id == null) cancelAnimationFrame(glide);
      followFrame();
    },
    fit,
    focus,
    setNames(n, id) {
      names = n;
      nextId = id;
      render();
    },
    dispose() {
      cancelAnimationFrame(frame);
      ro.disconnect();
      controls.removeEventListener("change", render);
      renderer.domElement.removeEventListener("click", onClick);
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      cancelAnimationFrame(hoverFrame);
      cancelAnimationFrame(glide);
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.domElement.removeEventListener("pointerdown", pauseFollow);
      renderer.domElement.removeEventListener("wheel", pauseFollow);
      clear();
      clearGroup(grid);
      clearGroup(shipGroup);
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      labels.domElement.remove();
    },
  };
}
