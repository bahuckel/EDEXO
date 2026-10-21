import { buyStationHitMatchesNeed } from "../../shared/colonize/buyStationHitMatch";
import { withLocalStationFacts } from "./localStationFacts";
import { commodityIdsEquivalent, commodityNeedMatchesLabel } from "../../shared/colonize/commodityKey";
import { isConstructionDepotStation, type ConstructionDepotRef } from "../../shared/colonize/constructionDepot";
import type {
  BuyIndexStationMaterial,
  BuyIndexStationResult,
  BuyIndexSystemResult,
} from "../../shared/colonize/buyIndexSearchTypes";
import {
  formatMaterialSearchLabel,
  materialNeedsFromQuery,
  planMaterialSearchQuery,
  resolveMaterialLookupNeed,
  type MaterialSearchNeed,
} from "../../shared/colonize/buyIndexSearchQuery";
import type { JournalShopRecord } from "../../shared/colonize/journalShopHistory";
import type { MaterialBuyStationHit } from "../../shared/colonize/materialBuyIndexTypes";
import { isCommanderBuyOffer } from "../../shared/colonize/stationSellOffer";
import { isSurfaceStationLabel, isSurfaceStationType, normSystemName } from "../../shared/colonize/stationFilter";
import { sortMaterialBuyHitsBySearchDistance } from "../../shared/colonize/searchDistanceLy";
import { constructionHopLy, nearerLy, toLy, type Ly } from "../../shared/colonize/systemDistanceLy";
import { buyStationPlaceKey, mergeBuyStationHits } from "../../shared/colonize/buyStationMerge";
import { sortStationsByHop, sortSystemsByHop } from "../../shared/colonize/buyIndexSort";
import type { MaterialBuyIndex } from "./materialBuyIndex";

function stationKey(marketId: string, systemName: string, stationName: string): string {
  const mid = marketId?.trim();
  if (mid) return `m:${mid}`;
  return `s:${normSystemName(systemName)}:${stationName.trim().toLowerCase()}`;
}

function inferPlanetary(stationType: string | null | undefined, stationName?: string): boolean {
  return isSurfaceStationType(stationType, false, stationName) || isSurfaceStationLabel(stationName ?? "");
}


function offerMatches(
  commodityId: string,
  label: string,
  needId: string,
  needLabel: string,
): boolean {
  if (needId && commodityIdsEquivalent(commodityId, needId)) return true;
  return (
    commodityNeedMatchesLabel(needId, needLabel, label) ||
    commodityNeedMatchesLabel(needId, needLabel, commodityId)
  );
}

function shopSellsNeed(commodities: Map<string, string>, need: MaterialSearchNeed): boolean {
  for (const [cid, label] of commodities) {
    if (offerMatches(cid, label, need.needId, need.needLabel)) return true;
  }
  return false;
}

function shopSellsAllNeeds(commodities: Map<string, string>, needs: MaterialSearchNeed[]): boolean {
  return needs.every((need) => shopSellsNeed(commodities, need));
}

function journalStationFromRec(rec: JournalShopRecord, commodities: Map<string, string>): BuyIndexStationResult {
  return {
    systemName: rec.starSystem,
    stationName: rec.stationName,
    marketId: rec.marketId,
    bodyName: null,
    stationType: rec.stationType,
    isPlanetaryOrGround: inferPlanetary(rec.stationType, rec.stationName),
    materialCount: commodities.size,
    minDistanceLy: toLy(rec.constructionDistanceLy),
  };
}

