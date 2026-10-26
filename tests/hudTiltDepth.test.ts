/**
 * The Elite Style's turn at the same angle on every HUD panel (owner, 2026-10-26): the perspective depth follows
 * the panel's height, so the slope of its top and bottom edges, about (height / 2·depth) · tan(tilt), is the same
 * for a short panel and a tall one; below the floor, a short panel slopes less rather than being squeezed.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TILT_DEPTH_MIN_PX, tiltDepthPx } from "../src/client/hud/tilt";

const slope = (height: number) => height / (2 * tiltDepthPx(height));

describe("the HUD's turn depth", () => {
  it("gives panels of different heights the same edge slope", () => {
    expect(slope(150)).toBeCloseTo(slope(640), 10);
    expect(slope(300)).toBeCloseTo(slope(1200), 10);
  });

  it("never goes under the floor, and survives nonsense", () => {
    expect(tiltDepthPx(20)).toBe(TILT_DEPTH_MIN_PX);
    expect(tiltDepthPx(NaN)).toBe(TILT_DEPTH_MIN_PX);
    expect(slope(40)).toBeLessThan(slope(400));
  });

  it("is what the stylesheet turns the panel with", () => {
    const css = readFileSync("public/hud.css", "utf8");
    expect(css).not.toContain("perspective(60rem)");
    expect(css.match(/perspective\(var\(--hud-tilt-depth, 60rem\)\)/g)).toHaveLength(2);
  });
});
