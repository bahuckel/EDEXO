import { describe, expect, it } from "vitest";
import { depotDisplayLabel, uniqueDepotLabels } from "../../src/shared/colonize/depotLabel";
import { buildDepotNeedStates, makeDeliverStops, recordTripAllocation } from "../../src/shared/colonize/planner/needs";
import type { HaulTrip, LogisticsPlan, TripAllocationMap } from "../../src/shared/colonize/planner/types";
import { syncTripLineCompletions, tripDeliverLineId, type TripPlanSnapshot } from "../../src/shared/colonize/tripPlanProgress";
import type { DepotSnapshot } from "../../src/shared/colonize/types";

/**
 * S-8: two construction sites can share a name. They used to be matched by that name, so they
 * shared an allocation, a set of trip ticks and a contribution baseline.
 */
function site(marketId: string, system: string, label = "Hutton Halt", provided = 0): DepotSnapshot {
  return {
    marketId,
    starSystem: system,
    systemAddress: null,
    stationName: `Orbital Construction Site: ${label}`,
    constructionSiteLabel: label,
    progress: 0,
    complete: false,
    failed: false,
    lastTimestamp: null,
    resources: [{ name: "Steel", nameLocalised: "Steel", required: 100, provided, payment: null }],
    contributions: provided
      ? [{ commodityId: "steel", name: "Steel", nameLocalised: "Steel", totalTons: provided, lastTimestamp: null }]
      : [],
    progressHistory: [],
    contributionProgressHistory: [],
  } as DepotSnapshot;
}

describe("uniqueDepotLabels", () => {
  it("leaves unique names alone and tells clashing ones apart", () => {
    const labels = uniqueDepotLabels([
      site("1", "Sol"),
      site("2", "Achenar"),
      site("3", "Achenar"),
      site("4", "Lave", "Unique Base"),
    ]);
    expect(labels.get("4")).toBe("Unique Base");
    expect(labels.get("1")).toBe("Hutton Halt (Sol)");
    expect(labels.get("2")).toBe("Hutton Halt (Achenar) · 2");
    expect(labels.get("3")).toBe("Hutton Halt (Achenar) · 3");
    expect(depotDisplayLabel(site("5", "Sol"))).toBe("Hutton Halt");
  });
});

describe("two sites with one name", () => {
  const a = site("100", "Sol");
  const b = site("200", "Achenar");

  it("each get their own delivery — not both the merged total", () => {
    const states = buildDepotNeedStates([a, b], []);
    const alloc: TripAllocationMap = new Map();
    recordTripAllocation(alloc, states, "steel", "Steel", 150);
    const deliveries = makeDeliverStops(1, alloc, states, 150, "Sol").flatMap((s) => s.deliveries ?? []);
    expect(deliveries.map((d) => [d.depotMarketId, d.materials[0]!.tons])).toEqual([
      ["100", 100],
      ["200", 50],
    ]);
    /** The old keying handed each site the merged 150 t: 300 t delivered from a 150 t hold. */
    expect(deliveries.reduce((t, d) => t + d.materials[0]!.tons, 0)).toBe(150);
  });

  it("have separate tick-boxes, and a delivery to one does not tick the other", () => {
    const trip: HaulTrip = {
      tripNumber: 1,
      loadTons: 100,
      capacity: 200,
      buyRouteLy: 0,
      stops: [
        {
          stopIndex: 1,
          kind: "deliver",
          systemName: "Sol",
          stationName: "sites",
          distanceLy: 0,
          buys: [],
          deliverTo: [],
          deliveries: [
            { depotMarketId: "100", depotLabel: "Hutton Halt (Sol)", systemName: "Sol", materials: [{ commodityId: "steel", label: "Steel", tons: 50 }] },
            { depotMarketId: "200", depotLabel: "Hutton Halt (Achenar)", systemName: "Achenar", materials: [{ commodityId: "steel", label: "Steel", tons: 50 }] },
          ],
          cargoLoaded: 100,
        },
      ],
    };
    const snap: TripPlanSnapshot = {
      planRefreshKey: "k",
      plan: { trips: [trip] } as LogisticsPlan,
      baselineContributions: { "100": {}, "200": {} },
      manualCompletedLineIds: [],
      createdAt: "2026-09-24T00:00:00Z",
    };
    /** Only the Achenar site has received its 50 t since the plan was made. */
    const done = syncTripLineCompletions(snap, [site("100", "Sol"), site("200", "Achenar", "Hutton Halt", 50)], new Map(), []);
    expect(done).toContain(tripDeliverLineId(1, 1, "200", "steel"));
    expect(done).not.toContain(tripDeliverLineId(1, 1, "100", "steel"));
  });
});
