/**
 * Review 2026-11-10 B13: a neutron plan whose page has gone (closed, or a newer plan asked for) stops instead of running
 * on for nobody; a signal that never fires changes nothing.
 */
import { describe, expect, it } from "vitest";
import { planNeutronRoute } from "../src/server/neutronRoute.js";
import type { NeutronStar } from "../src/server/neutronIndex.js";

function line(x0: number, x1: number, step: number) {
  const stars: NeutronStar[] = [];
  for (let x = x0, i = 0; x <= x1; x += step, i++) stars.push({ i, x, y: 0, z: 0, scoopLs: null });
  return {
    within: (p: { x: number; y: number; z: number }, r: number) =>
      stars.filter((s) => Math.hypot(s.x - p.x, s.y - p.y, s.z - p.z) <= r),
    nameOf: (i: number) => `N${i}`,
  };
}
const ship = { rangeLy: 51.1, jumpsPerTank: 100, jumpsNow: 100 };
const stops = [
  { name: "A", x: 0, y: 0, z: 0 },
  { name: "B", x: 2050, y: 0, z: 0 },
];

describe("neutron plan abort", () => {
  it("rejects with the abort when the request has already gone", async () => {
    const gone = new AbortController();
    gone.abort();
    await expect(planNeutronRoute(line(50, 1850, 200), stops, ship, undefined, gone.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("plans the same route with a signal that never fires", async () => {
    const idx = line(50, 1850, 200);
    const plain = await planNeutronRoute(idx, stops, ship);
    const watched = await planNeutronRoute(idx, stops, ship, undefined, new AbortController().signal);
    expect(watched.hops.map((h) => h.name)).toEqual(plain.hops.map((h) => h.name));
    expect(watched.jumps).toBe(plain.jumps);
  });
});
