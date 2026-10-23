/**
 * The galaxy engine's WebGL builders that need no engine state (galaxy3d/engineGl.ts, moved out of
 * GalaxyEngine.ts by the audit of 2026-10-22): the accumulation target, the overview's cell mask and the
 * Elite controls' cross-hair. None of them needs a WebGL context to build.
 */
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { accentColour, buildCrosshair, makeCellMask, makeRenderTarget } from "../src/client/galaxy3d/engineGl.js";

describe("engine GL builders", () => {
  it("makes a half-float target without a depth buffer, filtered linearly", () => {
    const t = makeRenderTarget(4, 3);
    expect([t.width, t.height]).toEqual([4, 3]);
    expect(t.texture.type).toBe(THREE.HalfFloatType);
    expect(t.depthBuffer).toBe(false);
    expect([t.texture.minFilter, t.texture.magFilter]).toEqual([THREE.LinearFilter, THREE.LinearFilter]);
    t.dispose();
  });

  it("makes one red texel per cell, x across and y·z down, sampled nearest", () => {
    const tex = makeCellMask({ min: { cx: 0, cy: 0, cz: 0 }, dims: { x: 3, y: 2, z: 4 } });
    expect([tex.image.width, tex.image.height]).toEqual([3, 8]);
    expect(tex.image.data).toBeInstanceOf(Uint8Array);
    expect(tex.image.data?.length).toBe(3 * 2 * 4);
    expect(tex.format).toBe(THREE.RedFormat);
    expect([tex.minFilter, tex.magFilter]).toEqual([THREE.NearestFilter, THREE.NearestFilter]);
    tex.dispose();
  });

  it("builds the cross-hair hidden, in the given colour, drawn over the map", () => {
    const g = buildCrosshair(new THREE.Color(0x336699));
    expect(g.visible).toBe(false);
    expect(g.children.map((o) => o.name)).toEqual(["cross", "ring", "stem"]);
    for (const o of g.children) {
      expect(o.renderOrder).toBe(10);
      const m = (o as THREE.Line).material as THREE.LineBasicMaterial;
      expect(m.color.getHex()).toBe(0x336699);
      expect(m.depthTest).toBe(false);
    }
    // The cross solid, the ring and the stem fainter.
    const opacity = (n: string) => ((g.getObjectByName(n) as THREE.Line).material as THREE.LineBasicMaterial).opacity;
    expect([opacity("cross"), opacity("ring"), opacity("stem")]).toEqual([0.9, 0.45, 0.45]);
  });

  it("falls back to the default accent where there is no page style", () => {
    expect(accentColour().getHex()).toBe(0xff9a3c);
  });
});
