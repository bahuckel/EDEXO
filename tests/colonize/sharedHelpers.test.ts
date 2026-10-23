/**
 * Helpers the Colonize window, the phone view, the HUD and the server each had their own copies of (audit
 * 2026-10-22): one definition each now, so they cannot drift.
 */
import { describe, expect, it } from "vitest";
import { carrierHaulIds, parseCarrierHaul, shipCargoByKey } from "../../src/shared/colonize/carrierStock";
import { basketItemId, itemLabel, resourceNeedId } from "../../src/shared/colonize/commodityKey";
import { errText, formatTons } from "../../src/shared/colonize/formatPrice";
import { coordsDistanceLy, galaxyDistanceLy3d } from "../../src/shared/colonize/galaxyDistanceCompute";
import { measuredLegLy } from "../../src/shared/colonize/planner/legLy";
import { galaxyDistancePairKey, galaxyLyFromSite } from "../../src/shared/colonize/systemDistanceLy";

describe("formatTons", () => {
  it("is whole tons, grouped the English way", () => {
    expect(formatTons(1234.4)).toBe("1,234 t");
    expect(formatTons(0)).toBe("0 t");
    expect(formatTons(25_000)).toBe("25,000 t");
  });
});

describe("errText", () => {
  it("is the message of an Error, or what was thrown", () => {
    expect(errText(new Error("The server answered 503."))).toBe("The server answered 503.");
    expect(errText("plain")).toBe("plain");
  });
});

describe("shipCargoByKey", () => {
  it("sums the hold by commodity, journal or localised name", () => {
    const m = shipCargoByKey([
      { name: "steel", nameLocalised: "Steel", count: 40 },
      { name: "$steel_name;", nameLocalised: "Steel", count: 20 },
      { name: "", nameLocalised: "", count: 5 },
    ]);
    expect([...m]).toEqual([["steel", 60]]);
  });
});

describe("the carriers switched on", () => {
  it("keeps the ids that are on, from the value or from its stored text", () => {
    expect(parseCarrierHaul({ "3700000001": true, "3700000002": false, " ": true })).toEqual({ "3700000001": true });
    expect(parseCarrierHaul("not an object")).toBeNull();
    expect([...carrierHaulIds('{"3700000001":true}')]).toEqual(["3700000001"]);
    expect(carrierHaulIds("{ torn").size).toBe(0);
    expect(carrierHaulIds(null).size).toBe(0);
  });
});

describe("basket lines", () => {
  it("keep their own id, else the need id; labels prefer the localised name", () => {
    expect(basketItemId({ id: "x", name: "steel", nameLocalised: "Steel" })).toBe("x");
    expect(basketItemId({ id: "", name: "$steel_name;", nameLocalised: "Steel" })).toBe(resourceNeedId({ name: "$steel_name;", nameLocalised: "Steel" }));
    expect(itemLabel({ name: "$steel_name;", nameLocalised: " Steel " })).toBe("Steel");
    expect(itemLabel({ name: "steel", nameLocalised: "" })).toBe("steel");
  });
});

describe("distances", () => {
  const coords: Record<string, [number, number, number]> = { a: [0, 0, 0], b: [3, 4, 0] };

  it("one straight-line rule for the server's map and the planner's record", () => {
    expect(coordsDistanceLy("A", "B", (k) => coords[k])).toBe(5);
    expect(galaxyDistanceLy3d("A", "B", new Map(Object.entries(coords)))).toBe(5);
    expect(measuredLegLy("A", "B", coords)).toBe(5);
    expect(coordsDistanceLy("A", "a", () => undefined)).toBe(0);
    expect(coordsDistanceLy("A", "C", (k) => coords[k])).toBeNull();
  });

  it("a seller's distance from one site: that site's pair only, 0 in its own system, nothing without a site", () => {
    const map = { [galaxyDistancePairKey("Site", "Seller")]: 14.2, [galaxyDistancePairKey("Other", "Seller")]: 3 };
    expect(galaxyLyFromSite("Seller", "Site", map)).toBe(14.2);
    expect(galaxyLyFromSite("site", "Site", map)).toBe(0);
    expect(galaxyLyFromSite("Seller", "Elsewhere", map)).toBeNull();
    expect(galaxyLyFromSite("Seller", " ", map)).toBeNull();
  });
});