function searchJournalStationsForMaterials(
  shops: JournalShopRecord[],
  query: string,
  systemName?: string,
): BuyIndexStationResult[] {
  const needs = materialNeedsFromQuery(query);
  if (!needs.length) return [];
  const sysNorm = systemName?.trim() ? normSystemName(systemName) : null;
  const stations = new Map<string, BuyIndexStationResult>();

  for (const rec of shops) {
    if (sysNorm && normSystemName(rec.starSystem) !== sysNorm) continue;
    const commodities = journalCommoditiesForShop(rec);
    if (!shopSellsAllNeeds(commodities, needs)) continue;
    const k = stationKey(rec.marketId, rec.starSystem, rec.stationName);
    const boughtCount = rec.purchases.filter((p) => needs.some((n) => commodityIdsEquivalent(p.commodityId, n.needId))).length;
    stations.set(k, { ...journalStationFromRec(rec, commodities), boughtCount, lastVisitIso: rec.visitedAt });
  }

  return [...stations.values()].sort(sortStationsByHop);
}

/** His own history first (owner, 2026-10-22): where he bought it, then where he docked, then the rest by distance. */
function sortStationsJournalFirst(a: BuyIndexStationResult, b: BuyIndexStationResult): number {
  const rank = (s: BuyIndexStationResult) => ((s.boughtCount ?? 0) > 0 ? 0 : s.lastVisitIso ? 1 : 2);
  return rank(a) - rank(b) || (b.boughtCount ?? 0) - (a.boughtCount ?? 0) || sortStationsByHop(a, b);
}

function searchJournalSystemsForMaterial(
  shops: JournalShopRecord[],
  query: string,
): BuyIndexSystemResult[] {
  const stations = searchJournalStationsForMaterials(shops, query);
  const label = formatMaterialSearchLabel(query);
  const systems = new Map<string, { stationKeys: Set<string>; minLy: Ly }>();

  for (const st of stations) {
    const sys = st.systemName.trim();
    if (!sys) continue;
    const sk = stationKey(st.marketId, st.systemName, st.stationName);
    let acc = systems.get(sys);
    if (!acc) {
      acc = { stationKeys: new Set(), minLy: null };
      systems.set(sys, acc);
    }
    acc.stationKeys.add(sk);
    acc.minLy = nearerLy(acc.minLy, st.minDistanceLy);
  }

  return [...systems.entries()]
    .map(([systemName, acc]) => ({
      systemName,
      stationCount: acc.stationKeys.size,
      minDistanceLy: acc.minLy,
      bestBuyPrice: null,
      resolvedLabel: label,
    }))
    .sort(sortSystemsByHop);
}

function systemMatchesQuery(systemName: string, query: string): boolean {
  const q = query.trim();
  if (!q) return false;
  const qNorm = normSystemName(q);
  const n = normSystemName(systemName);
  if (qNorm && n === qNorm) return true;
  if (qNorm && n.includes(qNorm)) return true;
  return systemName.toLowerCase().includes(q.toLowerCase());
}

function journalHitFromOffer(rec: JournalShopRecord, commodityId: string, label: string): MaterialBuyStationHit {
  const offer = rec.marketItems?.find(
    (o) => o.commodityId === commodityId || commodityIdsEquivalent(o.commodityId, commodityId),
  );
  const purchaseProven = rec.purchases.some(
    (p) => p.commodityId === commodityId || commodityIdsEquivalent(p.commodityId, commodityId),
  );
  return {
    systemName: rec.starSystem,
    stationName: rec.stationName,
    marketId: rec.marketId,
    distanceLy: toLy(rec.constructionDistanceLy),
    buyPrice: offer?.buyPrice ?? null,
    supply: offer?.supply ?? null,
    spanshCommodity: label,
    dataSource: "journal",
    stationType: rec.stationType,
    isPlanetaryOrGround: inferPlanetary(rec.stationType, rec.stationName),
    bodyName: null,
    foundAtIso: rec.visitedAt,
    purchaseProven,
  };
}

