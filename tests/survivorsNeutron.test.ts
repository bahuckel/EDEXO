/**
 * Neutron route fuel (review 2026-11-10 §4.10, plan 2.1): the reserve cap, the scoop distance, a multi-jump hop's
 * burn and the fuel law's sample rules could change with the suite green. Each case here fails when they do.
 */
import { describe, expect, it } from "vitest";
import { planNeutronRoute } from "../src/server/neutronRoute.js";
import type { NeutronStar } from "../src/server/neutronIndex.js";
import { DEFAULT_POWER, emptyFsdFuel, fsdFuelJump, fsdFuelModel } from "../src/shared/fsdFuel.js";

/** Neutron stars every `step` ly along +x from x0 to x1, each with a scoopable star `scoopLs` from arrival (or none). */
function line(x0: number, x1: number, step: number, scoopLs: number | null = null) {
  const stars: NeutronStar[] = [];
  for (let x = x0, i = 0; x <= x1; x += step, i++) stars.push({ i, x, y: 0, z: 0, scoopLs });
  return {
    stars,
    within: (p: { x: number; y: number; z: number }, r: number) =>
      stars.filter((s) => Math.hypot(s.x - p.x, s.y - p.y, s.z - p.z) <= r),
    nameOf: (i: number) => `N${i}`,
  };
}
const A = { name: "A", x: 0, y: 0, z: 0 };

describe("the neutron planner's fuel", () => {
  it("keeps at most half a tank in reserve, whatever is asked", async () => {
    const idx = line(50, 1850, 200, 500);
    const ship = { rangeLy: 50, jumpsPerTank: 6, jumpsNow: 6 };
    const half = await planNeutronRoute(idx, [A, { name: "B", x: 2050, y: 0, z: 0 }], { ...ship, reserve: 0.5 });
    const more = await planNeutronRoute(idx, [A, { name: "B", x: 2050, y: 0, z: 0 }], { ...ship, reserve: 0.8 });
    expect(more).toEqual(half);
  });

  it("refuels at a scoopable star 4,999 ls out, never at one 5,001 ls out", async () => {
    const ship = { rangeLy: 50, jumpsPerTank: 4, jumpsNow: 4 };
    const near = await planNeutronRoute(line(50, 1850, 200, 4999), [A, { name: "B", x: 2050, y: 0, z: 0 }], ship);
    const far = await planNeutronRoute(line(50, 1850, 200, 5001), [A, { name: "B", x: 2050, y: 0, z: 0 }], ship);
    expect(near.refuels).toBeGreaterThan(0);
    expect(far.refuels).toBe(0);
  });

  it("counted by the drive's law, flags a leg that lands with under 1 % of the tank", async () => {
    // 100 t tank, a 5 t jump to B: 5.5 t aboard lands with 0.5 t (the 0.1 t arrival the spare is for), 6.5 t with 1.5 t.
    const law = { tankT: 100, perJumpT: 5, fuelT: () => 5, rangeLy: () => 50 };
    const ship = (fuelNowT: number) => ({ rangeLy: 50, jumpsPerTank: 10, jumpsNow: 1, boost: 4, law, fuelNowT });
    const B = { name: "B", x: 40, y: 0, z: 0 };
    const none = { within: () => [], nameOf: (i: number) => `N${i}` };
    expect((await planNeutronRoute(none, [A, B], ship(5.5))).unsafeLegs).toEqual([1]);
    expect((await planNeutronRoute(none, [A, B], ship(6.5))).unsafeLegs).toEqual([]);
  });

  it("burns a jump of fuel for each jump after a hop's supercharge", async () => {
    // A supercharge reaches 196 ly at range 50: stars 296 ly apart take a supercharge and two jumps, three in all.
    const idx = line(50, 50 + 296 * 3, 296);
    const r = await planNeutronRoute(idx, [A, { name: "B", x: 50 + 296 * 3, y: 0, z: 0 }], { rangeLy: 50, jumpsPerTank: 20, jumpsNow: 20 });
    const between = r.hops.filter((h) => h.jumps === 3);
    expect(between.length).toBeGreaterThan(1);
    for (let i = 1; i < r.hops.length; i++) {
      const h = r.hops[i]!;
      if (h.jumps === 3 && !h.refuel) expect(r.hops[i - 1]!.fuelArrive! - h.fuelArrive!).toBe(3);
    }
  });
});

describe("the drive's fuel law from the commander's jumps (fsdFuel.ts)", () => {
  const ship = () => {
    const st = emptyFsdFuel();
    st.unladenT = 400;
    return st;
  };

  it("leaves out a jump shorter than 2 ly, and weighs a jump with the fuel it burnt", () => {
    const st = ship();
    fsdFuelJump(st, { JumpDist: 0.5, FuelUsed: 0.1, FuelLevel: 30 });
    expect(st.samples).toEqual([]);
    fsdFuelJump(st, { JumpDist: 20, FuelUsed: 2, FuelLevel: 30 }, 10);
    expect(st.samples).toEqual([{ ly: 20, fuelT: 2, massT: 400 + 30 + 2 + 10 }]);
  });

  it("does not fit a power outside 1.8-3: the class A default instead", () => {
    const st = ship();
    // Fuel that grows with the fourth power of distance x mass: noise, not a drive.
    for (const ly of [10, 12, 14, 16, 18, 20, 22, 24]) st.samples.push({ ly, fuelT: 1e-12 * (ly * 500) ** 4, massT: 500 });
    const m = fsdFuelModel(st)!;
    expect(m.fitted).toBe(false);
    expect(m.p).toBe(DEFAULT_POWER);
  });
});
