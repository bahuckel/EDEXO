import { describe, expect, it } from "vitest";
import {
  isAllowedExternalUrl,
  parseCheckoutItems,
  parseCheckoutRequest,
  parseConstructionDepots,
  parseDistanceBySystem,
  parseSystemNames,
} from "../../../../src/server/colonize/ipc/payload";

describe("isAllowedExternalUrl", () => {
  it("opens the sites the app links to", () => {
    expect(isAllowedExternalUrl("https://inara.cz/elite/commodities/?x=1")).toBe(true);
    expect(isAllowedExternalUrl("https://www.spansh.co.uk/system?n=Sol")).toBe(true);
    expect(isAllowedExternalUrl("http://edsm.net/")).toBe(true);
  });
  it("refuses anything else", () => {
    expect(isAllowedExternalUrl("https://inara.cz.evil.example/")).toBe(false);
    expect(isAllowedExternalUrl("https://user:pw@inara.cz/")).toBe(false);
    expect(isAllowedExternalUrl("file:///C:/Windows/system32/calc.exe")).toBe(false);
    expect(isAllowedExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedExternalUrl("not a url")).toBe(false);
    expect(isAllowedExternalUrl(42)).toBe(false);
  });
});

describe("parseCheckoutRequest", () => {
  it("serves from the saved index unless live data is asked for", () => {
    expect(parseCheckoutRequest({}).cacheOnly).toBe(true);
    expect(parseCheckoutRequest({ cacheOnly: false }).cacheOnly).toBe(false);
    const live = parseCheckoutRequest({ forceLiveScan: true, cacheOnly: true });
    expect(live.forceLiveScan).toBe(true);
    expect(live.cacheOnly).toBe(false);
  });

  it("falls back on anything it does not recognise", () => {
    const r = parseCheckoutRequest({
      routingMode: "teleport",
      journalDir: "   ",
      filters: { maxDistanceLy: -5, minSupply: "lots", maxSystemsPerMaterial: 3.7 },
    });
    expect(r.routingMode).toBe("fewest_stops");
    expect(r.journalDir).toBeNull();
    expect(r.filters.maxDistanceLy).toBeNull();
    expect(r.filters.minSupply).toBeNull();
    expect(r.filters.maxSystemsPerMaterial).toBe(3);
  });

  it("ignores known shops and market snapshots on a cache-only request", () => {
    const filters = {
      knownShopStations: [{ systemName: "Sol", stationName: "Abraham Lincoln" }],
      shopMarketSnapshots: [
        {
          systemName: "Sol",
          stationName: "Abraham Lincoln",
          offers: [{ commodityId: "steel", label: "Steel", supply: 10, buyPrice: 100 }],
        },
      ],
    };
    expect(parseCheckoutRequest({ filters }).filters.knownShopStations).toEqual([]);
    const live = parseCheckoutRequest({ filters, cacheOnly: false }).filters;
    expect(live.knownShopStations).toHaveLength(1);
    expect(live.shopMarketSnapshots).toHaveLength(1);
  });
});

describe("small parsers", () => {
  it("parseCheckoutItems keeps rows with any name and defaults the tonnage", () => {
    expect(
      parseCheckoutItems([{ id: "steel", quantityTons: 0 }, { name: "" }, null, "x", { nameLocalised: "CMM" }]),
    ).toEqual([
      { id: "steel", name: "", nameLocalised: "", quantityTons: 1 },
      { id: "", name: "", nameLocalised: "CMM", quantityTons: 1 },
    ]);
  });

  it("parseSystemNames trims and drops blanks", () => {
    expect(parseSystemNames([" Sol ", "", 3, "Achenar"])).toEqual(["Sol", "Achenar"]);
    expect(parseSystemNames("Sol")).toEqual([]);
  });

  it("parseDistanceBySystem keeps usable numbers only", () => {
    expect(parseDistanceBySystem({ a: 1.5, b: -1, c: Number.NaN, d: "2", e: 0 })).toEqual({ a: 1.5, e: 0 });
  });

  it("parseConstructionDepots needs a market id or a system and station", () => {
    const out = parseConstructionDepots([
      { marketId: "1" },
      { systemName: "Sol", stationName: "Site" },
      { systemName: "Sol" },
    ]);
    expect(out.map((d) => d.marketId || d.stationName)).toEqual(["1", "Site"]);
    expect(out[1]!.starSystem).toBe("Sol");
  });
});
