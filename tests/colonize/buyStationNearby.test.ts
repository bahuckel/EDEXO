import { describe, expect, it } from "vitest";
import { hasBuyStationWithinLy } from "../../src/shared/colonize/buyStationNearby";
import { LIVE_SCAN_NEARBY_LY } from "../../src/shared/colonize/stationFilter";
import type { MaterialBuyStationHit } from "../../src/shared/colonize/materialBuyIndexTypes";

function hit(distanceLy: number): MaterialBuyStationHit {
  return {
    systemName: "Test System",
    stationName: "Test Station",
    marketId: "123",
    distanceLy,
    buyPrice: 100,
    supply: 1000,
    spanshCommodity: "Aluminium",
    dataSource: "spansh",
    foundAtIso: new Date().toISOString(),
  };
}

describe("hasBuyStationWithinLy", () => {
  it("returns true when a seller is within 59 Ly", () => {
    expect(hasBuyStationWithinLy([hit(12)], LIVE_SCAN_NEARBY_LY)).toBe(true);
  });

  it("returns false when all sellers are beyond 59 Ly", () => {
    expect(hasBuyStationWithinLy([hit(120)], LIVE_SCAN_NEARBY_LY)).toBe(false);
  });

  it("returns false for empty hits", () => {
    expect(hasBuyStationWithinLy([], LIVE_SCAN_NEARBY_LY)).toBe(false);
  });
});
