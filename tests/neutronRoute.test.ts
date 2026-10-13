/**
 * The neutron route planner (plan 8.3/8.4) on a made-up galaxy: neutron stars on a line, some with a scoopable star,
 * a ship whose range and tank are known. Supercharged hops, refuel stops before the tank runs dry, the plain plot
 * where no neutron star helps, waypoints in order or optimised, and the FSD's wear from the journal.
 */
import { describe, expect, it } from "vitest";
import { optimiseOrder, planNeutronRoute } from "../src/server/neutronRoute.js";
import type { NeutronStar } from "../src/server/neutronIndex.js";
import {
  DEFAULT_WEAR,
  fsdWearEstimate,
  fsdWearJump,
  fsdWearLoadout,
  fsdWearRepair,
  newFsdWear,
} from "../src/shared/fsdWear.js";

/** Neutron stars every `step` ly along +x from x0 to x1; every `scoopEvery`-th has a scoopable star. */
function line(x0: number, x1: number, step: number, scoopEvery = 0) {
  const stars: NeutronStar[] = [];
  for (let x = x0, i = 0; x <= x1; x += step, i++)
    stars.push({ i, x, y: 0, z: 0, scoopLs: scoopEvery && i % scoopEvery === 0 ? 500 : null });
  return {
    stars,
    within: (p: { x: number; y: number; z: number }, r: number) =>
      stars.filter((s) => Math.hypot(s.x - p.x, s.y - p.y, s.z - p.z) <= r),
    nameOf: (i: number) => `N${i}`,
  };
}
const A = { name: "A", x: 0, y: 0, z: 0 };

describe("neutron route", () => {
  it("supercharges from neutron star to neutron star, four times the range a jump", async () => {
    // Range 50: a supercharge reaches 200 ly; neutron stars every 200 ly from 50 to 1,850, the end at 2,050.
    const idx = line(50, 1850, 200);
    const r = await planNeutronRoute(idx, [A, { name: "B", x: 2050, y: 0, z: 0 }], {
      rangeLy: 50,
      jumpsPerTank: 100,
      jumpsNow: 100,
    });
    expect(r.plainJumps).toBe(41);
    // 1 normal jump to the first, 9 supercharges along, 1 to the end.
    expect(r.boosted).toBe(10);
    expect(r.jumps).toBe(11);
    expect(r.hops.at(-1)!.name).toBe("B");
    expect(r.unsafeLegs).toEqual([]);
  });

  it("goes by a neutron star with a scoopable star before the tank runs dry, and says to scoop there", async () => {
    // Tank: 3 jumps. Every third neutron star has a scoopable star.
    const idx = line(50, 1850, 200, 3);
    const r = await planNeutronRoute(idx, [A, { name: "B", x: 2050, y: 0, z: 0 }], {
      rangeLy: 50,
      jumpsPerTank: 3,
      jumpsNow: 3,
    });
    expect(r.unsafeLegs).toEqual([]);
    expect(r.refuels).toBeGreaterThan(0);
    for (const h of r.hops) expect(h.jumpsLeft).toBeGreaterThanOrEqual(0);
    for (const h of r.hops.filter((x) => x.refuel)) expect(h.scoopLs).toBe(500);
  });

  it("takes the plain plot where no neutron star helps", async () => {
    const idx = line(100_000, 100_000, 1);
    const r = await planNeutronRoute(idx, [A, { name: "B", x: 1000, y: 0, z: 0 }], {
      rangeLy: 50,
      jumpsPerTank: 100,
      jumpsNow: 100,
    });
    expect(r.boosted).toBe(0);
    expect(r.jumps).toBe(20);
  });

  it("chains the stops in order, and wears the FSD a supercharge at a time", async () => {
    const idx = line(50, 3850, 200);
    const r = await planNeutronRoute(
      idx,
      [A, { name: "B", x: 2050, y: 0, z: 0 }, { name: "C", x: 4050, y: 0, z: 0 }],
      { rangeLy: 50, jumpsPerTank: 100, jumpsNow: 100, fsdHealth: 0.9, wearPerBoost: 0.01 },
    );
    expect(r.hops.filter((h) => h.kind === "waypoint").map((h) => h.name)).toEqual(["B", "C"]);
    // 0.9 less 1 % a supercharge: under 80 % after the 11th.
    const at = r.repairBefore!;
    expect(r.hops[at]!.fsdHealth!).toBeLessThan(0.8);
    expect(r.hops.slice(0, at).every((h) => h.fsdHealth == null || h.fsdHealth >= 0.8)).toBe(true);
  });

  it("optimises the order of the stops between the first and the last", () => {
    const pts = [
      { name: "start", x: 0, y: 0, z: 0 },
      { name: "far", x: 300, y: 0, z: 0 },
      { name: "near", x: 100, y: 0, z: 0 },
      { name: "end", x: 400, y: 0, z: 0 },
    ];
    expect(optimiseOrder(pts).map((p) => p.name)).toEqual(["start", "near", "far", "end"]);
  });
});

describe("FSD wear from the journal", () => {
  const loadout = (health: number) => ({
    event: "Loadout",
    ShipID: 7,
    Modules: [{ Item: "int_hyperdrive_size5_class5", Health: health }],
  });

  it("takes health from Loadout, counts supercharges since, and learns the wear once there are enough", () => {
    const st = newFsdWear();
    fsdWearLoadout(st, loadout(1));
    for (let i = 0; i < 4; i++) fsdWearJump(st, { event: "FSDJump", BoostUsed: 4 });
    fsdWearJump(st, { event: "FSDJump", BoostUsed: 2 }); // synthesis: no wear
    expect(fsdWearEstimate(st)).toMatchObject({ boostsSince: 4, wearIsDefault: true });
    expect(fsdWearEstimate(st).health).toBeCloseTo(1 - 4 * DEFAULT_WEAR, 6);
    fsdWearLoadout(st, loadout(0.96));
    for (let i = 0; i < 6; i++) fsdWearJump(st, { event: "FSDJump", BoostUsed: 4 });
    fsdWearLoadout(st, loadout(0.9));
    // 10 supercharges, 10 % lost: 1 % each, learned.
    const e = fsdWearEstimate(st);
    expect(e.wearIsDefault).toBe(false);
    expect(e.wearPerBoost).toBeCloseTo(0.01, 6);
    expect(e.health).toBeCloseTo(0.9, 6);
  });

  it("is full again after a repair of the drive, and does not learn across one", () => {
    const st = newFsdWear();
    fsdWearLoadout(st, loadout(0.85));
    fsdWearJump(st, { event: "FSDJump", BoostUsed: 4 });
    fsdWearRepair(st, { event: "Repair", Items: ["int_hyperdrive_size5_class5"] });
    expect(fsdWearEstimate(st).health).toBe(1);
    fsdWearRepair(st, { event: "Repair", Items: ["hpt_pulselaser_fixed_small"] });
    fsdWearLoadout(st, loadout(1));
    expect(st.boosts).toBe(0);
  });
});
