/**
 * The Nebula style's painted sky (src/client/nebulaSky/paint.ts): the size asked for, the same picture every time
 * (it is cached by size), and the three nebulae where the owner asked for them — Crab top left, Helix top right,
 * Ring bottom middle — each brighter than the sky between them.
 */
import { describe, expect, it } from "vitest";
import { paintNebulaSky } from "../src/client/nebulaSky/paint";

const W = 480;
const H = 270;
const pic = paintNebulaSky(W, H, 0.5);

/** Mean brightness of a box around (fx, fy) (fractions of the picture), stars and all. */
function glow(fx: number, fy: number, half = 12): number {
  let sum = 0;
  let n = 0;
  for (let y = Math.round(fy * H) - half; y <= Math.round(fy * H) + half; y++) {
    for (let x = Math.round(fx * W) - half; x <= Math.round(fx * W) + half; x++) {
      const o = (y * W + x) * 4;
      sum += pic.data[o]! + pic.data[o + 1]! + pic.data[o + 2]!;
      n++;
    }
  }
  return sum / n / 3;
}

describe("nebula sky", () => {
  it("is the size asked for, opaque", () => {
    expect([pic.width, pic.height, pic.data.length]).toEqual([W, H, W * H * 4]);
    for (let i = 3; i < pic.data.length; i += 4 * 997) expect(pic.data[i]).toBe(255);
  });

  it("paints the same picture every time", () => {
    const again = paintNebulaSky(W, H, 0.5);
    expect(Buffer.from(again.data).equals(Buffer.from(pic.data))).toBe(true);
  });

  it("puts the Crab top left, the Helix's ring top right and the Ring bottom middle, over a dark sky", () => {
    const sky = glow(0.5, 0.45);
    // The Crab's middle glows; the Helix and the Ring are brightest on their rings, not at their middles.
    expect(glow(0.19, 0.26)).toBeGreaterThan(sky * 3);
    expect(glow(0.84 - 0.1, 0.27, 6)).toBeGreaterThan(sky * 3);
    expect(glow(0.5, 0.83 - 0.11, 5)).toBeGreaterThan(sky * 3);
  });
});
