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

describe("one door for every panel (owner, 2026-11-01: separate panels fanned out)", () => {
  it("gives every panel on a screen the same depth and the same vanishing point, the screen's middle", async () => {
    const { sharedTiltDepthPx, tiltOriginYPx } = await import("../src/client/hud/tilt");
    // Three panels stacked on a 1080 px screen, at 40, 300 and 700 px.
    const tops = [40, 300, 700];
    const depths = tops.map(() => sharedTiltDepthPx(1080));
    expect(new Set(depths).size).toBe(1);
    // Each panel's origin, put back on the screen, is the same point: the middle.
    expect(tops.map((t) => t + tiltOriginYPx(0, 1080, t))).toEqual([540, 540, 540]);
    // On a second screen below another, its own middle.
    expect(1080 + 200 + tiltOriginYPx(1080, 1440, 1080 + 200)).toBe(1080 + 720);
  });
});
