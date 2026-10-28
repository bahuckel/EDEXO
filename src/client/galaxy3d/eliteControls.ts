/*
  Elite-style controls for the 3D map (owner, 2026-10-06; View > "Elite controls"), moved out of GalaxyEngine.ts
  unchanged: the mouse buttons and tilt limits of each mode, turning round and raising the cross-hair, one frame
  of held W/A/S/D/Q/E/R/F, and placing the cross-hair (engineGl.ts builds it). The engine keeps the state (on or
  off, held keys, right drag) and asks for the frame.
*/
import * as THREE from "three";
import type { MapControls } from "three/examples/jsm/controls/MapControls.js";

/** The keys that fly the cross-hair. */
export const FLIGHT_KEYS = ["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "KeyR", "KeyF"];

/** The mouse buttons and tilt range of each mode; leaving Elite puts the target back on the plane. */
export function applyControlMode(c: MapControls, camera: THREE.PerspectiveCamera, elite: boolean): void {
  if (elite) {
    c.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: null as unknown as THREE.MOUSE,
    };
    c.minPolarAngle = 0.01;
    c.maxPolarAngle = Math.PI - 0.01;
  } else {
    c.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    c.minPolarAngle = 0;
    c.maxPolarAngle = Math.PI * 0.47;
    // Back on the plane, the way the default controls pan.
    const dy = c.target.y;
    c.target.y = 0;
    camera.position.y -= dy;
  }
  c.update();
}

/** Turn the camera round the cross-hair by `angle` radians (positive: to the left). */
export function turnAround(c: MapControls, camera: THREE.PerspectiveCamera, angle: number): void {
  const off = camera.position.clone().sub(c.target);
  off.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
  camera.position.copy(c.target).add(off);
  c.update();
}

/** Raise (negative: lower) the cross-hair and the camera with it, in ly. */
export function raiseTarget(c: MapControls, camera: THREE.PerspectiveCamera, dy: number): void {
  const before = c.target.y;
  c.target.y = Math.max(-12_000, Math.min(12_000, before + dy));
  camera.position.y += c.target.y - before;
  c.update();
}

/** One frame of held keys: move along the plane, turn, raise, at a speed that follows the distance. */
export function stepHeldKeys(
  k: ReadonlySet<string>,
  c: MapControls,
  camera: THREE.PerspectiveCamera,
  dt: number,
): void {
  const dist = Math.max(20, camera.position.distanceTo(c.target));
  const fwd = c.target.clone().sub(camera.position);
  fwd.y = 0;
  if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
  fwd.normalize();
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const move = new THREE.Vector3();
  if (k.has("KeyW")) move.add(fwd);
  if (k.has("KeyS")) move.sub(fwd);
  if (k.has("KeyD")) move.add(right);
  if (k.has("KeyA")) move.sub(right);
  if (move.lengthSq()) {
    move.normalize().multiplyScalar(dist * 0.9 * dt);
    c.target.add(move);
    camera.position.add(move);
  }
  if (k.has("KeyQ")) turnAround(c, camera, 1.6 * dt);
  if (k.has("KeyE")) turnAround(c, camera, -1.6 * dt);
  if (k.has("KeyR")) raiseTarget(c, camera, dist * 0.6 * dt);
  if (k.has("KeyF")) raiseTarget(c, camera, -dist * 0.6 * dt);
  c.update();
}

/** Put the cross-hair on the target, its ring on the plane below (or above) it, sized to the view. */
export function placeCrosshair(g: THREE.Group, t: THREE.Vector3, camera: THREE.PerspectiveCamera): void {
  const size = Math.max(4, camera.position.distanceTo(t) * 0.035);
  const cross = g.getObjectByName("cross")!;
  const ring = g.getObjectByName("ring")!;
  const stem = g.getObjectByName("stem")!;
  cross.position.set(t.x, t.y, t.z);
  cross.scale.setScalar(size);
  ring.position.set(t.x, 0, t.z);
  ring.scale.setScalar(size);
  stem.position.set(t.x, 0, t.z);
  stem.scale.set(1, Math.abs(t.y) < 0.01 ? 0.0001 : t.y, 1);
}
