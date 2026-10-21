import { describe, expect, it } from "vitest";
import { buildLogisticsPlan } from "../../../src/shared/colonize/planner/buildPlan";
import { galaxyDistancePairKey } from "../../../src/shared/colonize/systemDistanceLy";
import type { DepotSnapshot, ResourceRow } from "../../../src/shared/colonize/types";
import type { MaterialBuyListing, MaterialBuyStationHit } from "../../../src/shared/colonize/materialBuyIndexTypes";

const SITE_SYSTEM = "Examplia AB-C d1-2";
const SELLER_SYSTEM = "Nervi";
const SELLER_TWO = "Tarach Tor";

function row(name: string, required: number, provided = 0): ResourceRow {
  return { name, nameLocalised: name, required, provided, payment: null };
}

function depot(marketId: string, label: string, resources: ResourceRow[], system = SITE_SYSTEM): DepotSnapshot {
  return {
    marketId,
    starSystem: system,
    systemAddress: null,
    stationName: label,
    constructionSiteLabel: label,
    progress: 0,
    complete: false,
    failed: false,
    lastTimestamp: null,
    resources,
    contributions: [],
    progressHistory: [],
    contributionProgressHistory: [],
  };
}

function hit(over: Partial<MaterialBuyStationHit> = {}): MaterialBuyStationHit {
  return {
    systemName: SELLER_SYSTEM,
    stationName: "Seller Coriolis",
    marketId: "100",
    distanceLy: 12,
    buyPrice: 100,
    supply: 10_000,
    spanshCommodity: "Steel",
    dataSource: "spansh",
    stationType: "Coriolis Starport",
    isPlanetaryOrGround: false,
    pad: "L",
    foundAtIso: "2026-09-01T10:00:00Z",
    ...over,
  };
}

function listing(id: string, label: string, qty: number, stations: MaterialBuyStationHit[]): MaterialBuyListing {
  return { id, label, quantityNeeded: qty, servedFromCache: true, stations };
}

/** Distances are keyed site → seller; without them every seller reads as unknown. */
function distances(pairs: [string, string, number][]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [from, to, ly] of pairs) out[galaxyDistancePairKey(from, to)] = ly;
  return out;
}

function plan(over: Partial<Parameters<typeof buildLogisticsPlan>[0]> = {}) {
  return buildLogisticsPlan({
    checkouts: [],
    activeDepots: [depot("a", "Site A", [row("Steel", 100)])],
    cargoByKey: new Map(),
    cargoCapacity: 200,
    wing: [],
    shopHistory: [],
    homeSystem: SITE_SYSTEM,
    constructionDistanceSystems: [SITE_SYSTEM],
    systemDistanceLy: distances([[SITE_SYSTEM, SELLER_SYSTEM, 12]]),
    buyListings: [listing("steel", "Steel", 100, [hit()])],
    ...over,
  });
}

