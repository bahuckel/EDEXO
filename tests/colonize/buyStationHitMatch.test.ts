import { describe, expect, it } from "vitest";
import { buyStationHitMatchesNeed } from "../../src/shared/colonize/buyStationHitMatch";
import type { MaterialBuyStationHit } from "../../src/shared/colonize/materialBuyIndexTypes";

function hit(spanshCommodity: string): MaterialBuyStationHit {
  return {
    systemName: "A",
    stationName: "B",
    marketId: "1",
    distanceLy: 10,
    buyPrice: 100,
    supply: 50,
    spanshCommodity,
    dataSource: "spansh",
    foundAtIso: new Date().toISOString(),
  };
}

describe("buyStationHitMatchesNeed", () => {
  it("rejects empty spanshCommodity", () => {
    expect(buyStationHitMatchesNeed("steel", "Steel", hit(""))).toBe(false);
  });

  it("matches exact id", () => {
    expect(buyStationHitMatchesNeed("steel", "Steel", hit("steel"))).toBe(true);
  });

  it("matches Spansh symbol BattleWeapons to Battle Weapons depot row", () => {
    expect(buyStationHitMatchesNeed("battleweapons", "Battle Weapons", hit("BattleWeapons"))).toBe(true);
  });

  it("does not match a different material at the same station row shape", () => {
    expect(buyStationHitMatchesNeed("steel", "Steel", hit("aluminium"))).toBe(false);
    expect(buyStationHitMatchesNeed("aluminium", "Aluminium", hit("steel"))).toBe(false);
  });
});
