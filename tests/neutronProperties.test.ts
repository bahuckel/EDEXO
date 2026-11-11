/**
 * Neutron planner properties over random ships and star fields (review 2026-11-10 T14, plan 2.1): whatever the
 * stars, a plan never refuels at a star past the scoop limit, never lands with less than nothing, reaches every
 * neutron star it does not refuel at with a jump's fuel or more (a refuel star may be reached on the last of the tank),
 * and keeps the reserve asked for, at most half a tank, on every leg it does not flag.
 *
 * Seeded, so a failure names its case and runs the same again.
 */
import { describe, expect, it } from "vitest";
import { planNeutronRoute, type NeutronShip } from "../src/server/neutronRoute.js";
import type { NeutronStar } from "../src/server/neutronIndex.js";

/** mulberry32: a small seeded generator, the same numbers on every run. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Case = {
  seed: number;
  ship: NeutronShip;
  index: { within: (p: { x: number; y: number; z: number }, r: number) => NeutronStar[]; nameOf: (i: number) => string };
  waypoints: { name: string; x: number; y: number; z: number }[];
  scoopOf: Map<string, number | null>;
};

function makeCase(seed: number): Case {
  const r = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]!;
  const length = 400 + r() * 2600;
  const stars: NeutronStar[] = [];
  const scoopOf = new Map<string, number | null>();
  const count = 10 + Math.floor(r() * 50);
  for (let i = 0; i < count; i++) {
    const scoopLs = pick([null, null, Math.round(50 + r() * 4900), Math.round(5001 + r() * 45000)]);
    const s = { i, x: r() * length, y: (r() - 0.5) * 60, z: (r() - 0.5) * 60, scoopLs };
    stars.push(s);
    scoopOf.set(`N${i}`, scoopLs);
  }
  const jumpsPerTank = 3 + Math.floor(r() * 6);
  const rangeLy = 20 + r() * 60;
  const ship: NeutronShip = {
    rangeLy,
    jumpsPerTank,
    jumpsNow: 1 + Math.floor(r() * jumpsPerTank),
    boost: 4,
    reserve: pick([0, 0, 0.1, 0.25, 0.8]),
  };
  // Half the ships count fuel by a drive's law: a jump burns by its length (power 2.45), so tanks run fractional.
  if (r() < 0.5) {
    const tankT = jumpsPerTank * 8;
    const perJumpT = 8 * (0.6 + r() * 0.4);
    ship.law = {
      tankT,
      perJumpT,
      fuelT: (ly) => perJumpT * Math.min(1, ly / rangeLy) ** 2.45,
      rangeLy: () => rangeLy,
    };
    ship.fuelNowT = tankT * (0.2 + r() * 0.8);
  }
  const waypoints = [{ name: "A", x: 0, y: 0, z: 0 }];
  if (r() < 0.4) waypoints.push({ name: "M", x: length / 2, y: 10, z: -10 });
  waypoints.push({ name: "B", x: length, y: 0, z: 0 });
  return {
    seed,
    ship,
    waypoints,
    scoopOf,
    index: {
      within: (p, rad) => stars.filter((s) => Math.hypot(s.x - p.x, s.y - p.y, s.z - p.z) <= rad),
      nameOf: (i) => `N${i}`,
    },
  };
}

const CASES = Array.from({ length: 40 }, (_, i) => makeCase(1000 + i));

/** Each hop with the leg it belongs to (1 = the first; a waypoint hop ends its leg). */
function withLegs(hops: Awaited<ReturnType<typeof planNeutronRoute>>["hops"]) {
  let leg = 1;
  return hops.map((h, i) => {
    const out = { h, i, leg };
    if (i > 0 && h.kind === "waypoint") leg++;
    return out;
  });
}

describe("the neutron planner over random star fields", () => {
  it.each(CASES.map((c) => [c.seed, c] as const))("case %i: scoop limit, fuel floor, neutron arrivals, reserve", async (_seed, c) => {
    const plan = await planNeutronRoute(c.index, c.waypoints, c.ship, 20);
    const flagged = new Set([...plan.unsafeLegs, ...(plan.reserveDropped ?? [])]);
    // At most half a tank (MAX_RESERVE) and the 5,000 ls scoop limit (MAX_SCOOP_LS), written out so a change to either fails.
    const tank = c.ship.jumpsPerTank;
    const law = c.ship.law;
    // A jump's most fuel in tank units (1 without the law), and the 1 % spare the law keeps.
    const perU = law ? Math.min(1, law.perJumpT / (law.tankT / tank)) : 1;
    const keepJumps = Math.max(law ? 0.01 * tank : 0, Math.min(0.5, c.ship.reserve ?? 0) * tank) / perU;
    for (const { h, i, leg } of withLegs(plan.hops)) {
      if (h.refuel) {
        expect(h.scoopLs, `hop ${i} refuels`).not.toBeNull();
        expect(h.scoopLs!, `hop ${i} refuels`).toBeLessThanOrEqual(5000);
        expect(c.scoopOf.get(h.name), `hop ${i} is the star it names`).toBe(h.scoopLs);
      }
      if (h.fuelArrive == null || i === 0 || plan.unsafeLegs.includes(leg)) continue;
      expect(h.fuelArrive, `hop ${i} lands with fuel`).toBeGreaterThanOrEqual(0);
      if (h.kind === "neutron" && !h.refuel) expect(h.fuelArrive, `hop ${i} reaches a neutron with a jump left`).toBeGreaterThanOrEqual(1 - 1e-9);
      if (!flagged.has(leg)) expect(h.fuelArrive, `hop ${i} keeps the reserve`).toBeGreaterThanOrEqual(keepJumps - 0.01);
    }
  });

  /*
    Review 2026-11-10 B6 (Phase 6, not fixed): a stop with more legs after it may be reached with no fuel, unflagged,
    and the next leg then falls to the plain plot. Fails today; it passes once the planner treats a leg's end like a
    star (a jump's fuel or a scoop on the way). Remove `.fails` with that fix.
  */
  it.fails("reaches a waypoint with more legs after it with a jump of fuel left", async () => {
    const none = { within: () => [], nameOf: (i: number) => `N${i}` };
    const ship = { rangeLy: 50, jumpsPerTank: 5, jumpsNow: 5 };
    const plan = await planNeutronRoute(
      none,
      [{ name: "A", x: 0, y: 0, z: 0 }, { name: "B", x: 250, y: 0, z: 0 }, { name: "C", x: 400, y: 0, z: 0 }],
      ship,
      20,
    );
    const b = plan.hops.find((h) => h.name === "B")!;
    expect(b.fuelArrive! >= 1 || b.scoopOnWay).toBe(true);
  });
});
