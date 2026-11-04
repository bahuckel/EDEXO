/**
 * Where a composition-scanned plant stands (owner, 2026-11-04): two heading lines crossing, straight ahead of one scan
 * from the altitude and the nose-down angle, or where it was scanned from (shared/scanLocate.ts).
 */
import { describe, expect, it } from "vitest";
import { FlightPathPitch, fromLocal, locatePlant, relativeDeg, toLocal, bearingDeg, type CompScan } from "../src/shared/scanLocate.js";

const R = 1_000_000;
const O = { latDeg: 10, lonDeg: 20 };
/** A scan `e`, `n` metres from O, pointed at `heading`. */
const scan = (e: number, n: number, heading: number | null, more: Partial<CompScan> = {}): CompScan => ({
  ...fromLocal(O, e, n, R),
  headingDeg: heading,
  altitudeM: null,
  pitchDeg: null,
  atIso: "2026-11-04T10:00:00Z",
  ...more,
});
const at = (p: { latDeg: number; lonDeg: number }) => toLocal(O, p, R);

describe("bearings", () => {
  it("folds a relative bearing to -180..180, negative to the left", () => {
    expect(relativeDeg(10, 350)).toBeCloseTo(20);
    expect(relativeDeg(350, 10)).toBeCloseTo(-20);
    expect(relativeDeg(180, 0)).toBeCloseTo(180);
    expect(bearingDeg(-1, 0)).toBeCloseTo(270);
  });

  it("goes to the plane and back", () => {
    const p = at(fromLocal(O, 321, -654, R));
    expect(p.e).toBeCloseTo(321, 3);
    expect(p.n).toBeCloseTo(-654, 3);
  });
});

describe("locatePlant", () => {
  // The plant 500 m north of O; two scans either side of it, each pointed at it.
  const plant = { e: 0, n: 500 };
  const toward = (e: number, n: number) => bearingDeg(plant.e - e, plant.n - n);

  it("puts the plant where two heading lines cross", () => {
    const fix = locatePlant([scan(-400, 200, toward(-400, 200)), scan(400, 200, toward(400, 200))], R)!;
    expect(fix.how).toBe("crossing");
    const p = at(fix);
    expect(Math.hypot(p.e - plant.e, p.n - plant.n)).toBeLessThan(1);
  });

  it("refuses a crossing behind a scan, or too shallow, and falls back to where it was scanned from", () => {
    // Pointed away from each other: the lines meet behind both.
    const away = locatePlant([scan(-400, 200, toward(-400, 200) + 180), scan(400, 200, toward(400, 200) + 180)], R)!;
    expect(away.how).toBe("scanned-from");
    // Almost the same heading from almost the same spot: 5 degrees apart.
    const shallow = locatePlant([scan(0, 0, 0), scan(10, 0, 355)], R)!;
    expect(shallow.how).toBe("scanned-from");
    expect(shallow.headingDeg).toBe(355);
    const p = at(shallow);
    expect(p.e).toBeCloseTo(10, 3);
  });

  it("averages the crossings that agree when there are three scans", () => {
    const fix = locatePlant([scan(-400, 200, toward(-400, 200)), scan(400, 200, toward(400, 200)), scan(0, -300, toward(0, -300) + 1)], R)!;
    expect(fix.how).toBe("crossing");
    const p = at(fix);
    expect(Math.hypot(p.e - plant.e, p.n - plant.n)).toBeLessThan(10);
  });

  it("puts one scan's plant straight ahead from the altitude and the nose-down angle", () => {
    const fix = locatePlant([scan(0, 0, 90, { altitudeM: 100, pitchDeg: -45 })], R)!;
    expect(fix.how).toBe("ahead");
    const p = at(fix);
    expect(p.e).toBeCloseTo(100, 0);
    expect(p.n).toBeCloseTo(0, 0);
  });

  it("keeps the ship's spot when the angle is too flat, beyond reach or not known", () => {
    expect(locatePlant([scan(0, 0, 90, { altitudeM: 100, pitchDeg: -1 })], R)!.how).toBe("scanned-from");
    expect(locatePlant([scan(0, 0, 90, { altitudeM: 1000, pitchDeg: -10 })], R)!.how).toBe("scanned-from");
    expect(locatePlant([scan(0, 0, 90, { altitudeM: 100 })], R)!.how).toBe("scanned-from");
  });
});

describe("FlightPathPitch", () => {
  it("reads the nose angle off the path: 50 m/s forward, 10 m/s down is 11.3 degrees down", () => {
    const fp = new FlightPathPitch();
    let pitch: number | null = null;
    for (let i = 0; i <= 10; i++) {
      const p = fromLocal(O, 50 * i * 0.2, 0, R);
      pitch = fp.push({ ...p, planetRadiusM: R, altitudeM: 500 - 10 * i * 0.2 }, i * 200);
    }
    expect(pitch).toBeCloseTo(-11.31, 1);
  });

  it("says nothing hovering, on foot, or from a fix read twice", () => {
    const fp = new FlightPathPitch();
    expect(fp.push({ ...O, planetRadiusM: R, altitudeM: 50 }, 0)).toBeNull();
    expect(fp.push({ ...fromLocal(O, 0.5, 0, R), planetRadiusM: R, altitudeM: 50 }, 1000)).toBeNull();
    expect(fp.push({ ...O, planetRadiusM: R, altitudeM: null }, 1100)).toBeNull();
    const moving = new FlightPathPitch();
    moving.push({ ...O, planetRadiusM: R, altitudeM: 100 }, 0);
    const p = moving.push({ ...fromLocal(O, 40, 0, R), planetRadiusM: R, altitudeM: 100 }, 1000);
    expect(p).toBeCloseTo(0, 3);
    // The same fix read again a moment later (the file is read far more often than it changes) keeps the estimate.
    expect(moving.push({ ...fromLocal(O, 40, 0, R), planetRadiusM: R, altitudeM: 100 }, 1100)).toBe(p);
  });
});
