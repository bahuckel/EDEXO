import { describe, expect, it } from "vitest";
import { migrateJournalShopRecord } from "../../src/shared/colonize/journalShopHistory";
import { stationLy } from "../../src/shared/colonize/planner/stationFacts";
import type { PlannerStation } from "../../src/shared/colonize/planner/types";
import { allowSurfaceStation } from "../../src/shared/colonize/stationFilter";
import {
  compareLy,
  constructionHopLy,
  formatHopLy,
  galaxyDistancePairKey,
  isKnownLy,
  lyOrLast,
  nearerLy,
  toLy,
} from "../../src/shared/colonize/systemDistanceLy";

/**
 * S-7: `null` is unknown, `0` is the same system. These pin the places that disagreed: every one of
 * them used to read a seller in the construction system as "unknown", or unknown as "right here".
 */
describe("the distance rule", () => {
  it("knows 0, and nothing that is not a real distance", () => {
    expect(isKnownLy(0)).toBe(true);
    expect(isKnownLy(12.5)).toBe(true);
    for (const v of [null, undefined, Number.NaN, Infinity, -1, 50_000, "12"]) expect(isKnownLy(v)).toBe(false);
  });

  it("normalises what JSON and old saves hold, and sorts unknown last", () => {
    expect(toLy(Infinity)).toBeNull();
    expect(toLy(null)).toBeNull();
    expect(toLy(0)).toBe(0);
    expect([30, null, 0, 5].sort((a, b) => lyOrLast(a) - lyOrLast(b))).toEqual([0, 5, 30, null]);
  });

  it("compareLy puts unknown after every known distance and treats two unknowns as equal", () => {
    expect([30, null, 0, undefined, 5].sort(compareLy)).toEqual([0, 5, 30, null, undefined]);
    expect(compareLy(null, undefined)).toBe(0);
    expect(compareLy(Infinity, 999)).toBeGreaterThan(0);
  });

  it("nearerLy keeps the nearer known distance and is unknown only when both are", () => {
    expect(nearerLy(30, 0)).toBe(0);
    expect(nearerLy(null, 30)).toBe(30);
    expect(nearerLy(undefined, null)).toBeNull();
  });

  it("a hop is 0 in the same system, the mapped distance, or null — never Infinity", () => {
    const map = { [galaxyDistancePairKey("Site", "Seller")]: 14.2 };
    expect(constructionHopLy("Site", "site")).toBe(0);
    expect(constructionHopLy("Site", "Seller", map)).toBe(14.2);
    expect(constructionHopLy("Site", "Elsewhere", map)).toBeNull();
    expect(formatHopLy(null)).toBe("—");
    expect(formatHopLy(0)).toBe("0.0 Ly");
  });
});

describe("the places that got it wrong", () => {
  it("a surface station of unknown distance is not 'near' (null < 15 is true in JavaScript)", () => {
    const base = { isPlanetaryOrGround: true, systemName: "Far Away", constructionSystems: ["Site"] };
    expect(allowSurfaceStation({ ...base, distanceLy: null })).toBe(false);
    expect(allowSurfaceStation({ ...base, distanceLy: 9 })).toBe(true);
    expect(allowSurfaceStation({ ...base, distanceLy: 0, systemName: "Site" })).toBe(true);
  });

  it("a shop in the construction system keeps its 0 Ly through a save and reload", () => {
    const rec = migrateJournalShopRecord({
      marketId: "128000000",
      stationName: "Local Port",
      starSystem: "Site",
      visitedAt: "2026-09-20T10:00:00Z",
      purchases: [],
      constructionDistanceLy: 0,
    });
    expect(rec?.constructionDistanceLy).toBe(0);
  });

  it("the planner scores a same-system seller as the nearest, not the farthest", () => {
    const station = (distanceLy: number | null) => ({ key: "k", distanceLy }) as PlannerStation;
    expect(stationLy(station(0))).toBe(0);
    expect(stationLy(station(40))).toBe(40);
    /** Finite on purpose: the routing scores subtract these, and Infinity - Infinity is NaN. */
    expect(stationLy(station(null))).toBe(999_999);
  });
});
