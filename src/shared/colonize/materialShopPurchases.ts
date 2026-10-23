import { commodityNeedMatchesLabel } from "./commodityKey";
import { enrichMaterialListingsGalaxyLy } from "./galaxyDistanceTargets";
import { isConstructionDepotStation, type ConstructionDepotRef } from "./constructionDepot";
import type { MaterialBuyListing, MaterialBuyStationHit } from "./materialBuyIndexTypes";
import { bestGalaxyLyFromSites, isKnownLy, type Ly } from "./systemDistanceLy";
import { isCommanderBuyOffer } from "./stationSellOffer";
import { findShopHistoryEntry, shopEntryBoughtNeed, type ShopHistoryEntry } from "./shopHistory";
import { buyStationPlaceKey, mergeBuyStationHits } from "./buyStationMerge";

function shopEntryForHit(history: ShopHistoryEntry[], hit: MaterialBuyStationHit): ShopHistoryEntry | undefined {
  const found = findShopHistoryEntry(history, hit.systemName, hit.stationName);
  return found?.entry;
}

/** 3D Ly from colonization site — uses shop entry cache, galaxy map, or same-system co-location. */
export function resolveHitDistanceLy(
  systemName: string,
  constructionSite: string,
  distanceMap: Record<string, number>,
  entry?: ShopHistoryEntry,
  prevLy?: Ly,
  constructionSites: string[] = [],
): Ly {
  if (isKnownLy(prevLy)) return prevLy;
  if (isKnownLy(entry?.constructionDistanceLy)) return entry.constructionDistanceLy;
  const sites = [...new Set([constructionSite, ...constructionSites].map((s) => s.trim()).filter(Boolean))];
  return bestGalaxyLyFromSites(systemName, sites, distanceMap);
}

function purchaseOfferForNeed(
  entry: ShopHistoryEntry,
  needId: string,
  needLabel: string,
): { buyPrice: number | null; supply: number | null; label: string } | null {
  const cached = entry.cachedOffers?.find(
    (o) => o.commodityId === needId || commodityNeedMatchesLabel(needId, needLabel, o.commodityId),
  );
  if (cached && isCommanderBuyOffer(cached.supply, cached.buyPrice)) {
    return { buyPrice: cached.buyPrice, supply: cached.supply, label: cached.label };
  }
  for (const p of entry.purchases ?? []) {
    if (p.count <= 0) continue;
    if (p.commodityId !== needId && !commodityNeedMatchesLabel(needId, needLabel, p.commodityId)) continue;
    return {
      buyPrice: p.buyPrice,
      supply: cached?.supply && cached.supply > 0 ? cached.supply : null,
      label: p.label || needLabel,
    };
  }
  if (entry.commodityIds.some((id) => id === needId || commodityNeedMatchesLabel(needId, needLabel, id))) {
    return { buyPrice: cached?.buyPrice ?? null, supply: cached?.supply ?? null, label: needLabel };
  }
  return null;
}

function hitFromShopPurchase(
  entry: ShopHistoryEntry,
  needId: string,
  needLabel: string,
  offer: { buyPrice: number | null; supply: number | null; label: string },
  constructionSite: string,
  distanceMap: Record<string, number>,
): MaterialBuyStationHit {
  return {
    systemName: entry.systemName,
    stationName: entry.stationName,
    marketId: entry.marketId,
    distanceLy: resolveHitDistanceLy(entry.systemName, constructionSite, distanceMap, entry),
    buyPrice: offer.buyPrice,
    supply: offer.supply,
    spanshCommodity: offer.label,
    dataSource: "journal",
    foundAtIso: entry.visitedAt,
    purchaseProven: true,
  };
}

/** Add stations where you previously bought each SKU (journal MarketBuy + dock history). */
function purchaseHitsForNeed(
  history: ShopHistoryEntry[],
  needId: string,
  needLabel: string,
  depots: ConstructionDepotRef[] = [],
  constructionSite = "",
  distanceMap: Record<string, number> = {},
): MaterialBuyStationHit[] {
  const out: MaterialBuyStationHit[] = [];
  for (const entry of history) {
    if (!shopEntryBoughtNeed(entry, needId, needLabel)) continue;
    if (
      isConstructionDepotStation(depots, {
        systemName: entry.systemName,
        stationName: entry.stationName,
        marketId: entry.marketId,
      })
    ) {
      continue;
    }
    const offer = purchaseOfferForNeed(entry, needId, needLabel);
    if (!offer) continue;
    out.push(hitFromShopPurchase(entry, needId, needLabel, offer, constructionSite, distanceMap));
  }
  return out;
}

