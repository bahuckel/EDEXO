/**
 * The scan view's 3D scene (plan 1.3.3 R-4): the system from above — each body at its view place
 * (`ScanRouteBodyDTO.viewPos`, orbits on a log scale per level), its orbit as a ring round what it orbits, the
 * route as a line with numbered stops, and the bodies the honk counted but nobody scanned as grey "?" on an outer
 * ring. three.js with MapControls: drag to pan, wheel to zoom, right drag to tilt.
 */
import * as THREE from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { ScanRouteBodyDTO, ScanRouteDTO } from "@shared/dto/routeSystem.js";

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

/** Drawn size; a moon (it orbits a planet) smaller than a planet. */
function bodySize(b: ScanRouteBodyDTO, moon: boolean): number {
  if (b.kind === "star") return 1.4;
  const c = (b.cls ?? "").toLowerCase();
  if (c.includes("gas giant")) return moon ? 0.6 : 0.9;
  return moon ? 0.35 : 0.55;
}

const TARGET_COLOUR = { dss: "#40d9cc", bio: "#5ce675", both: "#ffd166" } as const;

export interface ScanRouteScene {
  show(d: ScanRouteDTO): void;
  /** Nothing shown (a system loading). */
  clear(): void;
  /** Frame every body. */
  fit(): void;
  dispose(): void;
}

export function createScanRouteScene(host: HTMLElement, onPick: (id: number) => void): ScanRouteScene {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x05070c);
  host.appendChild(renderer.domElement);
  const labels = new CSS2DRenderer();
  labels.domElement.className = "scan-route-labels";
  host.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 20000);
  camera.up.set(0, 0, 1);
  camera.position.set(0, 0, 120);
  const controls = new MapControls(camera, renderer.domElement);
  controls.screenSpacePanning = true;
  controls.maxPolarAngle = Math.PI / 2.2;
  controls.enableDamping = false;

  const group = new THREE.Group();
  scene.add(group);
  let bounds = 40;
  const meshes = new Map<THREE.Object3D, number>();

  // Drawn when something moves (the camera, the bodies, the window), not every frame: the tab costs nothing idle.
  let frame = 0;
  const render = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
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
    render();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  const raycaster = new THREE.Raycaster();
  const onClick = (e: MouseEvent) => {
    const r = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = raycaster.intersectObjects([...meshes.keys()], false)[0];
    if (hit) onPick(meshes.get(hit.object)!);
  };
  renderer.domElement.addEventListener("click", onClick);

  const clear = () => {
    for (const o of [...group.children]) {
      group.remove(o);
      o.traverse((x) => {
        if (x instanceof CSS2DObject) x.element.remove();
        const m = x as THREE.Mesh;
        m.geometry?.dispose?.();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((q) => q.dispose());
        else mat?.dispose?.();
      });
    }
    meshes.clear();
  };

  const label = (text: string, cls: string, at: THREE.Vector3) => {
    const el = document.createElement("div");
    el.className = cls;
    el.textContent = text;
    const o = new CSS2DObject(el);
    o.position.copy(at);
    group.add(o);
    return el;
  };

  const v3 = (p: { x: number; y: number; z: number }) => new THREE.Vector3(p.x, p.y, p.z);

  function fit() {
    camera.position.set(0, 0, Math.max(30, bounds * 2.4));
    controls.target.set(0, 0, 0);
    camera.up.set(0, 0, 1);
    camera.lookAt(0, 0, 0);
    controls.update();
    render();
  }

  function show(d: ScanRouteDTO) {
    clear();
    let far = 10;
    const ringMat = new THREE.LineBasicMaterial({ color: 0x2a3550, transparent: true, opacity: 0.8 });
    for (const b of d.bodies) {
      far = Math.max(far, Math.hypot(b.viewPos.x, b.viewPos.y));
      // The orbit: a circle round what it orbits, through the body (the view's orbits are flat and round).
      if (b.ringCentre) {
        const r = Math.hypot(b.viewPos.x - b.ringCentre.x, b.viewPos.y - b.ringCentre.y);
        if (r > 0.05) {
          const pts = Array.from({ length: 97 }, (_, k) => {
            const a = (k / 96) * Math.PI * 2;
            return new THREE.Vector3(b.ringCentre!.x + r * Math.cos(a), b.ringCentre!.y + r * Math.sin(a), 0);
          });
          group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), ringMat));
        }
      }
      const moon = b.kind === "planet" && b.moon;
      const size = bodySize(b, moon);
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(size, 20, 14),
        new THREE.MeshBasicMaterial({
          color: b.kind === "star" ? starColour(b.cls) : planetColour(b.cls),
          transparent: b.mapped,
          opacity: b.mapped ? 0.45 : 1,
        }),
      );
      mesh.position.copy(v3(b.viewPos));
      group.add(mesh);
      meshes.set(mesh, b.id);
      if (b.target) {
        const halo = new THREE.Mesh(
          new THREE.RingGeometry(size * 1.5, size * 1.5 + 0.18, 32),
          new THREE.MeshBasicMaterial({ color: TARGET_COLOUR[b.target], side: THREE.DoubleSide }),
        );
        halo.position.copy(v3(b.viewPos));
        group.add(halo);
      }
      const near = d.route.order.indexOf(b.id);
      // Named: stars, planets and the route's stops; a moon's name only when it is one (they crowd their planet).
      if (moon && near < 0) continue;
      label(
        (near >= 0 ? `${near + 1}. ` : "") + b.short,
        `scan-route-label scan-route-label--${b.target ?? (b.kind === "star" ? "star" : "plain")}`,
        v3(b.viewPos).add(new THREE.Vector3(0, -size - 0.4, 0)),
      );
    }
    // The route: from the arrival star through the stops in order.
    const start = d.bodies.find((b) => b.id === d.startId);
    const stops = d.route.order.map((id) => d.bodies.find((b) => b.id === id)).filter((b): b is ScanRouteBodyDTO => !!b);
    if (start && stops.length) {
      const pts = [start, ...stops].map((b) => v3(b.viewPos).setZ(0.05));
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xff9e33 })));
    }
    // Bodies the honk counted and nobody has scanned: on a ring outside the system, filling in as they are found.
    const missing = d.bodyCount.missing;
    for (let k = 0; k < missing; k++) {
      const a = (k / Math.max(1, missing)) * Math.PI * 2 + 0.3;
      const at = new THREE.Vector3((far + 6) * Math.cos(a), (far + 6) * Math.sin(a), 0);
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 8), new THREE.MeshBasicMaterial({ color: 0x55606f }));
      m.position.copy(at);
      group.add(m);
      label("?", "scan-route-label scan-route-label--missing", at.clone().add(new THREE.Vector3(0, -0.9, 0)));
    }
    const grew = Math.abs(far + 8 - bounds) > bounds * 0.25;
    bounds = far + 8;
    if (grew) fit();
    render();
  }

  return {
    show,
    clear() {
      clear();
      render();
    },
    fit,
    dispose() {
      cancelAnimationFrame(frame);
      ro.disconnect();
      controls.removeEventListener("change", render);
      renderer.domElement.removeEventListener("click", onClick);
      clear();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      labels.domElement.remove();
    },
  };
}
