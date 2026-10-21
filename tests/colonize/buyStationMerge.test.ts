import { describe, expect, it } from "vitest";
import { dedupeBuyStationHits, mergeBuyStationHits } from "../../src/shared/colonize/buyStationMerge";
import type { MaterialBuyStationHit } from "../../src/shared/colonize/materialBuyIndexTypes";

function hit(partial: Partial<MaterialBuyStationHit> & Pick<MaterialBuyStationHit, "stationName" | "dataSource">): MaterialBuyStationHit {
  return {
    systemName: "Swoilz FE-C c2-33",
    marketId: "",
    distanceLy: 36.1,
    buyPrice: 867,
    supply: 9_044_741,
    spanshCommodity: "Ceramic Composites",
    foundAtIso: "2026-08-26T05:00:00.000Z",
    ...partial,
  };
}

describe("dedupeBuyStationHits", () => {
  it("merges Inara + Spansh copies of the same station and keeps the closer unique stops", () => {
    const inaraFar = hit({
      stationName: "Coulstock-Cockeram Productions",
      dataSource: "inara",
      stationType: "unknown",
      isPlanetaryOrGround: false,
    });
    const spanshFar = hit({
      stationName: "Coulstock-Cockeram Productions",
      marketId: "322123456789",
      dataSource: "spansh",
      stationType: "Planetary Port",
      isPlanetaryOrGround: true,
      buyPrice: 730,
      supply: 9_043_557,
    });
    const broot = hit({
      systemName: "Swoilz BY-D c1-13",
      stationName: "Broot's Prospect",
      dataSource: "inara",
      distanceLy: 14.7,
      buyPrice: 867,
      supply: 462_972,
    });
    const flores = hit({
      systemName: "Swoilz PO-C b5-4",
      stationName: "Flores Foundry",
      dataSource: "inara",
      distanceLy: 28.5,
      buyPrice: 218,
      supply: 5_011_333,
    });

    const merged = dedupeBuyStationHits([inaraFar, spanshFar, broot, flores]);
    expect(merged).toHaveLength(3);
    const coulstock = merged.find((s) => s.stationName === "Coulstock-Cockeram Productions");
    expect(coulstock?.stationType).toBe("Planetary Port");
    expect(coulstock?.isPlanetaryOrGround).toBe(true);
    expect(coulstock?.marketId).toBe("322123456789");
    expect(coulstock?.supply).toBe(9_044_741);
  });
});

describe("mergeBuyStationHits", () => {
  it("fills unknown Inara type from Spansh without dropping Inara stock", () => {
    const a = hit({ stationName: "Desheret", dataSource: "inara", stationType: "unknown" });
    const b = hit({
      stationName: "Desheret",
      dataSource: "spansh",
      stationType: "Coriolis Starport",
      marketId: "1",
      supply: 100,
    });
    const m = mergeBuyStationHits(a, b);
    expect(m.stationType).toBe("Coriolis Starport");
    expect(m.supply).toBe(9_044_741);
    expect(m.marketId).toBe("1");
  });
});
