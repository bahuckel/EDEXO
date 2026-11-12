/**
 * The galaxy map's 3D clouds, made from the galaxy picture (owner 2026-10-04, picture back 2026-11-12): more clouds
 * where the picture is brighter, dark ones in its dust lanes. A synthetic picture stands in for the game's: a bright
 * core, a fading disc, and a dark ring (a lane) through it.
 */
import { describe, expect, it } from "vitest";
import { CLOUD_SPRITE_STRIDE, galaxyCloudSprites, pictureDust } from "../src/shared/galaxySprites.js";

const big = { width: 300, height: 220, coreX: 150, coreY: 110, lyPerPx: 420 };
const n = big.width * big.height;
const LANE_LY = 20_000;

/** The test picture: light falling off from the core, black past 50,000 ly, a dark lane at 20,000 ly. */
function picture(): Uint8ClampedArray {
  const px = new Uint8ClampedArray(n * 4);
  for (let y = 0; y < big.height; y++)
    for (let x = 0; x < big.width; x++) {
      const d = Math.hypot((x + 0.5 - big.coreX) * big.lyPerPx, (y + 0.5 - big.coreY) * big.lyPerPx);
      let v = d > 50_000 ? 0 : 0.15 + 0.85 * Math.exp(-d / 6_000);
      if (Math.abs(d - LANE_LY) < 900) v *= 0.3;
      const i = (y * big.width + x) * 4;
      px[i] = px[i + 1] = px[i + 2] = Math.round(255 * v);
      px[i + 3] = 255;
    }
  return px;
}

const clear = picture();
const dust = pictureDust(big, clear);
const sp = galaxyCloudSprites(big, clear, dust, { emission: 4000, dust: 1000 });
const rows = Array.from({ length: sp.length / CLOUD_SPRITE_STRIDE }, (_, k) => sp.subarray(k * CLOUD_SPRITE_STRIDE, (k + 1) * CLOUD_SPRITE_STRIDE));
const radius = (r: Float32Array) => Math.hypot((r[0]! - big.coreX) * big.lyPerPx, (r[1]! - big.coreY) * big.lyPerPx);

describe("pictureDust", () => {
  it("finds the dark lane inside the lit disc, and nothing in the black outside it", () => {
    const at = (dLy: number) => dust[big.coreY * big.width + Math.round(big.coreX + dLy / big.lyPerPx)]!;
    expect(at(LANE_LY)).toBeGreaterThan(0.3);
    expect(at(LANE_LY - 6_000)).toBeLessThan(0.1);
    expect(dust[0]).toBe(0);
    expect(Math.max(...dust)).toBeLessThanOrEqual(0.7);
  });
});

describe("galaxyCloudSprites", () => {
  it("is deterministic, finite, light first then dust", () => {
    const again = galaxyCloudSprites(big, clear, dust, { emission: 4000, dust: 1000 });
    expect(Buffer.from(again.buffer).equals(Buffer.from(sp.buffer))).toBe(true);
    expect(rows.every((r) => r.every(Number.isFinite))).toBe(true);
    const light = rows.filter((r) => r[7] === 1);
    const dark = rows.filter((r) => r[7]! < 1);
    expect(light.length).toBe(4000);
    expect(dark.length).toBe(1000);
    expect(rows.findIndex((r) => r[7]! < 1)).toBe(4000);
    expect(dark.every((r) => r[7]! > 0 && r[7]! <= 0.9)).toBe(true);
  });

  it("puts more clouds where the picture is brighter", () => {
    const light = rows.filter((r) => r[7] === 1);
    const perArea = (lo: number, hi: number) => light.filter((r) => radius(r) >= lo && radius(r) < hi).length / (hi * hi - lo * lo);
    expect(perArea(0, 5_000)).toBeGreaterThan(3 * perArea(30_000, 45_000));
    expect(light.filter((r) => radius(r) > 52_000).length).toBe(0);
  });

  it("puts the dust in the lane", () => {
    const dark = rows.filter((r) => r[7]! < 1);
    const inLane = dark.filter((r) => Math.abs(radius(r) - LANE_LY) < 3_000).length;
    expect(inLane / dark.length).toBeGreaterThan(0.6);
  });

  it("stands thick at the core and lies thin in the disc", () => {
    const spread = (sel: Float32Array[]) => Math.sqrt(sel.reduce((a, r) => a + r[2]! ** 2, 0) / sel.length);
    const light = rows.filter((r) => r[7] === 1);
    const core = light.filter((r) => radius(r) < 4_000);
    const disc = light.filter((r) => radius(r) > 15_000 && radius(r) < 30_000);
    expect(core.length).toBeGreaterThan(30);
    expect(spread(core)).toBeGreaterThan(5 * spread(disc));
  });

  it("adds up to the picture seen from above", () => {
    const sum = (lo: number, hi: number) =>
      rows
        .filter((r) => r[7] === 1 && radius(r) >= lo && radius(r) < hi)
        .reduce((a, r) => a + (r[4]! + r[5]! + r[6]!) * (Math.PI / 8) * (r[3]! / big.lyPerPx) ** 2, 0);
    const drawn = (lo: number, hi: number) => {
      let s = 0;
      for (let y = 0; y < big.height; y++)
        for (let x = 0; x < big.width; x++) {
          const d = Math.hypot((x + 0.5 - big.coreX) * big.lyPerPx, (y + 0.5 - big.coreY) * big.lyPerPx);
          const i = (y * big.width + x) * 4;
          if (d >= lo && d < hi) s += (clear[i]! + clear[i + 1]! + clear[i + 2]!) / 255;
        }
      return s;
    };
    for (const [lo, hi] of [
      [0, 10_000],
      [10_000, 30_000],
      [30_000, 50_000],
    ] as const) {
      expect(sum(lo, hi) / drawn(lo, hi)).toBeGreaterThan(0.75);
      expect(sum(lo, hi) / drawn(lo, hi)).toBeLessThan(1.33);
    }
  });
});
