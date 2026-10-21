import { describe, expect, it } from "vitest";
import { syncTripLineCompletions, tripBuyLineId, tripDeliverLineId } from "../../src/shared/colonize/tripPlanProgress";
import type { TripPlanSnapshot } from "../../src/shared/colonize/tripPlanProgress";
import type { HaulTrip, LogisticsPlan, TripStop } from "../../src/shared/colonize/logisticsPlanner";
import type { DepotSnapshot } from "../../src/shared/colonize/types";

const DEPOT_LABEL = "Site A";

function depot(): DepotSnapshot {
  return {
    marketId: "depot-a",
    starSystem: "Test System",
    systemAddress: null,
    stationName: DEPOT_LABEL,
    constructionSiteLabel: DEPOT_LABEL,
    progress: 0,
    complete: false,
    failed: false,
    lastTimestamp: null,
    resources: [{ name: "Steel", nameLocalised: "Steel", required: 200, provided: 0, payment: null }],
    contributions: [],
    progressHistory: [],
    contributionProgressHistory: [],
  };
}

function buyStop(stopIndex: number, tons: number): TripStop {
  return {
    stopIndex,
    kind: "buy",
    systemName: "Seller",
    stationName: "Seller Station",
    distanceLy: 10,
    buys: [
      { commodityId: "steel", label: "Steel", buyTons: tons, buyPrice: 100, forDepots: [DEPOT_LABEL], stillNeedTotal: 0 },
    ],
    deliverTo: [DEPOT_LABEL],
    cargoLoaded: tons,
  };
}

function deliverStop(stopIndex: number, tons: number): TripStop {
  return {
    stopIndex,
    kind: "deliver",
    systemName: "Test System",
    stationName: DEPOT_LABEL,
    distanceLy: 0,
    buys: [],
    deliverTo: [DEPOT_LABEL],
    deliveries: [
      {
        depotMarketId: "depot-a",
        depotLabel: DEPOT_LABEL,
        systemName: "Test System",
        materials: [{ commodityId: "steel", label: "Steel", tons }],
      },
    ],
    cargoLoaded: 0,
  };
}

function trip(tripNumber: number, tons: number): HaulTrip {
  return {
    tripNumber,
    loadTons: tons,
    capacity: 100,
    buyRouteLy: 10,
    stops: [buyStop(1, tons), deliverStop(2, tons)],
  };
}

function snapshot(trips: HaulTrip[]): TripPlanSnapshot {
  const plan: LogisticsPlan = {
    homeSystem: "Test System",
    capacity: 100,
    cargoOnHand: 0,
    cargoFree: 100,
    totalRemainingTons: 200,
    trips,
    warnings: [],
    missingBuyIndexed: [],
    missingTripEligible: [],
    dockBuys: [],
  };
  return {
    planRefreshKey: "k",
    plan,
    baselineContributions: {},
    manualCompletedLineIds: [],
    createdAt: new Date().toISOString(),
  };
}

describe("syncTripLineCompletions", () => {
  it("auto-completes the next trip's buy once the previous trip has been delivered", () => {
    const snap = snapshot([trip(1, 100), trip(2, 100)]);

    // Trip 1 is done end to end: bought and delivered.
    const tripOneDone = [
      tripBuyLineId(1, 1, "steel"),
      tripDeliverLineId(1, 2, "depot-a", "steel"),
    ];
    // The hold now carries trip 2's 100 t.
    const cargo = new Map([["steel", 100]]);

    const completed = syncTripLineCompletions(snap, [depot()], cargo, tripOneDone);

    // Trip 1's delivered cargo used to be subtracted from the current hold as well,
    // driving the pool to zero (and below), so trip 2's buy never ticked itself off.
    expect(completed).toContain(tripBuyLineId(2, 1, "steel"));
  });

  it("still holds back a trip whose goods are not aboard yet", () => {
    const snap = snapshot([trip(1, 100), trip(2, 100)]);
    const tripOneDone = [
      tripBuyLineId(1, 1, "steel"),
      tripDeliverLineId(1, 2, "depot-a", "steel"),
    ];

    const completed = syncTripLineCompletions(snap, [depot()], new Map(), tripOneDone);
    expect(completed).not.toContain(tripBuyLineId(2, 1, "steel"));
  });

  it("does not credit a trip that was bought but not yet delivered twice over", () => {
    const snap = snapshot([trip(1, 100), trip(2, 100)]);
    // Bought trip 1, still carrying it, nothing delivered.
    const bought = [tripBuyLineId(1, 1, "steel")];
    const cargo = new Map([["steel", 100]]);

    const completed = syncTripLineCompletions(snap, [depot()], cargo, bought);

    // Those 100 t are spoken for by trip 1, so trip 2 must not claim them as well.
    expect(completed).not.toContain(tripBuyLineId(2, 1, "steel"));
  });

  it("keeps every manually ticked line", () => {
    const snap = snapshot([trip(1, 100)]);
    const manual = [tripBuyLineId(1, 1, "steel")];
    expect(syncTripLineCompletions(snap, [depot()], new Map(), manual)).toContain(manual[0]!);
  });
});
