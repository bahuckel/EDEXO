/**
 * A plan replaced by another keeps its ticks for a while (audit 2026-10-22): switching a filter off and on again, or
 * the other ship, builds the same plan again under the same key, and its ticks come back.
 */
import { describe, expect, it } from "vitest";
import { createTripPlanSnapshot, parseTripPlanSnapshot, planDepotFingerprint, planRefreshFingerprint, type TripPlanSnapshot } from "../../src/shared/colonize/tripPlanProgress";
import type { DepotSnapshot } from "../../src/shared/colonize/types";

const plan = { trips: [{ tripNumber: 1, stops: [] }] } as unknown as TripPlanSnapshot["plan"];
const depots = [{ marketId: "1", resources: [], contributions: [{ commodityId: "steel", totalTons: 10 }] }] as unknown as DepotSnapshot[];
const ticked = (s: TripPlanSnapshot, ids: string[]): TripPlanSnapshot => ({ ...s, manualCompletedLineIds: ids });

describe("earlier plans' ticks", () => {
  it("come back when the plan's key comes back, with its starting point for deliveries", () => {
    const a = ticked(createTripPlanSnapshot(plan, "A", depots), ["t1-s0-b-steel"]);
    const later = [{ marketId: "1", resources: [], contributions: [{ commodityId: "steel", totalTons: 99 }] }] as unknown as DepotSnapshot[];
    const b = ticked(createTripPlanSnapshot(plan, "B", later, a), ["t1-s0-b-titanium"]);
    expect(b.manualCompletedLineIds).toEqual(["t1-s0-b-titanium"]);
    expect(b.earlier?.map((e) => e.planRefreshKey)).toEqual(["A"]);

    const backToA = createTripPlanSnapshot(plan, "A", later, b);
    expect(backToA.manualCompletedLineIds).toEqual(["t1-s0-b-steel"]);
    expect(backToA.baselineContributions).toEqual({ "1": { steel: 10 } });
    expect(backToA.earlier?.map((e) => e.planRefreshKey)).toEqual(["B"]);
  });

  it("keeps three, newest first, and survives being saved and read back", () => {
    let s = createTripPlanSnapshot(plan, "K0", depots);
    for (let i = 1; i <= 5; i++) s = createTripPlanSnapshot(plan, `K${i}`, depots, ticked(s, [`x${i - 1}`]));
    expect(s.earlier?.map((e) => e.planRefreshKey)).toEqual(["K4", "K3", "K2"]);
    const read = parseTripPlanSnapshot(JSON.stringify(s));
    expect(read?.earlier?.map((e) => [e.planRefreshKey, e.manualCompletedLineIds])).toEqual([
      ["K4", ["x4"]],
      ["K3", ["x3"]],
      ["K2", ["x2"]],
    ]);
  });

  it("is nothing on a first plan or the same key", () => {
    const a = createTripPlanSnapshot(plan, "A", depots);
    expect(a.earlier).toBeUndefined();
    expect(createTripPlanSnapshot(plan, "A", depots, a).earlier).toBeUndefined();
  });
});

describe("a delivery in any order", () => {
  const site = (provided: number) =>
    [{ marketId: "1", resources: [{ name: "steel", nameLocalised: "Steel", required: 500, provided, payment: null }], contributions: [] }] as unknown as DepotSnapshot[];
  it("makes a new plan from what is left; the sites part the HUD compares stays the same", () => {
    const before = planRefreshFingerprint(site(0), 80, "co", "cn");
    const after = planRefreshFingerprint(site(80), 80, "co", "cn");
    expect(after).not.toBe(before);
    expect(after.startsWith(`${planDepotFingerprint(site(80))}|cap:`)).toBe(true);
    expect(planDepotFingerprint(site(80))).toBe(planDepotFingerprint(site(0)));
  });
});
