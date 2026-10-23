import { parseMarketId } from "./marketId";
import { buyStationPlaceKey } from "./buyStationMerge";
import { commodityMergeBucket } from "./commodityKey";
import { galaxyDistancePairKey, isKnownLy, toLy } from "./systemDistanceLy";
import { normSystemName } from "./stationFilter";
import { isConstructionDepotStation } from "./constructionDepot";
import type { DepotSnapshot } from "./types";
import type { ShopHistoryCachedOffer, ShopHistoryEntry, ShopHistoryPurchase } from "./shopHistory";

export type JournalShopRecord = {
  marketId: string;
  stationName: string;
  starSystem: string;
  stationType: string | null;
  visitedAt: string;
  purchases: {
    commodityId: string;
    label: string;
    count: number;
    buyPrice: number | null;
    boughtAt: string;
  }[];
  /** Full commodity rows from `Market.json` when the screen was open. */
  marketItems?: ShopHistoryCachedOffer[];
  /** Ly from construction hub — EDSM coords, cached after first resolve. */
  constructionDistanceLy?: number | null;
};

function marketIdFromJournal(j: Record<string, unknown>): string | null {
  return parseMarketId(j.MarketID);
}

function commodityFromJournalType(type: string): { id: string; label: string } | null {
  const raw = type.trim();
  if (!raw) return null;
  const id = commodityMergeBucket(raw) || commodityMergeBucket(raw.replace(/_/g, " "));
  if (!id) return null;
  const label = raw.charAt(0).toUpperCase() + raw.slice(1).replace(/_/g, " ");
  return { id, label };
}

/** Parse `Market.json` `Items` into planner-ready offers (stock for sale only). */
function marketJsonToOffers(j: Record<string, unknown>): ShopHistoryCachedOffer[] {
  const items = j.Items;
  if (!Array.isArray(items)) return [];
  const out: ShopHistoryCachedOffer[] = [];
  for (const row of items) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const name = typeof r.Name === "string" ? r.Name : "";
    const nl = typeof r.Name_Localised === "string" ? r.Name_Localised : name;
    const stock = typeof r.Stock === "number" ? r.Stock : 0;
    // BuyPrice is what the commander pays (it goes with Stock); SellPrice is what the market pays him (with Demand).
    const buyPrice = typeof r.BuyPrice === "number" && r.BuyPrice > 0 ? r.BuyPrice : null;
    if (stock <= 0 || buyPrice == null) continue;
    const id = commodityMergeBucket(name) || commodityMergeBucket(nl);
    if (!id) continue;
    out.push({
      commodityId: id,
      label: (nl || name).trim() || name,
      supply: stock,
      buyPrice,
    });
  }
  return out;
}

/** Attach `Market.json` catalog to a visited shop (ID + location + contents). */
export function applyMarketJsonToJournalShop(
  shops: Map<string, JournalShopRecord>,
  j: Record<string, unknown>,
): boolean {
  const marketId = marketIdFromJournal(j);
  const stationName = typeof j.StationName === "string" ? j.StationName.trim() : "";
  const starSystem = typeof j.StarSystem === "string" ? j.StarSystem.trim() : "";
  const items = marketJsonToOffers(j);
  if (!marketId || !items.length) return false;

  const visitedAt = typeof j.timestamp === "string" ? j.timestamp : new Date().toISOString();
  const stationType = typeof j.StationType === "string" ? j.StationType : null;
  const prev = shops.get(marketId);
  if (prev) {
    const changed =
      prev.marketItems?.length !== items.length ||
      JSON.stringify(prev.marketItems) !== JSON.stringify(items);
    prev.marketItems = items;
    if (stationName) prev.stationName = stationName;
    if (starSystem) prev.starSystem = starSystem;
    if (stationType) prev.stationType = stationType;
    if (visitedAt > prev.visitedAt) prev.visitedAt = visitedAt;
    return changed;
  }
  if (!stationName || !starSystem) return false;
  shops.set(marketId, {
    marketId,
    stationName,
    starSystem,
    stationType,
    visitedAt,
    purchases: [],
    marketItems: items,
  });
  return true;
}

