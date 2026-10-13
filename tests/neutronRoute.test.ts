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
  hydrateFsdWear,
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
  const loadout = (health: number, ship = 7, item = "int_hyperdrive_size5_class5", type = "asp") => ({
    event: "Loadout",
    ShipID: ship,
    Ship: type,
    Modules: [{ Item: item, Health: health }],
  });
  const boost = (st: ReturnType<typeof newFsdWear>, n: number) => {
    for (let i = 0; i < n; i++) fsdWearJump(st, { event: "FSDJump", BoostUsed: 4 });
  };

  it("takes health from Loadout, counts supercharges since, and learns the wear once there are enough", () => {
    const st = newFsdWear();
    fsdWearLoadout(st, loadout(1));
    boost(st, 2);
    fsdWearJump(st, { event: "FSDJump", BoostUsed: 2 }); // synthesis: no wear
    expect(fsdWearEstimate(st)).toMatchObject({ boostsSince: 2, wearIsDefault: true, wearFrom: "default" });
    expect(fsdWearEstimate(st).health).toBeCloseTo(1 - 2 * DEFAULT_WEAR, 6);
    fsdWearLoadout(st, loadout(0.98));
    // Two measured: not yet this ship's own.
    expect(fsdWearEstimate(st).wearFrom).toBe("default");
    boost(st, 2);
    fsdWearLoadout(st, loadout(0.96));
    // Four supercharges, 4 % lost: 1 % each, learned.
    const e = fsdWearEstimate(st);
    expect(e).toMatchObject({ wearIsDefault: false, wearFrom: "ship", boostFactor: 4 });
    expect(e.wearPerBoost).toBeCloseTo(0.01, 6);
    expect(e.health).toBeCloseTo(0.96, 6);
  });

  it("keeps each ship's wear apart: a Caspian learns its own, and supercharges six times", () => {
    const st = newFsdWear();
    const mk2 = "int_hyperdrive_overcharge_size8_class5_overchargebooster_mkii";
    fsdWearLoadout(st, loadout(1));
    boost(st, 4);
    fsdWearLoadout(st, loadout(0.96));
    // Another ship: the Asp's 1 % is not its own, and its supercharges do not wear the Asp.
    fsdWearLoadout(st, loadout(1, 9, mk2, "explorer_nx"));
    expect(fsdWearEstimate(st)).toMatchObject({ wearFrom: "default", boostFactor: 6, ship: "explorer_nx" });
    boost(st, 5);
    fsdWearLoadout(st, loadout(0.98, 9, mk2, "explorer_nx"));
    expect(fsdWearEstimate(st).wearPerBoost).toBeCloseTo(0.004, 6);
    fsdWearLoadout(st, loadout(0.96));
    expect(fsdWearEstimate(st)).toMatchObject({ wearFrom: "ship", health: 0.96, boostFactor: 4 });
    expect(fsdWearEstimate(st).wearPerBoost).toBeCloseTo(0.01, 6);
  });

  it("lends a drive's wear to another ship with the same drive, and forgets it when the drive changes", () => {
    const st = newFsdWear();
    fsdWearLoadout(st, loadout(1));
    boost(st, 4);
    fsdWearLoadout(st, loadout(0.96));
    fsdWearLoadout(st, loadout(1, 8));
    expect(fsdWearEstimate(st)).toMatchObject({ wearFrom: "drive" });
    fsdWearLoadout(st, loadout(1, 7, "int_hyperdrive_overcharge_size5_class5"));
    expect(fsdWearEstimate(st).wearFrom).toBe("default");
  });

  it("is full again after a repair of the drive, and does not learn across one", () => {
    const st = newFsdWear();
    fsdWearLoadout(st, loadout(0.85));
    boost(st, 3);
    fsdWearRepair(st, { event: "Repair", Items: ["int_hyperdrive_size5_class5"] });
    expect(fsdWearEstimate(st).health).toBe(1);
    fsdWearRepair(st, { event: "Repair", Items: ["hpt_pulselaser_fixed_small"] });
    fsdWearLoadout(st, loadout(1));
    expect(st.ships["7"]!.boosts).toBe(0);
  });

  it("reads back what it wrote, and nothing from the old single-ship shape", () => {
    const st = newFsdWear();
    fsdWearLoadout(st, loadout(0.9));
    boost(st, 1);
    expect(hydrateFsdWear(structuredClone(st))).toEqual(st);
    expect(hydrateFsdWear({ shipId: 7, health: 0.9, boostsSince: 1 })).toEqual(newFsdWear());
  });
});