/** Ensure every depot need has a listing row so purchase hits can attach. */
export function ensureListingRowsForNeeds(
  listings: MaterialBuyListing[],
  needs: Array<{ id: string; label: string; quantityTons: number }>,
): MaterialBuyListing[] {
  const byId = new Map(listings.map((m) => [m.id, m]));
  const out = [...listings];
  for (const need of needs) {
    if (!need.id || byId.has(need.id)) continue;
    const row: MaterialBuyListing = {
      id: need.id,
      label: need.label,
      quantityNeeded: need.quantityTons,
      servedFromCache: false,
      stations: [],
    };
    byId.set(need.id, row);
    out.push(row);
  }
  return out;
}

function mergePurchaseHitsIntoListing(
  mat: MaterialBuyListing,
  history: ShopHistoryEntry[],
  depots: ConstructionDepotRef[],
  constructionSite: string,
  distanceMap: Record<string, number>,
  constructionSites: string[],
): MaterialBuyListing {
  const byKey = new Map<string, MaterialBuyStationHit>();
  for (const h of mat.stations) {
    const entry = shopEntryForHit(history, h);
    const distanceLy = resolveHitDistanceLy(
      h.systemName,
      constructionSite,
      distanceMap,
      entry,
      h.distanceLy,
      constructionSites,
    );
    const k = buyStationPlaceKey(h);
    const next = distanceLy === h.distanceLy ? h : { ...h, distanceLy };
    const prev = byKey.get(k);
    byKey.set(k, prev ? mergeBuyStationHits(prev, next) : next);
  }
  for (const h of purchaseHitsForNeed(history, mat.id, mat.label, depots, constructionSite, distanceMap)) {
    const k = buyStationPlaceKey(h);
    const prev = byKey.get(k);
    if (!prev) {
      byKey.set(k, h);
      continue;
    }
    const entry = shopEntryForHit(history, h);
    const merged = mergeBuyStationHits(prev, { ...h, purchaseProven: true });
    byKey.set(k, {
      ...merged,
      purchaseProven: true,
      distanceLy: resolveHitDistanceLy(
        h.systemName,
        constructionSite,
        distanceMap,
        entry,
        merged.distanceLy,
        constructionSites,
      ),
    });
  }
  const stations = [...byKey.values()];
  if (!stations.length) return mat;
  return { ...mat, stations };
}

/** Merge purchase-memory stations into checkout/planner buy listings. */
function enrichMaterialListingsFromShopPurchases(
  listings: MaterialBuyListing[],
  history: ShopHistoryEntry[],
  depots: ConstructionDepotRef[] = [],
  constructionSite = "",
  distanceMap: Record<string, number> = {},
  constructionSites: string[] = [],
): MaterialBuyListing[] {
  if (!history.length && !constructionSite.trim() && !Object.keys(distanceMap).length) return listings;
  const sites = constructionSites.length
    ? constructionSites
    : constructionSite.trim()
      ? [constructionSite]
      : [];
  return listings.map((mat) =>
    mergePurchaseHitsIntoListing(mat, history, depots, constructionSite, distanceMap, sites),
  );
}

export type FinalizeMaterialBuyListingsArgs = {
  listings: MaterialBuyListing[];
  shopHistory: ShopHistoryEntry[];
  depots?: ConstructionDepotRef[];
  constructionSite?: string;
  constructionSites?: string[];
  distanceMap?: Record<string, number>;
};

/**
 * Purchase history → galaxy 3D Ly from construction site.
 * Always run this instead of piecemeal enrich calls.
 */
export function finalizeMaterialBuyListings(args: FinalizeMaterialBuyListingsArgs): MaterialBuyListing[] {
  const sites = (args.constructionSites ?? (args.constructionSite ? [args.constructionSite] : []))
    .map((s) => s.trim())
    .filter(Boolean);
  const site = sites[0] ?? "";
  const distanceMap = args.distanceMap ?? {};
  const depots = args.depots ?? [];
  let out = enrichMaterialListingsFromShopPurchases(
    args.listings,
    args.shopHistory,
    depots,
    site,
    distanceMap,
    sites,
  );
  if (site && Object.keys(distanceMap).length) {
    out = enrichMaterialListingsGalaxyLy(out, site, distanceMap, args.shopHistory);
  }
  return out;
}
