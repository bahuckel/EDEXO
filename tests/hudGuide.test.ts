/**
 * Heading to a scan (owner, 2026-11-04): which mark the nose points at, and which way to turn for the next plant
 * (client/hud/guide.tsx).
 */
import { describe, expect, it } from "vitest";
import { pointedMark, targetMark } from "../src/client/hud/guide.js";
import type { ExoMinimapDTO } from "../src/shared/types.js";

type Mark = ExoMinimapDTO["marks"][number];
const mark = (eastM: number, northM: number, more: Partial<Mark> = {}): Mark => ({
  kind: "codex",
  eastM,
  northM,
  distanceM: Math.hypot(eastM, northM),
  label: "Stratum Tectonicas - Green (scanned from here)",
  name: "Stratum Tectonicas - Green",
  ...more,
});
const map = (headingDeg: number | null, marks: Mark[], altitudeM: number | null = null): ExoMinimapDTO => ({
  radiusM: 500,
  headingDeg,
  minSampleDistanceM: 0,
  marks,
  altitudeM,
});

describe("HUD guide", () => {
  it("names the nearest mark within 4 degrees of the nose, with how far below it is when flying", () => {
    const far = mark(0, 900, { name: "Far" });
    const near = mark(10, 300, { name: "Near" });
    const p = pointedMark(map(0, [far, near, mark(300, 0)], 300))!;
    expect(p.mark.name).toBe("Near");
    expect(p.downDeg).toBeCloseTo(45, 0);
  });

  it("names nothing outside the cone, for the ship, or without a heading", () => {
    expect(pointedMark(map(0, [mark(100, 100)]))).toBeNull();
    expect(pointedMark(map(0, [mark(0, 100, { kind: "ship" })]))).toBeNull();
    expect(pointedMark(map(null, [mark(0, 100)]))).toBeNull();
  });

  it("says which way to turn for the next plant to sample", () => {
    // Heading east; the target due north: 90 degrees left.
    const t = targetMark(map(90, [mark(0, 400, { target: true })]))!;
    expect(t.turnDeg).toBeCloseTo(-90);
    expect(targetMark(map(90, [mark(0, 400)]))).toBeNull();
  });
});
