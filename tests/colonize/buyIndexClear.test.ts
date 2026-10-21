import { describe, expect, it } from "vitest";
import { pruneBuyIndexBySources } from "../../src/shared/colonize/buyIndexClear";
import type { MaterialBuyIndexRow, MaterialBuyStationHit } from "../../src/shared/colonize/materialBuyIndexTypes";

function hit(source: MaterialBuyStationHit["dataSource"], stationName: string): MaterialBuyStationHit {
  return {
    systemName: "Sol",
    stationName,
    marketId: "",
    distanceLy: 10,
    buyPrice: 100,
    supply: 50,
    spanshCommodity: "Steel",
    dataSource: source,
    foundAtIso: "2026-08-26T00:00:00.000Z",
  };
}

function row(stations: MaterialBuyStationHit[]): MaterialBuyIndexRow {
  return { commodityId: "steel", label: "Steel", updatedAtIso: "2026-08-26T00:00:00.000Z", stations };
}

describe("pruneBuyIndexBySources", () => {
  it("removes only Spansh hits and keeps Inara", () => {
    const { systems, removedHits } = pruneBuyIndexBySources(
      {
        sol: { steel: row([hit("spansh", "Abraham Lincoln"), hit("inara", "Broot's Prospect")]) },
      },
      new Set(["spansh"]),
    );
    expect(removedHits).toBe(1);
    expect(systems.sol?.steel?.stations.map((s) => s.stationName)).toEqual(["Broot's Prospect"]);
  });

  it("drops the inara ref bucket entirely", () => {
    const { systems, removedHits } = pruneBuyIndexBySources(
      {
        inara: { steel: row([hit("inara", "A")]) },
        sol: { steel: row([hit("inara", "B"), hit("spansh", "C")]) },
      },
      new Set(["inara"]),
      ["inara"],
    );
    expect(removedHits).toBe(2);
    expect(systems.inara).toBeUndefined();
    expect(systems.sol?.steel?.stations.map((s) => s.dataSource)).toEqual(["spansh"]);
  });
});
