/*
  An easter egg (owner, 2026-10-04): "Powered by EDAstro", written in the dark above the disc between
  Sol and the core. It fades in only when the camera is near Sol, looking at Sagittarius A* across
  the disc at a grazing angle — the view a commander gets lying the map nearly flat towards the
  core — and is gone from every other view. The galaxy index this map draws is built from EDAstro's
  codex data. Moved out of GalaxyEngine.ts unchanged; the engine owns the mesh and draws it.
*/
import * as THREE from "three";
import { CORE } from "./engineGl";

/** How far faded in (0–1) the egg is for this camera, its target and polar angle. */
export function eggFade(cam: THREE.Vector3, target: THREE.Vector3, polar: number): number {
  const nearSol = cam.length() < 4_000;
  let f = 0;
  if (nearSol && polar > Math.PI * 0.43) {
    const look = target.clone().sub(cam).normalize();
    const toCore = CORE.clone().sub(cam).normalize();
    const along = look.dot(toCore);
    if (along > 0.96)
      f = Math.min(1, (along - 0.96) / 0.03) * Math.min(1, (polar - Math.PI * 0.43) / (Math.PI * 0.03));
  }
  return f;
}

/** The egg's text on a plane, placed above the disc and facing Sol; hidden until faded in. */
export function makeEgg(): THREE.Mesh {
  const c = document.createElement("canvas");
  c.width = 2048;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.font = "600 120px Bahnschrift, 'Segoe UI', sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.shadowColor = "rgba(255, 150, 60, 0.9)";
  g.shadowBlur = 28;
  g.fillStyle = "rgba(255, 214, 170, 0.95)";
  g.fillText("Powered by EDAstro", 1024, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    opacity: 0,
  });
  const egg = new THREE.Mesh(new THREE.PlaneGeometry(5_200, 650), mat);
  // Galaxy (x, y, z) → world (x, y, -z): 9,000 ly towards the core, 2,200 ly above the plane, facing Sol.
  egg.position.set(12, 2_200, -9_000);
  egg.renderOrder = 10;
  return egg;
}
