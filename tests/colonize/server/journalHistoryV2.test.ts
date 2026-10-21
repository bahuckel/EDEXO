/**
 * Colonize v2, C1 (owner's test, 2026-10-22): Search found nothing and his carrier was "not found", because Colonize
 * kept only the last week of markets and carriers. Now the whole history's markets, purchases and carriers are read
 * once and kept, nothing is counted twice when the week is read again at the next start, his carrier is known from
 * the game's load-in line, and Search lists his own history first.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ColonizeStore } from "../../../src/server/colonize/colonizeStore";
import { applyJournalLine, createJournalState, ownedCarrierStocks } from "../../../src/server/colonize/journalEvents";
import { searchBuyIndexStationsForMaterials } from "../../../src/server/colonize/buyIndexSearch";
import { MaterialBuyIndex } from "../../../src/server/colonize/materialBuyIndex";
import { applyMarketJsonToJournalShop, type JournalShopRecord } from "../../../src/shared/colonize/journalShopHistory";

const CARRIER = 3_704_402_432;
const NOW = Date.now();
const iso = (daysAgo: number, min = 0) => new Date(NOW - daysAgo * 86_400_000 + min * 60_000).toISOString();
function journalName(daysAgo: number): string {
  const d = new Date(NOW - daysAgo * 86_400_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `Journal.${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}.01.log`;
}
const lines = (...objs: object[]) => objs.map((o) => JSON.stringify(o)).join("\r\n") + "\r\n";
const apply = (state: ReturnType<typeof createJournalState>, o: object) => applyJournalLine(state, JSON.stringify(o));

describe("journal lines", () => {
  it("his carrier is his from the load-in line; a squadron's is not", () => {
    const s = createJournalState();
    apply(s, { timestamp: iso(1), event: "CarrierLocation", CarrierType: "SquadronCarrier", CarrierID: 99, StarSystem: "Elsewhere", SystemAddress: 1 });
    expect(ownedCarrierStocks(s)).toEqual([]);
    apply(s, { timestamp: iso(1), event: "CarrierLocation", CarrierType: "FleetCarrier", CarrierID: CARRIER, StarSystem: "Here", SystemAddress: 2 });
    expect(ownedCarrierStocks(s).map((c) => c.carrierId)).toEqual([String(CARRIER)]);
    // Docked at it: its callsign is the station's name.
    apply(s, { timestamp: iso(1, 1), event: "Docked", StationName: "K7Q-1HT", StationType: "FleetCarrier", MarketID: CARRIER, StarSystem: "Here" });
    expect(ownedCarrierStocks(s)[0]!.callsign).toBe("K7Q-1HT");
  });

  it("counts a transfer once however often it is read, and an older CarrierStats never wins", () => {
    const s = createJournalState();
    apply(s, { timestamp: iso(2), event: "CarrierLocation", CarrierType: "FleetCarrier", CarrierID: CARRIER, StarSystem: "Here", SystemAddress: 2 });
    apply(s, { timestamp: iso(2, 1), event: "Docked", StationName: "K7Q-1HT", StationType: "FleetCarrier", MarketID: CARRIER, StarSystem: "Here" });
    const transfer = { timestamp: iso(2, 2), event: "CargoTransfer", Transfers: [{ Type: "steel", Count: 300, Direction: "tocarrier" }] };
    apply(s, transfer);
    apply(s, transfer);
    expect(ownedCarrierStocks(s)[0]!.tonsByCommodity.steel).toBe(300);
    apply(s, { timestamp: iso(1), event: "CarrierStats", CarrierID: CARRIER, Callsign: "K7Q-1HT", Name: "NEW NAME", SpaceUsage: { Cargo: 900, TotalCapacity: 25000 } });
    apply(s, { timestamp: iso(5), event: "CarrierStats", CarrierID: CARRIER, Callsign: "K7Q-1HT", Name: "OLD NAME", SpaceUsage: { Cargo: 10, TotalCapacity: 25000 } });
    expect(ownedCarrierStocks(s)[0]).toMatchObject({ name: "NEW NAME", reportedTons: 900 });
  });

  it("records a purchase once, keeps the latest visit, and reads Market.json's buy price", () => {
    const s = createJournalState();
    apply(s, { timestamp: iso(3), event: "Market", MarketID: 128, StationName: "Hammond Hub", StarSystem: "Laso", StationType: "Coriolis" });
    const buy = { timestamp: iso(3, 1), event: "MarketBuy", MarketID: 128, Type: "aluminium", Count: 80, BuyPrice: 400, TotalCost: 32000 };
    apply(s, buy);
    apply(s, buy);
    apply(s, { timestamp: iso(9), event: "Market", MarketID: 128, StationName: "Hammond Hub", StarSystem: "Laso", StationType: "Coriolis" });
    const rec = s.journalShops.get("128")!;
    expect(rec.purchases).toHaveLength(1);
    expect(rec.visitedAt).toBe(iso(3, 1));

    const shops = new Map<string, JournalShopRecord>();
    applyMarketJsonToJournalShop(shops, {
      timestamp: iso(0),
      MarketID: 128,
      StationName: "Hammond Hub",
      StarSystem: "Laso",
      Items: [{ Name: "$aluminium_name;", Name_Localised: "Aluminium", BuyPrice: 412, SellPrice: 380, Stock: 5000, Demand: 0 }],
    });
    expect(shops.get("128")!.marketItems).toEqual([{ commodityId: expect.any(String), label: "Aluminium", supply: 5000, buyPrice: 412 }]);
  });
});

describe("the store across restarts", () => {
  let journalDir: string;
  let dataDir: string;
  let store: ColonizeStore | null = null;
  beforeEach(() => {
    journalDir = mkdtempSync(path.join(tmpdir(), "colonize-v2-j-"));
    dataDir = mkdtempSync(path.join(tmpdir(), "colonize-v2-d-"));
    writeFileSync(
      path.join(journalDir, journalName(40)),
      lines(
        { timestamp: iso(40), event: "Location", StarSystem: "Laso", SystemAddress: 5 },
        { timestamp: iso(40, 1), event: "Market", MarketID: 128, StationName: "Hammond Hub", StarSystem: "Laso", StationType: "Coriolis" },
        { timestamp: iso(40, 2), event: "MarketBuy", MarketID: 128, Type: "aluminium", Count: 80, BuyPrice: 400, TotalCost: 32000 },
        { timestamp: iso(40, 3), event: "CarrierLocation", CarrierType: "FleetCarrier", CarrierID: CARRIER, StarSystem: "Laso", SystemAddress: 5 },
        { timestamp: iso(40, 4), event: "Docked", StationName: "K7Q-1HT", StationType: "FleetCarrier", MarketID: CARRIER, StarSystem: "Laso" },
        { timestamp: iso(40, 5), event: "CargoTransfer", Transfers: [{ Type: "aluminium", Count: 80, Direction: "tocarrier" }] },
        { timestamp: iso(40, 6), event: "Undocked", StationName: "K7Q-1HT", MarketID: CARRIER },
      ),
    );
    // Inside the week: one more transfer, read again at every start.
    writeFileSync(
      path.join(journalDir, journalName(0)),
      lines(
        { timestamp: iso(0), event: "Docked", StationName: "K7Q-1HT", StationType: "FleetCarrier", MarketID: CARRIER, StarSystem: "Laso" },
        { timestamp: iso(0, 1), event: "CargoTransfer", Transfers: [{ Type: "steel", Count: 50, Direction: "tocarrier" }] },
      ),
    );
  });
  afterEach(async () => {
    await store?.shutdown();
    store = null;
    rmSync(journalDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });
  const start = async () => {
    const s = new ColonizeStore(dataDir, { journalDir: () => journalDir, edsmApiKey: () => null });
    await s.load();
    await s.restartTail();
    return s;
  };

  it("keeps old purchases and his carrier, and counts nothing twice when the week is read again", async () => {
    store = await start();
    const check = (s: ColonizeStore) => {
      const shop = s.getJournalShopRecords().find((r) => r.marketId === "128");
      expect(shop?.purchases).toHaveLength(1);
      const carrier = s.getSnapshot().carriers[0]!;
      expect(carrier.carrierId).toBe(String(CARRIER));
      expect(carrier.callsign).toBe("K7Q-1HT");
      expect(carrier.tonsByCommodity).toMatchObject({ steel: 50 });
      expect(Object.values(carrier.tonsByCommodity).reduce((a, n) => a + n, 0)).toBe(130);
    };
    check(store);
    await store.shutdown();
    store = await start();
    check(store);
  });

  it("reads the history once more for a folder read by an older version (v1)", async () => {
    writeFileSync(path.join(dataDir, "edexo-colonize-state.json"), JSON.stringify({ v: 3, depots: {}, historyScannedDir: journalDir }));
    store = await start();
    expect(store.getJournalShopRecords().find((r) => r.marketId === "128")?.purchases).toHaveLength(1);
    await store.shutdown();
    store = null;
    expect(JSON.parse(readFileSync(path.join(dataDir, "edexo-colonize-state.json"), "utf8")).historyScannedVersion).toBe(2);
  });
});

describe("Search", () => {
  it("lists where he bought it first, then where he docked, then the rest", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "colonize-v2-i-"));
    try {
      const index = new MaterialBuyIndex(dir);
      const hit = (sys: string, st: string, ly: number) => ({
        systemName: sys,
        stationName: st,
        marketId: `${sys}-${st}`,
        distanceLy: ly,
        buyPrice: 400,
        supply: 5000,
        spanshCommodity: "Aluminium",
        dataSource: "spansh" as const,
        foundAtIso: iso(0),
      });
      index.mergeStations("Laso", "aluminium", "Aluminium", [hit("Near", "Spansh Port", 1), hit("Far", "Other Port", 90)]);
      const shops: JournalShopRecord[] = [
        { marketId: "128", stationName: "Hammond Hub", starSystem: "Laso", stationType: "Coriolis", visitedAt: iso(40), constructionDistanceLy: 40, purchases: [{ commodityId: "aluminium", label: "Aluminium", count: 80, buyPrice: 400, boughtAt: iso(40) }, { commodityId: "aluminium", label: "Aluminium", count: 20, buyPrice: 400, boughtAt: iso(39) }] },
      ];
      const res = searchBuyIndexStationsForMaterials(index, shops, "Aluminium");
      expect(res[0]).toMatchObject({ stationName: "Hammond Hub", boughtCount: 2 });
      expect(res.slice(1).map((r) => r.stationName)).toEqual(["Spansh Port", "Other Port"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