function journalMaterialHitsForNeed(
  shops: JournalShopRecord[],
  needId: string,
  needLabel: string,
): MaterialBuyStationHit[] {
  const out = new Map<string, MaterialBuyStationHit>();
  for (const rec of shops) {
    const commodities = journalCommoditiesForShop(rec);
    let matchedId: string | null = null;
    let matchedLabel = needLabel;
    for (const [cid, clabel] of commodities) {
      if (offerMatches(cid, clabel, needId, needLabel)) {
        matchedId = cid;
        matchedLabel = clabel;
        break;
      }
    }
    if (!matchedId) continue;
    const hit = journalHitFromOffer(rec, matchedId, matchedLabel);
    if (!buyStationHitMatchesNeed(needId, needLabel, hit)) continue;
    if (!isCommanderBuyOffer(hit.supply, hit.buyPrice) && !hit.purchaseProven) continue;
    const k = buyStationPlaceKey(hit);
    const prev = out.get(k);
    out.set(k, prev ? mergeBuyStationHits(prev, hit) : hit);
  }
  return [...out.values()];
}

/** Plan + Local: index + journal — same row scan as Search (no per-station catalog walk). */
export function materialBuyHitsForNeed(args: {
  index: MaterialBuyIndex;
  journalShops: JournalShopRecord[];
  needId: string;
  needLabel: string;
  distanceOrigin: string;
  distanceBySystem?: Record<string, number>;
  constructionDepots?: ConstructionDepotRef[];
}): MaterialBuyStationHit[] {
  const depots = args.constructionDepots ?? [];
  const distanceBySystem = args.distanceBySystem ?? {};
  const distRef = args.distanceOrigin.trim();
  const constructionRefs = distRef ? [distRef] : [];
  const byKey = new Map<string, MaterialBuyStationHit>();
  const searchQuery = planMaterialSearchQuery(args.needId, args.needLabel);

  const consider = (raw: MaterialBuyStationHit, lookup: MaterialSearchNeed) => {
    const proofOk =
      buyStationHitMatchesNeed(args.needId, args.needLabel, raw) ||
      buyStationHitMatchesNeed(lookup.needId, lookup.needLabel, raw);
    if (!proofOk) return;
    if (!isCommanderBuyOffer(raw.supply, raw.buyPrice) && !raw.purchaseProven) return;
    if (
      isConstructionDepotStation(depots, {
        systemName: raw.systemName,
        stationName: raw.stationName,
        marketId: raw.marketId,
      })
    ) {
      return;
    }
    const distanceLy =
      distRef && Object.keys(distanceBySystem).length
        ? constructionHopLy(distRef, raw.systemName, raw.distanceLy, distanceBySystem)
        : raw.distanceLy;
    const hit: MaterialBuyStationHit = distanceLy === raw.distanceLy ? raw : { ...raw, distanceLy };
    const k = buyStationPlaceKey(hit);
    const prev = byKey.get(k);
    byKey.set(k, prev ? mergeBuyStationHits(prev, hit) : hit);
  };

  const lookupKeys = new Set<string>();
  const tryLookup = (needId: string, needLabel: string) => {
    const lookup = resolveMaterialLookupNeed(needId, needLabel);
    const key = `${lookup.needId}\0${lookup.needLabel}`;
    if (lookupKeys.has(key)) return;
    lookupKeys.add(key);
    for (const h of args.index.getMaterialHitsForNeed(lookup.needId, lookup.needLabel)) consider(h, lookup);
    for (const h of journalMaterialHitsForNeed(args.journalShops, lookup.needId, lookup.needLabel)) {
      consider(h, lookup);
    }
  };

  tryLookup(args.needId, args.needLabel);
  tryLookup(args.needId, searchQuery);
  for (const part of materialNeedsFromQuery(searchQuery)) {
    tryLookup(part.needId, part.needLabel);
  }

  return sortMaterialBuyHitsBySearchDistance([...byKey.values()].map(withLocalStationFacts), constructionRefs, distanceBySystem);
}

