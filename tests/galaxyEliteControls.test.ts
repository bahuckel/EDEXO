/**
 * The 3D map's Elite-style controls (galaxy3d/eliteControls.ts, moved out of GalaxyEngine.ts unchanged): each mode's
 * mouse buttons and tilt range, turning round and raising the cross-hair, one frame of held keys, and the cross-hair's
 * place. A stand-in for MapControls: only its target, buttons, tilt limits and update() are used.
 */
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { MapControls } from "three/examples/jsm/controls/MapControls.js";
import { buildCrosshair } from "../src/client/galaxy3d/engineGl.js";
import {
  applyControlMode,
  placeCrosshair,
  raiseTarget,
  stepHeldKeys,
  turnAround,
} from "../src/client/galaxy3d/eliteControls.js";

function rig(target: [number, number, number], cam: [number, number, number]) {
  let updates = 0;
  const c = {
    target: new THREE.Vector3(...target),
    mouseButtons: {},
    minPolarAngle: 0,
    maxPolarAngle: 0,
    update: () => {
      updates++;
      return false;
    },
  } as unknown as MapControls;
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(...cam);
  return { c, camera, updates: () => updates };
}
const near = (a: THREE.Vector3, b: [number, number, number]) =>
  b.forEach((v, i) => expect(a.getComponent(i)).toBeCloseTo(v, 6));

describe("Elite controls", () => {
  it("Elite on: left rotates, right is free for the engine's drag, tilt all the way round", () => {
    const { c, camera, updates } = rig([0, 50, 0], [0, 150, 100]);
    applyControlMode(c, camera, true);
    expect(c.mouseButtons).toEqual({ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: null });
    expect(c.minPolarAngle).toBeCloseTo(0.01);
    expect(c.maxPolarAngle).toBeCloseTo(Math.PI - 0.01);
    near(c.target, [0, 50, 0]);
    expect(updates()).toBe(1);
  });

  it("Elite off: the map's buttons, tilt to 85°, and the target back on the plane with the camera", () => {
    const { c, camera } = rig([10, 50, 20], [10, 150, 120]);
    applyControlMode(c, camera, false);
    expect(c.mouseButtons).toEqual({
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    });
    expect(c.maxPolarAngle).toBeCloseTo(Math.PI * 0.47);
    near(c.target, [10, 0, 20]);
    near(camera.position, [10, 100, 120]);
  });

  it("turns the camera round the target, keeping its distance and height", () => {
    const { c, camera } = rig([0, 0, 0], [0, 30, 100]);
    turnAround(c, camera, Math.PI / 2);
    near(camera.position, [100, 30, 0]);
    near(c.target, [0, 0, 0]);
  });

  it("raises the target and the camera together, within ±12,000 ly", () => {
    const { c, camera } = rig([0, 0, 0], [0, 100, 100]);
    raiseTarget(c, camera, 500);
    near(c.target, [0, 500, 0]);
    near(camera.position, [0, 600, 100]);
    raiseTarget(c, camera, 50_000);
    expect(c.target.y).toBe(12_000);
    expect(camera.position.y).toBe(12_100);
  });

  it("W moves along the plane towards where the camera looks, at 0.9 × distance per second", () => {
    const { c, camera } = rig([0, 0, 0], [0, 0, 100]);
    stepHeldKeys(new Set(["KeyW"]), c, camera, 0.5);
    near(c.target, [0, 0, -45]);
    near(camera.position, [0, 0, 55]);
  });

  it("A and D strafe, W and S cancel, Q turns left, R raises", () => {
    const strafe = rig([0, 0, 0], [0, 0, 100]);
    stepHeldKeys(new Set(["KeyD", "KeyW", "KeyS"]), strafe.c, strafe.camera, 0.5);
    near(strafe.c.target, [45, 0, 0]);
    const turn = rig([0, 0, 0], [0, 0, 100]);
    stepHeldKeys(new Set(["KeyQ"]), turn.c, turn.camera, Math.PI / 2 / 1.6);
    near(turn.camera.position, [100, 0, 0]);
    const up = rig([0, 0, 0], [0, 0, 100]);
    stepHeldKeys(new Set(["KeyR"]), up.c, up.camera, 0.5);
    near(up.c.target, [0, 30, 0]);
  });

  it("places the cross at the target and its ring and stem on the plane under it, sized to the view", () => {
    const g = buildCrosshair(new THREE.Color(1, 0.5, 0));
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 200, 1000);
    const t = new THREE.Vector3(0, 200, 0);
    placeCrosshair(g, t, camera);
    const size = 1000 * 0.035;
    near(g.getObjectByName("cross")!.position, [0, 200, 0]);
    expect(g.getObjectByName("cross")!.scale.x).toBeCloseTo(size);
    near(g.getObjectByName("ring")!.position, [0, 0, 0]);
    expect(g.getObjectByName("stem")!.scale.y).toBe(200);
    placeCrosshair(g, new THREE.Vector3(0, 0, 0), camera);
    expect(g.getObjectByName("stem")!.scale.y).toBe(0.0001);
  });
});
