/**
 * Whole markets (owner, 2026-10-23): a station found or known once gives every material it sells, not just the one it
 * was looked up for; journal sellers with unknown stock are not one-ton shelves; "Look now" really looks.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MaterialBuyIndex } from "../../../src/server/colonize/materialBuyIndex";
import { journalMarketIdsForScan } from "../../../src/server/colonize/ipc/scanHandlers";
import { buildLogisticsPlan } from "../../../src/shared/colonize/planner/buildPlan";
import type { JournalShopRecord } from "../../../src/shared/colonize/journalShopHistory";
import type { DepotSnapshot } from "../../../src/shared/colonize/types";
import type { MaterialBuyListing, MaterialBuyStationHit } from "../../../src/shared/colonize/materialBuyIndexTypes";

const market = (rows: [string, number, number][]) =>
  // Spansh's sell_price is what the commander pays (stationSellOffer.ts).
  rows.map(([commodity, supply, price]) => ({ commodity, supply, sell_price: price, buy_price: price + 10, demand: 0 }));

const station = (mid: string, name: string, rows: [string, number, number][]) => ({
  name,
  system_name: "Swoilz BY-D c1-13",
  market_id: Number(mid),
  type: "Coriolis Starport",
  is_planetary: false,
  large_pads: 4,
  system_x: 1,
  system_y: 2,
  system_z: 3,
  market: market(rows),
});

let dir: string;
let index: MaterialBuyIndex;
beforeEach(async () => {
  vi.resetModules();
  dir = await mkdtemp(path.join(tmpdir(), "whole-markets-"));
  index = new MaterialBuyIndex(dir);
  await index.load();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
});

const items = [
  { id: "titanium", name: "Titanium", nameLocalised: "Titanium", quantityTons: 5000 },
  { id: "steel", name: "Steel", nameLocalised: "Steel", quantityTons: 4000 },
  { id: "liquidoxygen", name: "Liquid oxygen", nameLocalised: "Liquid oxygen", quantityTons: 3000 },
];

describe("a station's whole market by market id", () => {
  it("saves every needed commodity it sells, with stock and price, and asks each market once", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/4373462019")) {
        return new Response(JSON.stringify({ record: station("4373462019", "Broot's Monolith", [["Titanium", 900, 1200], ["Steel", 4000, 300], ["Gold", 50, 9000], ["Liquid oxygen", 0, 500]]) }));
      }
      return new Response("not found", { status: 404 });
    });
    const { refreshMarketsById, resetMarketsAskedForTests } = await import("../../../src/server/colonize/spanshStationMarket");
    resetMarketsAskedForTests();
    const saved = await refreshMarketsById({ index, referenceSystem: "Swoilz KI-E b4-9", marketIds: ["4373462019", "999", "4373462019"], items });
    expect(saved).toBe(2);
    const ti = index.getRow("Swoilz KI-E b4-9", "titanium")!.stations[0]!;
    expect([ti.stationName, ti.supply, ti.buyPrice, ti.dataSource]).toEqual(["Broot's Monolith", 900, 1200, "spansh"]);
    expect(index.getRow("Swoilz KI-E b4-9", "steel")!.stations[0]!.supply).toBe(4000);
    // Sold out there: not a seller.
    expect(index.getRow("Swoilz KI-E b4-9", "liquidoxygen")).toBeNull();
    expect(calls.filter((c) => c.includes("/api/station/"))).toHaveLength(2);
    // Asked within the hour: not again.
    await refreshMarketsById({ index, referenceSystem: "Swoilz KI-E b4-9", marketIds: ["4373462019"], items });
    expect(calls.filter((c) => c.includes("/api/station/"))).toHaveLength(2);
  });
});

describe("a commodity search", () => {
  it("keeps every needed commodity from the markets in its answer, not just the one searched", async () => {
    const answer = {
      count: 2,
      results: [
        station("1", "Alpha Hub", [["Titanium", 700, 1100], ["Steel", 300, 250]]),
        station("2", "Beta Port", [["Titanium", 50, 1150], ["Liquid oxygen", 2000, 400]]),
      ],
    };
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/api/stations/search")) return new Response(JSON.stringify(answer));
      return new Response(JSON.stringify({ min_max: [], values: [] }));
    });
    const { scanAndPersistMaterialHits } = await import("../../../src/server/colonize/spanshCheckout");
    const saved = await scanAndPersistMaterialHits({ index, referenceSystem: "Swoilz KI-E b4-9", item: items[0]!, alsoFor: items });
    expect(saved).toBe(4);
    expect(index.getRow("Swoilz KI-E b4-9", "titanium")!.stations).toHaveLength(2);
    expect(index.getRow("Swoilz KI-E b4-9", "steel")!.stations.map((s) => s.stationName)).toEqual(["Alpha Hub"]);
    expect(index.getRow("Swoilz KI-E b4-9", "liquidoxygen")!.stations[0]!.supply).toBe(2000);
  });
});

describe("a market normalised twice", () => {
  it("keeps its rows (the index writer normalises what the search already had, and dropped everything)", async () => {
    const { normalizeSpanshMarketArray } = await import("../../../src/server/colonize/spanshStationBuySearch");
    const once = normalizeSpanshMarketArray(market([["Steel", 300, 250], ["Gold", 0, 9000]]));
    expect(once).toHaveLength(1);
    expect(normalizeSpanshMarketArray(once)).toEqual(once);
  });
});

describe("which journal markets are read", () => {
  it("sellers of needed goods first, nearest first; construction sites never", () => {
    const shop = (marketId: string, ly: number, bought: string[], name = `S${marketId}`) =>
      ({ marketId, stationName: name, starSystem: "X", stationType: "Coriolis", visitedAt: "", purchases: bought.map((c) => ({ commodityId: c, label: c, count: 10, buyPrice: 1, boughtAt: "" })), constructionDistanceLy: ly }) as JournalShopRecord;
    const ids = journalMarketIdsForScan(
      [shop("1", 5, ["gold"]), shop("2", 40, ["titanium"]), shop("3", 10, ["steel"]), shop("4", 1, ["steel"], "Orbital Construction Site: Hub")],
      items,
      [{ marketId: "4", systemName: "X", stationName: "Orbital Construction Site: Hub" }] as never,
    );
    expect(ids).toEqual(["3", "2", "1"]);
  });
});

describe("a journal seller with unknown stock", () => {
  it("is not a one-ton shelf: the plan buys what is needed there and reports nothing as unfit", () => {
    const site: DepotSnapshot = {
      marketId: "site",
      starSystem: "Swoilz KI-E b4-9",
      systemAddress: null,
      stationName: "Site",
      constructionSiteLabel: "Site",
      progress: 0,
      complete: false,
      failed: false,
      lastTimestamp: null,
      resources: [{ name: "Titanium", nameLocalised: "Titanium", required: 400, provided: 0, payment: null }],
      contributions: [],
    };
    const proven: MaterialBuyStationHit = {
      systemName: "HIP 87696",
      stationName: "Nelson Reach",
      marketId: "4288787203",
      distanceLy: 23,
      buyPrice: null,
      supply: null,
      spanshCommodity: "Titanium",
      dataSource: "journal",
      stationType: "Coriolis",
      isPlanetaryOrGround: false,
      pad: "L",
      foundAtIso: "2026-06-13T21:23:43Z",
      purchaseProven: true,
    };
    const listings: MaterialBuyListing[] = [{ id: "titanium", label: "Titanium", quantityNeeded: 400, servedFromCache: true, stations: [proven] }];
    const p = buildLogisticsPlan({
      checkouts: [],
      buyListings: listings,
      activeDepots: [site],
      cargoByKey: new Map(),
      cargoCapacity: 200,
      wing: [],
      shopHistory: [],
      homeSystem: "Swoilz KI-E b4-9",
      constructionDistanceSystems: ["Swoilz KI-E b4-9"],
      stationKind: "space",
    });
    expect(p.missingTripEligible).toEqual([]);
    expect(p.trips).toHaveLength(2);
    expect(p.trips.reduce((a, t) => a + t.loadTons, 0)).toBe(400);
  });
});