export function migrateJournalShopRecord(raw: unknown): JournalShopRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const marketId = typeof r.marketId === "string" ? r.marketId.trim() : "";
  const stationName = typeof r.stationName === "string" ? r.stationName.trim() : "";
  const starSystem = typeof r.starSystem === "string" ? r.starSystem.trim() : "";
  if (!marketId || !stationName || !starSystem) return null;
  const visitedAt = typeof r.visitedAt === "string" ? r.visitedAt : new Date(0).toISOString();
  const stationType = typeof r.stationType === "string" ? r.stationType : null;
  const purchases: JournalShopRecord["purchases"] = [];
  if (Array.isArray(r.purchases)) {
    for (const p of r.purchases) {
      if (!p || typeof p !== "object") continue;
      const row = p as Record<string, unknown>;
      const commodityId = typeof row.commodityId === "string" ? row.commodityId : "";
      const label = typeof row.label === "string" ? row.label : commodityId;
      const count = typeof row.count === "number" ? row.count : 0;
      const buyPrice = typeof row.buyPrice === "number" ? row.buyPrice : null;
      const boughtAt = typeof row.boughtAt === "string" ? row.boughtAt : visitedAt;
      if (!commodityId || count <= 0) continue;
      purchases.push({ commodityId, label, count, buyPrice, boughtAt });
    }
  }
  const marketItems: ShopHistoryCachedOffer[] = [];
  if (Array.isArray(r.marketItems)) {
    for (const o of r.marketItems) {
      if (!o || typeof o !== "object") continue;
      const row = o as Record<string, unknown>;
      const commodityId = typeof row.commodityId === "string" ? row.commodityId : "";
      const label = typeof row.label === "string" ? row.label : commodityId;
      const supply = typeof row.supply === "number" ? row.supply : 0;
      const buyPrice = typeof row.buyPrice === "number" ? row.buyPrice : null;
      if (!commodityId || supply <= 0 || buyPrice == null || buyPrice <= 0) continue;
      marketItems.push({ commodityId, label, supply, buyPrice });
    }
  }
  /** `0` survives: it is a shop in the construction system, which the loader used to throw away. */
  const constructionDistanceLy = toLy(r.constructionDistanceLy);
  return { marketId, stationName, starSystem, stationType, visitedAt, purchases, marketItems, constructionDistanceLy };
}

/** True when some shop's distance changed (nothing to save or push otherwise). */
export function applyShopDistanceLyToJournalRecords(
  shops: Map<string, JournalShopRecord>,
  distanceBySystem: Record<string, number>,
  constructionRefs: string[] = [],
): boolean {
  const refs = [...new Set(constructionRefs.map((s) => s.trim()).filter(Boolean))];
  let changed = false;
  for (const rec of shops.values()) {
    let best: number | null = null;
    for (const ref of refs) {
      if (normSystemName(ref) === normSystemName(rec.starSystem)) {
        best = 0;
        break;
      }
      const d = distanceBySystem[galaxyDistancePairKey(ref, rec.starSystem)];
      if (isKnownLy(d) && (best == null || d < best)) best = d;
    }
    if (best != null && rec.constructionDistanceLy !== best) {
      rec.constructionDistanceLy = best;
      changed = true;
    }
  }
  return changed;
}

/** `event: Market` — docked at a station with market screen open. */
export function applyJournalMarketLine(
  shops: Map<string, JournalShopRecord>,
  j: Record<string, unknown>,
  fallbackStarSystem: string | null,
): void {
  const marketId = marketIdFromJournal(j);
  const stationName = typeof j.StationName === "string" ? j.StationName.trim() : "";
  const starSystem =
    (typeof j.StarSystem === "string" ? j.StarSystem.trim() : "") || fallbackStarSystem?.trim() || "";
  if (!marketId || !stationName || !starSystem) return;

  const seenAt = typeof j.timestamp === "string" ? j.timestamp : new Date().toISOString();
  const stationType = typeof j.StationType === "string" ? j.StationType : null;
  const prev = shops.get(marketId);
  // The latest visit wins: the whole history is read once, then the last week again at every start.
  const visitedAt = prev?.visitedAt && prev.visitedAt > seenAt ? prev.visitedAt : seenAt;
  /**
   * Spread the previous record: `marketItems` and `constructionDistanceLy` are attached
   * from Market.json and by the planner, and rebuilding from only `purchases` threw them
   * away every time this event was replayed.
   */
  shops.set(marketId, {
    ...prev,
    marketId,
    stationName,
    starSystem,
    stationType,
    visitedAt,
    purchases: prev?.purchases ?? [],
  });
}

