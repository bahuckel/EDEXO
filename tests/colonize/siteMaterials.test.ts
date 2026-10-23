/**
 * One order for a site's materials everywhere (owner, 2026-10-22): still needed first, biggest first; delivered in
 * full last. And the bars' "have" for a trip's buy lines, from the same walk that ticks them.
 */
import { describe, expect, it } from "vitest";
import { siteMaterials, siteTotals, tonsLeftById } from "../../src/shared/colonize/siteMaterials";
import { syncTripLineCompletions, tripBuyLineId, tripBuyProgress, type TripPlanSnapshot } from "../../src/shared/colonize/tripPlanProgress";
import type { DepotSnapshot } from "../../src/shared/colonize/types";

const site = (res: [string, number, number][], progress: number | null = null) =>
  ({
    marketId: "1",
    resources: res.map(([n, required, provided]) => ({ name: n.toLowerCase(), nameLocalised: n, required, provided, payment: 1 })),
    contributions: [],
    progress,
  }) as unknown as DepotSnapshot;

describe("siteMaterials", () => {
  it("puts open materials first by tons left, then delivered ones by name", () => {
    const d = site([
      ["Titanium", 200, 200],
      ["Steel", 1000, 400],
      ["Aluminium", 50, 50],
      ["Polymers", 300, 0],
      ["Water", 0, 0],
    ]);
    expect(siteMaterials(d).map((m) => [m.label, m.left, m.done])).toEqual([
      ["Steel", 600, false],
      ["Polymers", 300, false],
      ["Aluminium", 0, true],
      ["Titanium", 0, true],
    ]);
  });

  it("counts what is aboard only up to what is left", () => {
    const d = site([["Steel", 1000, 400]]);
    expect(siteMaterials(d, new Map([["steel", 700]]))[0]!.aboard).toBe(600);
    expect(siteMaterials(d, new Map([["steel", 70]]))[0]!.aboard).toBe(70);
  });

  it("totals a site, preferring the journal's own progress", () => {
    expect(siteTotals(site([["Steel", 1000, 250]]))).toEqual({ required: 1000, remaining: 750, pct: 25 });
    expect(siteTotals(site([["Steel", 1000, 250]], 0.4)).pct).toBeCloseTo(40);
  });

  it("adds up what each commodity still needs across sites", () => {
    expect(tonsLeftById([site([["Steel", 100, 40]]), site([["Steel", 50, 50]])]).get("steel")).toBe(60);
  });
});

const snapshot: TripPlanSnapshot = {
  planRefreshKey: "k",
  createdAt: "",
  baselineContributions: {},
  manualCompletedLineIds: [],
  plan: {
    trips: [
      {
        tripNumber: 1,
        loadTons: 100,
        capacity: 100,
        stops: [
          { stopIndex: 0, kind: "buy", systemName: "A", stationName: "One", buys: [{ commodityId: "steel", label: "Steel", buyTons: 50 }] },
          { stopIndex: 1, kind: "buy", systemName: "B", stationName: "Two", buys: [{ commodityId: "steel", label: "Steel", buyTons: 50 }] },
          { stopIndex: 2, kind: "deliver", systemName: "C", stationName: "Site", buys: [], deliveries: [] },
        ],
      },
    ],
  } as unknown as TripPlanSnapshot["plan"],
};

describe("tripBuyProgress", () => {
  it("fills the first stop's line first, and ticks exactly what syncTripLineCompletions ticks", () => {
    const cargo = new Map([["steel", 70]]);
    const p = tripBuyProgress(snapshot, [], cargo, []);
    expect(p.haveByLineId.get(tripBuyLineId(1, 0, "steel"))).toBe(50);
    expect(p.haveByLineId.get(tripBuyLineId(1, 1, "steel"))).toBe(20);
    expect([...p.completed].sort()).toEqual(syncTripLineCompletions(snapshot, [], cargo, []).sort());
    expect(p.completed.has(tripBuyLineId(1, 0, "steel"))).toBe(true);
    expect(p.trip?.tripNumber).toBe(1);
  });

  it("counts a line ticked by hand as full", () => {
    const p = tripBuyProgress(snapshot, [], new Map(), [tripBuyLineId(1, 1, "steel")]);
    expect(p.haveByLineId.get(tripBuyLineId(1, 1, "steel"))).toBe(50);
    expect(p.haveByLineId.get(tripBuyLineId(1, 0, "steel"))).toBe(0);
  });
});
