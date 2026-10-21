import { describe, expect, it } from "vitest";
import {
  isFdevSymbolSlug,
  spanshPrimaryStationSearchFilters,
  spanshStationSearchCommodityFilters,
} from "../../src/shared/colonize/spanshCommodity";

/**
 * Spansh answers a `name` filter reliably and a `symbol` filter only sometimes: measured over
 * fourteen runs each against the live API, "Bioreducing Lichen" succeeded 14/14 by name and
 * 4/14 by symbol, "Grain" 14/14 by name and 7/14 by symbol, the failures all HTTP 500.
 *
 * Combined with a cache that used to record any failure as "this commodity has no sellers",
 * that is what made most of a construction list look unavailable. Symbols are still worth
 * keeping as a fallback, but trying one first is the bug.
 */
describe("Spansh commodity filter order", () => {
  const cases: [string, string][] = [
    ["BioReducingLichen", "Bioreducing Lichen"],
    ["Grain", "Grain"],
    ["$CMMComposite_name;", "CMM Composite"],
    ["LiquidOxygen", "Liquid oxygen"],
    ["HazardousEnvironmentSuits", "H.E. Suits"],
  ];

  it("offers a display name before any symbol", () => {
    for (const [symbol, label] of cases) {
      const filters = spanshStationSearchCommodityFilters(symbol, label);
      expect(filters.length, `${label} produced no filters`).toBeGreaterThan(0);
      expect(filters[0]!.field, `${label} leads with a symbol`).toBe("name");

      const firstSymbol = filters.findIndex((f) => f.field === "symbol");
      const lastName = filters.map((f) => f.field).lastIndexOf("name");
      if (firstSymbol !== -1) expect(firstSymbol).toBeGreaterThan(lastName - filters.length);
    }
  });

  it("puts the name first in the primary pair the resolver walks", () => {
    for (const [symbol, label] of cases) {
      const primary = spanshPrimaryStationSearchFilters(symbol, label);
      expect(primary.length).toBeGreaterThan(0);
      expect(primary[0]!.field).toBe("name");
    }
  });

  it("still keeps a symbol available as a fallback", () => {
    const filters = spanshStationSearchCommodityFilters("BioReducingLichen", "Bioreducing Lichen");
    expect(filters.some((f) => f.field === "symbol")).toBe(true);
  });

  it("recognises an FDev symbol slug but not a display name", () => {
    expect(isFdevSymbolSlug("BioReducingLichen")).toBe(true);
    expect(isFdevSymbolSlug("Bioreducing Lichen")).toBe(false);
    expect(isFdevSymbolSlug("H.E. Suits")).toBe(false);
  });
});