describe("buildLogisticsPlan", () => {
  it("buys what two sites need and delivers to both", () => {
    const p = plan({
      activeDepots: [
        depot("a", "Site A", [row("Steel", 100)]),
        depot("b", "Site B", [row("Steel", 100)]),
      ],
      buyListings: [listing("steel", "Steel", 200, [hit()])],
    });

    expect(p.trips.length).toBeGreaterThan(0);
    expect(p.totalRemainingTons).toBe(0);

    const bought = p.trips
      .flatMap((t) => t.stops)
      .filter((s) => s.kind === "buy")
      .flatMap((s) => s.buys)
      .reduce((sum, b) => sum + b.buyTons, 0);
    expect(bought).toBe(200);

    const deliveredTo = new Set(
      p.trips
        .flatMap((t) => t.stops)
        .filter((s) => s.kind === "deliver")
        .flatMap((s) => s.deliveries ?? [])
        .map((d) => d.depotLabel),
    );
    expect([...deliveredTo].sort()).toEqual(["Site A", "Site B"]);
  });

  it("never loads more than the hold takes in one trip", () => {
    const p = plan({
      activeDepots: [depot("a", "Site A", [row("Steel", 500)])],
      cargoCapacity: 200,
      buyListings: [listing("steel", "Steel", 500, [hit()])],
    });

    for (const trip of p.trips) {
      const loaded = trip.stops
        .filter((s) => s.kind === "buy")
        .flatMap((s) => s.buys)
        .reduce((sum, b) => sum + b.buyTons, 0);
      expect(loaded).toBeLessThanOrEqual(200);
    }
  });

  it("counts cargo already aboard instead of buying it again", () => {
    const p = plan({
      activeDepots: [depot("a", "Site A", [row("Steel", 200)])],
      cargoByKey: new Map([["steel", 120]]),
      cargoCapacity: 200,
      buyListings: [listing("steel", "Steel", 200, [hit()])],
    });

    const bought = p.trips
      .flatMap((t) => t.stops)
      .filter((s) => s.kind === "buy")
      .flatMap((s) => s.buys)
      .reduce((sum, b) => sum + b.buyTons, 0);
    expect(bought).toBe(80);
    expect(p.cargoOnHand).toBe(120);
  });

  it("gives each construction system its own delivery stop", () => {
    // One stop used to be emitted for everything, labelled with the first site's system.
    const p = plan({
      activeDepots: [
        depot("a", "Site A", [row("Steel", 50)], SITE_SYSTEM),
        depot("b", "Site B", [row("Steel", 50)], "Hutton"),
      ],
      constructionDistanceSystems: [SITE_SYSTEM, "Hutton"],
      systemDistanceLy: distances([
        [SITE_SYSTEM, SELLER_SYSTEM, 12],
        ["Hutton", SELLER_SYSTEM, 20],
      ]),
      buyListings: [listing("steel", "Steel", 100, [hit()])],
    });

    const deliverSystems = p.trips
      .flatMap((t) => t.stops)
      .filter((s) => s.kind === "deliver")
      .map((s) => s.systemName);
    expect(new Set(deliverSystems)).toEqual(new Set([SITE_SYSTEM, "Hutton"]));
  });

  it("reports a material no station sells", () => {
    const p = plan({
      activeDepots: [depot("a", "Site A", [row("Steel", 100), row("Titanium", 40)])],
      buyListings: [listing("steel", "Steel", 100, [hit()])],
    });

    const reported = [...p.missingBuyIndexed, ...p.missingTripEligible].map((m) => m.label);
    expect(reported).toContain("Titanium");
  });

  it("reports a material whose only seller the filters exclude", () => {
    // The seller exists, so it is not "missing from the index" — but nothing can buy there,
    // and a material that silently vanishes from both lists is the worst outcome.
    const p = plan({
      activeDepots: [depot("a", "Site A", [row("Steel", 100)])],
      minLandingPad: "L",
      buyListings: [
        listing("steel", "Steel", 100, [
          hit({ stationName: "Tiny Outpost", stationType: "Outpost", pad: "S" }),
        ]),
      ],
    });

    const reported = [...p.missingBuyIndexed, ...p.missingTripEligible].map((m) => m.id);
    expect(reported).toContain("steel");
    expect(p.totalRemainingTons).toBeGreaterThan(0);
  });

  it("keeps a banned station out of the trips", () => {
    const p = plan({
      bannedStations: [
        { systemName: SELLER_SYSTEM, stationName: "Seller Coriolis", bannedAt: "2026-09-01T10:00:00Z" },
      ],
    });

    const visited = p.trips
      .flatMap((t) => t.stops)
      .filter((s) => s.kind === "buy")
      .map((s) => s.stationName);
    expect(visited).not.toContain("Seller Coriolis");
  });

  it("prefers the nearer of two sellers", () => {
    const p = plan({
      systemDistanceLy: distances([
        [SITE_SYSTEM, SELLER_SYSTEM, 60],
        [SITE_SYSTEM, SELLER_TWO, 8],
      ]),
      buyListings: [
        listing("steel", "Steel", 100, [
          hit({ distanceLy: 60 }),
          hit({ systemName: SELLER_TWO, stationName: "Near Orbis", marketId: "200", distanceLy: 8 }),
        ]),
      ],
    });

    const firstBuy = p.trips.flatMap((t) => t.stops).find((s) => s.kind === "buy");
    expect(firstBuy?.stationName).toBe("Near Orbis");
  });

  it("returns an empty plan rather than throwing when there is nothing to do", () => {
    const p = plan({ activeDepots: [depot("a", "Site A", [row("Steel", 100, 100)])] });
    expect(p.trips).toEqual([]);
    expect(p.totalRemainingTons).toBe(0);
  });
});