function journalCommoditiesForShop(rec: JournalShopRecord): Map<string, string> {
  const out = new Map<string, string>();
  for (const o of rec.marketItems ?? []) {
    if (o.supply > 0 && o.buyPrice != null && o.buyPrice > 0) {
      out.set(o.commodityId, o.label);
    }
  }
  for (const p of rec.purchases) {
    if (p.count > 0 && !out.has(p.commodityId)) {
      out.set(p.commodityId, p.label);
    }
  }
  return out;
}

function mergeSystemResults(a: BuyIndexSystemResult[], b: BuyIndexSystemResult[]): BuyIndexSystemResult[] {
  const map = new Map<string, BuyIndexSystemResult>();
  for (const row of [...a, ...b]) {
    const prev = map.get(row.systemName);
    if (!prev) {
      map.set(row.systemName, row);
      continue;
    }
    map.set(row.systemName, {
      systemName: row.systemName,
      stationCount: Math.max(prev.stationCount, row.stationCount),
      minDistanceLy: nearerLy(prev.minDistanceLy, row.minDistanceLy),
      bestBuyPrice:
        prev.bestBuyPrice != null && row.bestBuyPrice != null
          ? Math.min(prev.bestBuyPrice, row.bestBuyPrice)
          : prev.bestBuyPrice ?? row.bestBuyPrice,
      resolvedLabel: prev.resolvedLabel || row.resolvedLabel,
    });
  }
  return [...map.values()].sort(sortSystemsByHop);
}

function mergeStationResults(a: BuyIndexStationResult[], b: BuyIndexStationResult[]): BuyIndexStationResult[] {
  const map = new Map<string, BuyIndexStationResult>();
  for (const row of [...a, ...b]) {
    const k = stationKey(row.marketId, row.systemName, row.stationName);
    const prev = map.get(k);
    if (!prev) {
      map.set(k, row);
      continue;
    }
    map.set(k, {
      ...prev,
      materialCount: Math.max(prev.materialCount, row.materialCount),
      minDistanceLy: nearerLy(prev.minDistanceLy, row.minDistanceLy),
      bodyName: prev.bodyName ?? row.bodyName,
      stationType: prev.stationType ?? row.stationType,
      isPlanetaryOrGround: prev.isPlanetaryOrGround || row.isPlanetaryOrGround,
      boughtCount: Math.max(prev.boughtCount ?? 0, row.boughtCount ?? 0) || undefined,
      lastVisitIso: [prev.lastVisitIso, row.lastVisitIso].filter(Boolean).sort().at(-1) ?? null,
    });
  }
  return [...map.values()].sort(sortStationsJournalFirst);
}

function searchJournalStationsInSystem(shops: JournalShopRecord[], systemQuery: string): BuyIndexStationResult[] {
  const stations = new Map<string, BuyIndexStationResult>();

  for (const rec of shops) {
    if (!systemMatchesQuery(rec.starSystem, systemQuery)) continue;
    const commodities = journalCommoditiesForShop(rec);
    if (!commodities.size) continue;
    const k = stationKey(rec.marketId, rec.starSystem, rec.stationName);
    stations.set(k, {
      systemName: rec.starSystem,
      stationName: rec.stationName,
      marketId: rec.marketId,
      bodyName: null,
      stationType: rec.stationType,
      isPlanetaryOrGround: inferPlanetary(rec.stationType, rec.stationName),
      materialCount: commodities.size,
      minDistanceLy: toLy(rec.constructionDistanceLy),
    });
  }

  return [...stations.values()].sort(sortStationsByHop);
}

