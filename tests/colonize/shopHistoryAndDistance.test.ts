import { describe, expect, it } from "vitest";
import { applyJournalMarketLine, mergeJournalAndLocalShopHistory } from "../../src/shared/colonize/journalShopHistory";
import type { JournalShopRecord } from "../../src/shared/colonize/journalShopHistory";
import type { ShopHistoryEntry } from "../../src/shared/colonize/shopHistory";
import { galaxyDistancePairKey, lookupGalaxyDistanceLy } from "../../src/shared/colonize/systemDistanceLy";
import { mergeMaterialListings } from "../../src/shared/colonize/mergeCheckoutPlans";
import type { MaterialBuyListing, MaterialBuyStationHit } from "../../src/shared/colonize/materialBuyIndexTypes";

function marketEvent(timestamp: string): Record<string, unknown> {
  return {
    event: "Market",
    timestamp,
    MarketID: 3228,
    StationName: "Seller Station",
    StarSystem: "Seller",
    StationType: "Coriolis",
  };
}

describe("applyJournalMarketLine", () => {
  it("keeps the Market.json rows attached to a station when the event is replayed", () => {
    const shops = new Map<string, JournalShopRecord>();
    applyJournalMarketLine(shops, marketEvent("2026-09-01T10:00:00Z"), null);

    // Market.json is read separately and hangs its rows off the same record.
    const rec = shops.get("3228")!;
    rec.marketItems = [{ commodityId: "steel", label: "Steel", supply: 500, buyPrice: 120 }];

    // Replaying the journal must not discard them.
    applyJournalMarketLine(shops, marketEvent("2026-09-02T10:00:00Z"), null);

    expect(shops.get("3228")?.marketItems).toHaveLength(1);
    expect(shops.get("3228")?.visitedAt).toBe("2026-09-02T10:00:00Z");
  });
});

describe("mergeJournalAndLocalShopHistory", () => {
  const base = { systemName: "Seller", stationName: "Seller Station", commodityIds: ["steel"] };

  it("merges a locally recorded visit with the journal record for the same station", () => {
    // Visits recorded in the renderer have no market id; the journal's do.
    const local: ShopHistoryEntry[] = [{ ...base, marketId: "", visitedAt: "2026-09-01T10:00:00Z" }];
    const journal: ShopHistoryEntry[] = [
      { ...base, marketId: "3228", visitedAt: "2026-09-02T10:00:00Z", fromJournal: true },
    ];

    const merged = mergeJournalAndLocalShopHistory(journal, local);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.marketId).toBe("3228");
  });

  it("keeps genuinely different stations apart", () => {
    const merged = mergeJournalAndLocalShopHistory(
      [{ ...base, marketId: "3228", visitedAt: "2026-09-02T10:00:00Z" }],
      [{ ...base, stationName: "Other Station", marketId: "", visitedAt: "2026-09-01T10:00:00Z" }],
    );
    expect(merged).toHaveLength(2);
  });
});

describe("lookupGalaxyDistanceLy", () => {
  const map = { [galaxyDistancePairKey("Site B", "Seller")]: 42 };

  it("returns null when the asked-for site has no measured pair", () => {
    // It used to fall through and hand back Site B's distance, which was then shown
    // and filtered on as though it were Site A's.
    expect(lookupGalaxyDistanceLy("Seller", map, "Site A")).toBeNull();
  });

  it("still answers for the site that does have one", () => {
    expect(lookupGalaxyDistanceLy("Seller", map, "Site B")).toBe(42);
  });
});

describe("mergeMaterialListings", () => {
  function hit(distanceLy: number | null, stationName = "Seller Station"): MaterialBuyStationHit {
    return {
      systemName: "Seller",
      stationName,
      marketId: "",
      distanceLy,
      buyPrice: 100,
      supply: 500,
      spanshCommodity: "Steel",
      dataSource: "spansh",
      foundAtIso: "2026-09-01T10:00:00Z",
    };
  }
  function listing(stations: MaterialBuyStationHit[]): { materialListings: MaterialBuyListing[] } {
    return {
      materialListings: [{ id: "steel", label: "Steel", quantityNeeded: 10, stations, servedFromCache: false }],
    };
  }

  it("prefers a measured distance over an unmeasured one", () => {
    // S-7: unknown is null. It used to be 0 here, which a plain `<` always preferred, so the
    // station showed as sitting on top of the construction site.
    const merged = mergeMaterialListings([listing([hit(30)]), listing([hit(null)])]);
    expect(merged[0]!.stations[0]!.distanceLy).toBe(30);
  });

  it("takes 0 as what it is — a seller in the construction system — not as unknown", () => {
    const merged = mergeMaterialListings([listing([hit(30)]), listing([hit(0)])]);
    expect(merged[0]!.stations[0]!.distanceLy).toBe(0);
  });

  it("still takes a genuinely nearer station", () => {
    const merged = mergeMaterialListings([listing([hit(30)]), listing([hit(12)])]);
    expect(merged[0]!.stations[0]!.distanceLy).toBe(12);
  });
});
