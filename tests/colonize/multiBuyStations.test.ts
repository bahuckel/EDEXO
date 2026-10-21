import { describe, expect, it } from "vitest";
import type { MaterialBuyListing } from "../../src/shared/colonize/materialBuyIndexTypes";
import { groupStationsSellingMultipleRemaining } from "../../src/shared/colonize/multiBuyStations";

function hit(systemName: string, stationName: string, distanceLy: number, supply = 4000) {
  return {
    systemName,
    stationName,
    marketId: "",
    distanceLy,
    buyPrice: 1000,
    supply,
    spanshCommodity: "",
    dataSource: "inara" as const,
    foundAtIso: "2026-08-26T00:00:00.000Z",
  };
}

function listing(id: string, label: string, quantityNeeded: number, stations: ReturnType<typeof hit>[]): MaterialBuyListing {
  return { id, label, quantityNeeded, servedFromCache: true, stations };
}

describe("groupStationsSellingMultipleRemaining", () => {
  it("lists stations that sell two or more remaining materials", () => {
    const groups = groupStationsSellingMultipleRemaining([
      listing("titanium", "Titanium", 800, [hit("LHS 20", "Miller Terminal", 12.4), hit("Sol", "Abraham Lincoln", 0.1)]),
      listing("steel", "Steel", 400, [hit("LHS 20", "Miller Terminal", 12.4)]),
      listing("water", "Water", 0, [hit("LHS 20", "Miller Terminal", 12.4)]),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.stationName).toBe("Miller Terminal");
    expect(groups[0]?.materials.map((m) => m.label)).toEqual(["Steel", "Titanium"]);
    expect(groups[0]?.distanceLy).toBe(12.4);
  });

  it("omits stations that only sell one remaining SKU", () => {
    const groups = groupStationsSellingMultipleRemaining([
      listing("titanium", "Titanium", 100, [hit("Sol", "Abraham Lincoln", 0.2)]),
      listing("steel", "Steel", 100, [hit("LHS 20", "Miller Terminal", 12)]),
    ]);
    expect(groups).toHaveLength(0);
  });
});