function journalStationCatalog(
  shops: JournalShopRecord[],
  systemName: string,
  stationName: string,
  marketId?: string | null,
): BuyIndexStationMaterial[] {
  const sysNorm = normSystemName(systemName);
  const stNorm = stationName.trim().toLowerCase();
  const mid = marketId?.trim();
  const out = new Map<string, BuyIndexStationMaterial>();

  for (const rec of shops) {
    if (normSystemName(rec.starSystem) !== sysNorm) continue;
    if (mid && rec.marketId !== mid) continue;
    if (!mid && rec.stationName.trim().toLowerCase() !== stNorm) continue;

    for (const o of rec.marketItems ?? []) {
      if (!isCommanderBuyOffer(o.supply, o.buyPrice)) continue;
      const prev = out.get(o.commodityId);
      if (!prev || (o.buyPrice != null && (prev.buyPrice == null || o.buyPrice < prev.buyPrice))) {
        out.set(o.commodityId, {
          commodityId: o.commodityId,
          label: o.label,
          buyPrice: o.buyPrice,
          supply: o.supply,
          distanceLy: toLy(rec.constructionDistanceLy),
          hit: journalHitFromOffer(rec, o.commodityId, o.label),
        });
      }
    }
    for (const p of rec.purchases) {
      if (p.count <= 0 || out.has(p.commodityId)) continue;
      out.set(p.commodityId, {
        commodityId: p.commodityId,
        label: p.label,
        buyPrice: p.buyPrice,
        supply: null,
        distanceLy: toLy(rec.constructionDistanceLy),
        hit: journalHitFromOffer(rec, p.commodityId, p.label),
      });
    }
  }

  return [...out.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function mergeCatalog(a: BuyIndexStationMaterial[], b: BuyIndexStationMaterial[]): BuyIndexStationMaterial[] {
  const map = new Map<string, BuyIndexStationMaterial>();
  for (const row of [...a, ...b]) {
    const prev = map.get(row.commodityId);
    if (!prev) {
      map.set(row.commodityId, row);
      continue;
    }
    const useRow =
      row.buyPrice != null && (prev.buyPrice == null || row.buyPrice < prev.buyPrice) ? row : prev;
    const other = useRow === row ? prev : row;
    map.set(row.commodityId, {
      ...useRow,
      supply: useRow.supply ?? other.supply,
      distanceLy: nearerLy(useRow.distanceLy, other.distanceLy),
    });
  }
  return [...map.values()].sort((x, y) => x.label.localeCompare(y.label));
}

export function searchBuyIndexMaterial(
  index: MaterialBuyIndex,
  journalShops: JournalShopRecord[],
  query: string,
): BuyIndexSystemResult[] {
  return mergeSystemResults(
    index.searchSystemsForMaterial(query),
    searchJournalSystemsForMaterial(journalShops, query),
  );
}

export function searchBuyIndexStationsForMaterials(
  index: MaterialBuyIndex,
  journalShops: JournalShopRecord[],
  query: string,
  systemName?: string,
): BuyIndexStationResult[] {
  return mergeStationResults(
    index.searchStationsForMaterials(query, systemName),
    searchJournalStationsForMaterials(journalShops, query, systemName),
  );
}

export function searchBuyIndexMaterialStations(
  index: MaterialBuyIndex,
  journalShops: JournalShopRecord[],
  systemName: string,
  materialQuery: string,
): BuyIndexStationResult[] {
  return searchBuyIndexStationsForMaterials(index, journalShops, materialQuery, systemName);
}

export function searchBuyIndexSystem(
  index: MaterialBuyIndex,
  journalShops: JournalShopRecord[],
  query: string,
): BuyIndexStationResult[] {
  const merged = mergeStationResults(
    index.searchStationsInSystem(query),
    searchJournalStationsInSystem(journalShops, query),
  );
  return merged.sort((a, b) => a.stationName.localeCompare(b.stationName));
}

export function getBuyIndexStationCatalog(
  index: MaterialBuyIndex,
  journalShops: JournalShopRecord[],
  systemName: string,
  stationName: string,
  marketId?: string | null,
): BuyIndexStationMaterial[] {
  return mergeCatalog(
    index.getStationCatalog(systemName, stationName, marketId),
    journalStationCatalog(journalShops, systemName, stationName, marketId),
  );
}
