/**
 * Sellers found round a site that finished more than 30 days ago stop feeding plans (discuss item 6); the journal's
 * and bought-here sellers stay, and a bucket an unfinished site still uses is never touched.
 */
import { describe, expect, it } from "vitest";
import { finishedSellerRefs, pruneBuyIndexRefs } from "../../src/shared/colonize/buyIndexClear";
import type { MaterialBuyIndexFile, MaterialBuyStationHit } from "../../src/shared/colonize/materialBuyIndexTypes";

const now = Date.parse("2026-10-23T12:00:00Z");
const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();
const norm = (s: string) => s.trim().toLowerCase();
const site = (marketId: string, starSystem: string, done: boolean, lastDays: number) => ({
  marketId,
  starSystem,
  complete: done,
  failed: false,
  progress: done ? 1 : 0.4,
  lastTimestamp: daysAgo(lastDays),
});

describe("finishedSellerRefs", () => {
  it("names buckets of sites finished over 30 days ago, by hub pin else system", () => {
    const refs = finishedSellerRefs(
      [site("1", "Old A", true, 45), site("2", "Recent", true, 10), site("3", "Pinned Site", true, 60), site("4", "Busy", false, 90)],
      { "3": "Hub X" },
      norm,
      now,
    );
    expect([...refs].sort()).toEqual(["hub x", "old a"]);
  });
  it("keeps a bucket an unfinished site shares", () => {
    const refs = finishedSellerRefs([site("1", "Shared", true, 45), site("2", "Shared", false, 1)], {}, norm, now);
    expect(refs.size).toBe(0);
  });
});

describe("pruneBuyIndexRefs", () => {
  const hit = (dataSource: MaterialBuyStationHit["dataSource"], purchaseProven = false): MaterialBuyStationHit => ({
    systemName: "S",
    stationName: `${dataSource}${purchaseProven ? "-bought" : ""}`,
    marketId: "",
    distanceLy: 1 as MaterialBuyStationHit["distanceLy"],
    buyPrice: 100,
    supply: 10,
    spanshCommodity: "Steel",
    dataSource,
    foundAtIso: daysAgo(1),
    purchaseProven,
  });
  const systems = {
    "old a": { steel: { commodityId: "steel", updatedAtIso: daysAgo(40), stations: [hit("spansh"), hit("journal"), hit("inara", true)] } },
    "old b": { steel: { commodityId: "steel", updatedAtIso: daysAgo(40), stations: [hit("spansh")] } },
    busy: { steel: { commodityId: "steel", updatedAtIso: daysAgo(1), stations: [hit("spansh")] } },
  } as unknown as MaterialBuyIndexFile["systems"];

  it("drops found sellers of those buckets only, keeping journal and bought-here", () => {
    const { systems: next, removedHits } = pruneBuyIndexRefs(systems, new Set(["old a", "old b"]));
    expect(removedHits).toBe(2);
    expect(next["old a"]!.steel!.stations.map((h) => h.stationName)).toEqual(["journal", "inara-bought"]);
    expect(next["old b"]).toBeUndefined();
    expect(next.busy).toBe(systems.busy);
  });
});
