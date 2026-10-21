import { describe, expect, it } from "vitest";
import type { CheckoutFilters } from "../../../src/shared/colonize/types";
import type { Ly } from "../../../src/shared/colonize/systemDistanceLy";
import {
  appendNearestStopsForMissing,
  buildNearestStopPerItem,
  routeStations,
  type NeedRow,
} from "../../../src/server/colonize/checkoutRouting";
import type { Unified } from "../../../src/server/colonize/checkoutStationMap";

/**
 * A station selling one commodity at a price. `distanceLy: null` is a seller nobody has measured
 * yet — the buy index held 413 of them when S-7 made unknown mean `null`.
 */
function station(key: string, distanceLy: Ly, sells: Record<string, number>): Unified {
  const market = Object.entries(sells).map(([commodity, price]) => ({
    commodity,
    supply: 50_000,
    buy_price: price,
  }));
  return {
    key,
    systemName: `${key} System`,
    stationName: `${key} Port`,
    distanceLy,
    marketId: key,
    market,
    provenSpansh: new Set(Object.keys(sells)),
    needBuckets: new Set(Object.keys(sells).map((c) => c.toLowerCase())),
    commoditySources: new Map(),
    isPlanetaryOrGround: false,
    stationType: "Coriolis Starport",
    bodyName: null,
    marketUpdatedAt: null,
  };
}

const filters = { minSupply: null } as unknown as CheckoutFilters;
const steel: NeedRow = { id: "steel", label: "Steel", spansh: "Steel", quantityTons: 100 };
const titanium: NeedRow = { id: "titanium", label: "Titanium", spansh: "Titanium", quantityTons: 100 };

function byKey(...stations: Unified[]): Map<string, Unified> {
  return new Map(stations.map((s) => [s.key, s]));
}

const visited = (groups: { stationName: string }[]) => groups.map((g) => g.stationName);

describe("a seller whose distance is unknown", () => {
  it("is still used when it is the only one that sells the material", () => {
    const map = byKey(station("Known", 10, { Steel: 300 }), station("Unknown", null, { Titanium: 900 }));
    for (const mode of ["cheapest", "fewest_stops", "nearest"] as const) {
      const groups = routeStations(mode, map, [steel, titanium], filters);
      expect(visited(groups).sort(), mode).toEqual(["Known Port", "Unknown Port"]);
    }
    const nearest = buildNearestStopPerItem(map, [steel, titanium], filters, new Map(), new Map());
    expect(nearest.unresolved).toEqual([]);
    expect(visited(nearest.groups)).toEqual(["Known Port", "Unknown Port"]);
    expect(visited(appendNearestStopsForMissing([], map, [titanium], filters, ["titanium"]))).toEqual([
      "Unknown Port",
    ]);
  });

  it("comes after any seller whose distance is known, even a dearer one", () => {
    const map = byKey(station("Unknown", null, { Steel: 100 }), station("Known", 40, { Steel: 300 }));
    expect(visited(routeStations("cheapest", map, [steel], filters))).toEqual(["Known Port"]);
    expect(visited(routeStations("nearest", map, [steel], filters))).toEqual(["Known Port"]);
  });

  it("is chosen by price among other unknown ones, not by list order", () => {
    const map = byKey(
      station("Dear", null, { Steel: 900 }),
      station("Cheap", null, { Steel: 200 }),
      station("Middling", null, { Steel: 500 }),
    );
    expect(visited(routeStations("cheapest", map, [steel], filters))).toEqual(["Cheap Port"]);
  });
});

describe("cheapest", () => {
  it("still trades price against distance among measured sellers", () => {
    // 100 t: 20 000 cr cheaper, 30 Ly further (×500 = 15 000) — the cheaper one wins.
    const map = byKey(station("Near", 10, { Steel: 400 }), station("Far", 40, { Steel: 200 }));
    expect(visited(routeStations("cheapest", map, [steel], filters))).toEqual(["Far Port"]);
  });
});
