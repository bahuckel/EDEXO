import { describe, expect, it } from "vitest";
import { galaxyDistancePairKey } from "../../../src/shared/colonize/systemDistanceLy";
import type { DepotSnapshot, ResourceRow } from "../../../src/shared/colonize/types";
import type { MaterialBuyListing, MaterialBuyStationHit } from "../../../src/shared/colonize/materialBuyIndexTypes";
import { buildLogisticsPlan } from "../../../src/shared/colonize/planner/buildPlan";
import { legLy, measuredLegLy, type SystemCoordsByNorm } from "../../../src/shared/colonize/planner/legLy";
import { orderBuyStopsForTrip, sumBuyRouteLy } from "../../../src/shared/colonize/planner/routing";
import type { TripStop } from "../../../src/shared/colonize/planner/types";

/**
 * S-13. A site at the origin; East and West 40 Ly out on opposite sides, Next Door 42 Ly out
 * beside East. Measured from the site alone, East and West look 0 Ly apart.
 */
const SITE = "Site";
const coords: SystemCoordsByNorm = {
  site: [0, 0, 0],
  east: [40, 0, 0],
  west: [-40, 0, 0],
  "next door": [42, 0, 0],
};

describe("legLy", () => {
  it("measures the straight line when both systems are placed", () => {
    expect(legLy({ systemName: "East", ly: 40 }, { systemName: "West", ly: 40 }, coords)).toBe(80);
  });

  it("is 0 within one system, placed or not", () => {
    expect(measuredLegLy("Nowhere", "nowhere")).toBe(0);
  });

  it("falls back to the radial difference — a floor — when a system is not placed", () => {
    expect(measuredLegLy("East", "Unplaced", coords)).toBeNull();
    expect(legLy({ systemName: "East", ly: 40 }, { systemName: "Unplaced", ly: 55 }, coords)).toBe(15);
  });
});

function buy(systemName: string, ly: number): TripStop {
  return {
    stopIndex: 0,
    kind: "buy",
    systemName,
    stationName: `${systemName} Port`,
    distanceLy: ly,
    constructionDistanceLy: ly,
    buys: [],
    deliverTo: [],
    cargoLoaded: 0,
  };
}

describe("orderBuyStopsForTrip", () => {
  const stops = [buy("East", 40), buy("West", 40), buy("Next Door", 42)];

  it("goes to the neighbour before crossing to the far side", () => {
    const ordered = orderBuyStopsForTrip(stops, coords).map((s) => s.systemName);
    expect(ordered).toEqual(["East", "Next Door", "West"]);
  });

  it("without coordinates, crosses first — the radial picture it replaced", () => {
    const ordered = orderBuyStopsForTrip(stops).map((s) => s.systemName);
    expect(ordered).toEqual(["East", "West", "Next Door"]);
  });
});

describe("sumBuyRouteLy", () => {
  it("is the loop from the site through the sellers and back", () => {
    // 40 out, 2 across, 82 across, 40 home.
    expect(sumBuyRouteLy([buy("East", 40), buy("Next Door", 42), buy("West", 40)], coords)).toBe(164);
  });

  it("counts one seller there and back", () => {
    expect(sumBuyRouteLy([buy("East", 40)])).toBe(80);
  });
});

function row(name: string, required: number): ResourceRow {
  return { name, nameLocalised: name, required, provided: 0, payment: null };
}

function hit(systemName: string, marketId: string, ly: number, commodity: string): MaterialBuyStationHit {
  return {
    systemName,
    stationName: `${systemName} Port`,
    marketId,
    distanceLy: ly,
    buyPrice: 100,
    supply: 10_000,
    spanshCommodity: commodity,
    dataSource: "spansh",
    stationType: "Coriolis Starport",
    isPlanetaryOrGround: false,
    pad: "L",
    foundAtIso: "2026-09-01T10:00:00Z",
  };
}

describe("buildLogisticsPlan with coordinates", () => {
  const depot: DepotSnapshot = {
    marketId: "1",
    starSystem: SITE,
    systemAddress: null,
    stationName: "Site A",
    constructionSiteLabel: "Site A",
    progress: 0,
    complete: false,
    failed: false,
    lastTimestamp: null,
    resources: [row("Steel", 50), row("Titanium", 50), row("Aluminium", 50)],
    contributions: [],
    progressHistory: [],
    contributionProgressHistory: [],
  };
  const listings: MaterialBuyListing[] = [
    { id: "steel", label: "Steel", quantityNeeded: 50, servedFromCache: true, stations: [hit("East", "10", 40, "Steel")] },
    { id: "titanium", label: "Titanium", quantityNeeded: 50, servedFromCache: true, stations: [hit("West", "20", 40, "Titanium")] },
    { id: "aluminium", label: "Aluminium", quantityNeeded: 50, servedFromCache: true, stations: [hit("Next Door", "30", 42, "Aluminium")] },
  ];
  const distances = Object.fromEntries(
    (
      [
        ["East", 40],
        ["West", 40],
        ["Next Door", 42],
      ] as const
    ).map(([s, ly]) => [galaxyDistancePairKey(SITE, s), ly]),
  );

  function planWith(systemCoords?: SystemCoordsByNorm) {
    return buildLogisticsPlan({
      checkouts: [],
      activeDepots: [depot],
      cargoByKey: new Map(),
      cargoCapacity: 500,
      wing: [],
      shopHistory: [],
      homeSystem: SITE,
      constructionDistanceSystems: [SITE],
      systemDistanceLy: distances,
      buyListings: listings,
      systemCoords,
    });
  }

  it("visits the two neighbours together and the far side last", () => {
    const p = planWith(coords);
    const trip = p.trips[0]!;
    const route = trip.stops.filter((s) => s.kind === "buy").map((s) => s.systemName);
    expect(route).toEqual(["East", "Next Door", "West"]);
    expect(trip.buyRouteLy).toBe(164);
  });

  it("crossed to the far side and back before S-13", () => {
    const trip = planWith().trips[0]!;
    const route = trip.stops.filter((s) => s.kind === "buy").map((s) => s.systemName);
    expect(route).toEqual(["East", "West", "Next Door"]);
  });
});
