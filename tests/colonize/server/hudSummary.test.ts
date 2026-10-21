/**
 * The HUD's Colonize section data (colonize/hudSummary.ts): the sites being built (docked one first), what to unload
 * at the docked site, the saved plan's next stop decided as the window decides it (ticks, cargo aboard), the hold.
 */
import { describe, expect, it } from "vitest";
import { buildColonizeHud } from "../../../src/server/colonize/hudSummary";
import { tripBuyLineId, type TripPlanSnapshot } from "../../../src/shared/colonize/tripPlanProgress";
import type { ColonizeSnapshot, DepotSnapshot } from "../../../src/shared/colonize/types";

const TRIPS = "edexo-colonize-trip-plan-snapshot-v3";
const CAPACITY = "edexo-colonize-cargo-capacity-v1";
const CARRIERS = "edexo-colonize-carrier-haul-v1";

const depot = (marketId: string, label: string, last: string, res: [string, number, number][], progress: number | null = null): DepotSnapshot =>
  ({
    marketId,
    starSystem: "Smoke Colony",
    systemAddress: 1,
    stationName: `Orbital Construction Site: ${label}`,
    constructionSiteLabel: label,
    progress,
    complete: false,
    failed: false,
    lastTimestamp: last,
    resources: res.map(([n, required, provided]) => ({ name: n.toLowerCase(), nameLocalised: n, required, provided, payment: 1 })),
    contributions: [],
    progressHistory: [],
    contributionProgressHistory: [],
  }) as DepotSnapshot;

const A = depot("1", "Alpha Port", "2026-10-01T00:00:00Z", [["Steel", 1000, 400], ["Titanium", 200, 0]], 0.5);
const B = depot("2", "Bravo Dock", "2026-10-05T00:00:00Z", [["Steel", 500, 0]]);

function snap(over: Partial<ColonizeSnapshot> = {}): ColonizeSnapshot {
  return {
    activeDepots: [A, B],
    completedDepots: [],
    archivedDepots: [],
    liveDocked: null,
    shipCargo: [],
    shipCargoCapacity: 400,
    carriers: [],
    ...over,
  } as unknown as ColonizeSnapshot;
}

/** Trip 1 buys steel at Seller One for Alpha; trip 2 buys titanium at Seller Two. */
const plan: TripPlanSnapshot = {
  planRefreshKey: "k",
  createdAt: "2026-10-05T00:00:00Z",
  baselineContributions: {},
  manualCompletedLineIds: [],
  plan: {
    trips: [1, 2].map((n) => ({
      tripNumber: n,
      loadTons: 200,
      capacity: 400,
      buyRouteLy: 10,
      stops: [
        {
          stopIndex: 0,
          kind: "buy",
          systemName: `Seller System ${n}`,
          stationName: `Seller ${n === 1 ? "One" : "Two"}`,
          distanceLy: 12.4,
          buys: [{ commodityId: n === 1 ? "steel" : "titanium", label: n === 1 ? "Steel" : "Titanium", buyTons: 200, buyPrice: 100, forDepots: ["Alpha Port"], stillNeedTotal: 0 }],
          deliverTo: ["Alpha Port"],
          cargoLoaded: 200,
        },
        {
          stopIndex: 1,
          kind: "deliver",
          systemName: "Smoke Colony",
          stationName: "Orbital Construction Site: Alpha Port",
          distanceLy: 0,
          buys: [],
          deliverTo: ["Alpha Port"],
          deliveries: [{ depotMarketId: "1", depotLabel: "Alpha Port", systemName: "Smoke Colony", materials: [{ commodityId: n === 1 ? "steel" : "titanium", label: "x", tons: 200 }] }],
          cargoLoaded: 0,
        },
      ],
    })),
  } as unknown as TripPlanSnapshot["plan"],
};

describe("the HUD's Colonize data", () => {
  it("is null with nothing being built", () => {
    expect(buildColonizeHud(snap({ activeDepots: [] }), {})).toBeNull();
  });

  it("lists the docked site first, then the most recent, with progress and tons left", () => {
    const h = buildColonizeHud(snap({ liveDocked: { marketId: "1", stationName: A.stationName!, starSystem: "Smoke Colony", timestamp: null } }), {})!;
    expect(h.sites.map((s) => [s.label, s.pct, s.leftTons, s.docked])).toEqual([
      ["Alpha Port", 50, 800, true],
      ["Bravo Dock", 0, 500, false],
    ]);
    expect(h.moreSites).toBe(0);
    expect(buildColonizeHud(snap(), {})!.sites[0]!.label).toBe("Bravo Dock");
  });

  it("says what aboard the docked site still needs, and the hold", () => {
    const h = buildColonizeHud(
      snap({
        liveDocked: { marketId: "1", stationName: A.stationName!, starSystem: "Smoke Colony", timestamp: null },
        shipCargo: [
          { name: "steel", nameLocalised: "Steel", count: 700 },
          { name: "gold", nameLocalised: "Gold", count: 10 },
        ],
      }),
      { [CAPACITY]: "784" },
    )!;
    expect(h.deliver).toEqual({ site: "Alpha Port", lines: [{ label: "Steel", tons: 600 }] });
    expect(h.hold).toEqual({ used: 710, capacity: 784 });
    expect(buildColonizeHud(snap(), {})!.hold.capacity).toBe(400);
  });

  it("gives the saved plan's next stop, moving on as lines are ticked or the cargo is aboard", () => {
    const ui = { [TRIPS]: JSON.stringify(plan) };
    const first = buildColonizeHud(snap(), ui)!;
    expect(first.next).toMatchObject({ trip: 1, trips: 2, station: "Seller One", system: "Seller System 1", distanceLy: 12.4, here: false });
    expect(first.next!.buys).toEqual([{ label: "Steel", tons: 200, done: false }]);
    expect(first.next!.deliverTo).toEqual(["Alpha Port"]);

    // Bought (the steel is aboard): the trip's next stop is the delivery.
    const loaded = buildColonizeHud(snap({ shipCargo: [{ name: "steel", nameLocalised: "Steel", count: 200 }] }), ui)!;
    expect(loaded.next).toMatchObject({ trip: 1, station: "Orbital Construction Site: Alpha Port", buys: [] });

    // Trip 1 ticked done by hand: trip 2, and docked at its seller.
    const ticked = {
      [TRIPS]: JSON.stringify({
        ...plan,
        manualCompletedLineIds: [tripBuyLineId(1, 0, "steel"), "t1-s1-d-1-steel"],
      }),
    };
    const atSeller = buildColonizeHud(snap({ liveDocked: { marketId: "9", stationName: "seller two", starSystem: "Seller System 2", timestamp: null } }), ticked)!;
    expect(atSeller.next).toMatchObject({ trip: 2, station: "Seller Two", here: true });
  });

  it("counts a carrier's cargo only when the window switched it on", () => {
    const carrier = { carrierId: "37", kind: "fleet", name: "C", callsign: "ABC-123", tonsByCommodity: { steel: 200 }, labels: {}, reportedTons: 200, capacityTons: 25000, lastEventIso: null };
    const ui = { [TRIPS]: JSON.stringify(plan) };
    expect(buildColonizeHud(snap({ carriers: [carrier] as never }), ui)!.next!.station).toBe("Seller One");
    expect(buildColonizeHud(snap({ carriers: [carrier] as never }), { ...ui, [CARRIERS]: '{"37":true}' })!.next!.buys).toEqual([]);
  });

  it("ignores a torn plan", () => {
    expect(buildColonizeHud(snap(), { [TRIPS]: "{ torn" })!.next).toBeNull();
  });
});
