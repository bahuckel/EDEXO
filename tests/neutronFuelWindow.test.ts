/**
 * How much to scoop at a refuel stop (owner, 2026-10-29: "a green area that will take him to the next refuel, and also
 * make the rest of the jumps possible"): at least the fuel to the next refuel, at most the heaviest tank on which every
 * supercharge before it still reaches.
 */
import { describe, expect, it } from "vitest";
import { refuelWindow } from "../src/server/neutronFuelWindow.js";
import type { LiveHop } from "../src/server/neutronLive.js";

const hop = (name: string, x: number, extra: Partial<LiveHop> = {}): LiveHop => ({
  name,
  x,
  y: 0,
  z: 0,
  kind: "neutron",
  jumps: 1,
  boosted: 1,
  refuel: false,
  scoopLs: null,
  scoopOnWay: false,
  ...extra,
});

// 80 ly on a full 100 t tank, 10 % further on an empty one; ×6; 10 t a jump.
const ship = {
  rangeLy: 80,
  rangeByFuel: Array.from({ length: 21 }, (_, i) => 1.1 - (0.1 * i) / 20),
  boost: 6,
  fuelPerJumpT: 10,
  tankT: 100,
};

// Refuel at A; B is 492 ly on (a 82 ly supercharge: 75 t aboard or less), then C, then the next refuel at D.
const route = [
  hop("A", 0, { refuel: true, scoopLs: 12 }),
  hop("B", 492),
  hop("C", 892),
  hop("D", 1192, { refuel: true }),
  // Past the next refuel: not this stop's business, however far.
  hop("E", 1192 + 540),
];

describe("refuelWindow", () => {
  it("is at least the fuel to the next refuel and at most what every supercharge before it allows", () => {
    // B and C must be left with a jump to spare (20 t, 30 t from A), D reached on the last (30 t).
    expect(refuelWindow(route, 0, ship, 42)).toEqual({ minT: 30, maxT: 75, tankT: 100, nowT: 42, toStop: 3 });
  });

  it("says a full tank is fine when every hop reaches on it", () => {
    const easy = route.map((h, i) => (i === 1 ? { ...h, x: 400 } : i === 2 ? { ...h, x: 800 } : h));
    expect(refuelWindow(easy, 0, ship, null)?.maxT).toBe(100);
  });

  it("is null away from a refuel stop, and when no tank makes the stretch", () => {
    expect(refuelWindow(route, 1, ship, 50)).toBeNull();
    const far = route.map((h, i) => (i === 1 ? { ...h, x: 600 } : h));
    expect(refuelWindow(far, 0, ship, 50)).toBeNull();
  });

  it("rounds its ends inwards, so 'enough' at the bottom is never a little short", () => {
    const odd = { ...ship, fuelPerJumpT: 10.04 };
    const w = refuelWindow(route, 0, odd, null)!;
    // 3 jumps of 10.04 t: 30.12 t, shown as 30.2, not 30.1.
    expect(w.minT).toBe(30.2);
    expect(Number.isInteger(w.maxT * 10)).toBe(true);
    expect(w.maxT).toBeGreaterThanOrEqual(w.minT);
  });

  it("ends the stretch at a scoop on the way: only its supercharge and one jump come out of the tank", () => {
    const onWay = [hop("A", 0, { refuel: true }), hop("B", 400), hop("C", 400 + 900, { jumps: 6, scoopOnWay: true })];
    // B: 2 jumps' fuel (one to spare); C leaves with 10 t less and needs its supercharge + one more: 10 + 20.
    expect(refuelWindow(onWay, 0, ship, null)?.minT).toBe(30);
  });
});