/** `event: MarketBuy` — bought cargo at the current market. */
export function applyJournalMarketBuyLine(
  shops: Map<string, JournalShopRecord>,
  j: Record<string, unknown>,
  ctx: { stationName: string; starSystem: string; stationType: string | null } | null,
): void {
  const marketId = marketIdFromJournal(j);
  const type = typeof j.Type === "string" ? j.Type : "";
  const count = typeof j.Count === "number" ? j.Count : 0;
  const buyPrice = typeof j.BuyPrice === "number" ? j.BuyPrice : null;
  const boughtAt = typeof j.timestamp === "string" ? j.timestamp : new Date().toISOString();
  if (!marketId || !type || count <= 0) return;

  const comm = commodityFromJournalType(type);
  if (!comm) return;

  let rec = shops.get(marketId);
  if (!rec && ctx?.stationName && ctx.starSystem) {
    rec = {
      marketId,
      stationName: ctx.stationName,
      starSystem: ctx.starSystem,
      stationType: ctx.stationType,
      visitedAt: boughtAt,
      purchases: [],
    };
    shops.set(marketId, rec);
  }
  if (!rec) return;
  // Read once from the whole history and again with every start's last week: one purchase, one row.
  if (rec.purchases.some((p) => p.boughtAt === boughtAt && p.commodityId === comm.id && p.count === count)) return;

  rec.purchases.push({
    commodityId: comm.id,
    label: comm.label,
    count,
    buyPrice,
    boughtAt,
  });
  if (boughtAt > rec.visitedAt) rec.visitedAt = boughtAt;
}

function journalShopToHistoryEntry(rec: JournalShopRecord): ShopHistoryEntry {
  const commodityIds = new Set<string>();
  const offerMap = new Map<string, ShopHistoryCachedOffer>();
  for (const o of rec.marketItems ?? []) {
    if (o.supply > 0 && o.buyPrice != null && o.buyPrice > 0) {
      offerMap.set(o.commodityId, o);
    }
  }
  const purchases: ShopHistoryPurchase[] = [];
  for (const p of rec.purchases) {
    if (p.count <= 0) continue;
    commodityIds.add(p.commodityId);
    purchases.push({
      commodityId: p.commodityId,
      label: p.label,
      count: p.count,
      buyPrice: p.buyPrice,
    });
  }
  return {
    systemName: rec.starSystem,
    stationName: rec.stationName,
    marketId: rec.marketId,
    visitedAt: rec.visitedAt,
    commodityIds: [...commodityIds],
    purchases,
    cachedOffers: [...offerMap.values()],
    fromJournal: true,
    constructionDistanceLy: rec.constructionDistanceLy ?? null,
  };
}

export function journalShopsToShopHistory(
  shops: Iterable<JournalShopRecord>,
  depots: DepotSnapshot[] = [],
): ShopHistoryEntry[] {
  const out: ShopHistoryEntry[] = [];
  for (const rec of shops) {
    if (
      depots.length &&
      isConstructionDepotStation(depots, {
        systemName: rec.starSystem,
        stationName: rec.stationName,
        marketId: rec.marketId,
      })
    ) {
      continue;
    }
    out.push(journalShopToHistoryEntry(rec));
  }
  out.sort((a, b) => Date.parse(b.visitedAt) - Date.parse(a.visitedAt));
  return out;
}

/** Journal wins on conflicts — it has ground-truth Market / MarketBuy lines. */
export function mergeJournalAndLocalShopHistory(
  journal: ShopHistoryEntry[],
  local: ShopHistoryEntry[],
): ShopHistoryEntry[] {
  /**
   * Place, not market id. Visits recorded in the renderer carry an empty marketId, so
   * including it here kept them separate from the journal's record of the same station
   * and the dock history listed the station twice.
   */
  const key = (e: ShopHistoryEntry) => buyStationPlaceKey(e);
  const map = new Map<string, ShopHistoryEntry>();
  for (const e of local) map.set(key(e), e);
  for (const e of journal) {
    const k = key(e);
    const prev = map.get(k);
    if (!prev) {
      map.set(k, e);
      continue;
    }
    const ids = new Set([...prev.commodityIds, ...e.commodityIds]);
    const offers = new Map<string, ShopHistoryCachedOffer>();
    for (const o of prev.cachedOffers ?? []) offers.set(o.commodityId, o);
    for (const o of e.cachedOffers ?? []) offers.set(o.commodityId, o);
    const purchaseMap = new Map<string, ShopHistoryPurchase>();
    for (const p of prev.purchases ?? []) purchaseMap.set(p.commodityId, p);
    for (const p of e.purchases ?? []) purchaseMap.set(p.commodityId, p);
    map.set(k, {
      ...e,
      commodityIds: [...ids],
      purchases: [...purchaseMap.values()],
      cachedOffers: [...offers.values()],
      visitedAt: e.visitedAt > prev.visitedAt ? e.visitedAt : prev.visitedAt,
      constructionDistanceLy: e.constructionDistanceLy ?? prev.constructionDistanceLy ?? null,
    });
  }
  return [...map.values()].sort((a, b) => Date.parse(b.visitedAt) - Date.parse(a.visitedAt));
}
