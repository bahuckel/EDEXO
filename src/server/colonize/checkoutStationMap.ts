import type { Ly } from "../../shared/colonize/systemDistanceLy";
import { parseMarketId } from "../../shared/colonize/marketId";
import {
  commodityLabelsEquivalent,
  commodityMergeBucket,
  commodityNeedMatchesLabel,
  commodityNormKey,
} from "../../shared/colonize/commodityKey";
import type { MaterialBuyStationHit } from "../../shared/colonize/materialBuyIndexTypes";
import type { CheckoutFilters, CheckoutOfferSource } from "../../shared/colonize/types";
import { spanshLabelKey } from "../../shared/colonize/spanshCommodity";
import {
  isSurfaceStationLabel,
  isSurfaceStationType,
  matchesDockedStation,
} from "../../shared/colonize/stationFilter";
import { compareLy, lyOrLast, nearerLy, toLy } from "../../shared/colonize/systemDistanceLy";
import { normalizeSpanshMarketArray } from "./spanshStationBuySearch";
import { isCommanderBuyOffer } from "../../shared/colonize/stationSellOffer";

export const SPANSH_RESULTS_INGEST_MAX = 80;

export type MarketRow = { commodity?: string; supply?: number; buy_price?: number };

export type SpanshStationResult = {
  name?: string;
  system_name?: string;
  system_id64?: string | number;
  market_id?: string | number;
  distance?: number;
  market?: MarketRow[];
  is_planetary?: boolean;
  type?: string;
  body_name?: string;
  market_updated_at?: string;
};

export function spanshBodyName(r: SpanshStationResult): string | null {
  const name = typeof r.body_name === "string" ? r.body_name.trim() : "";
  return name || null;
}

export type SpanshBuyPayload = {
  count?: number;
  results?: SpanshStationResult[];
};

export function inferSpanshLabelFromPayload(buyPayload: SpanshBuyPayload): string | null {
  const results = Array.isArray(buyPayload.results) ? buyPayload.results : [];
  for (const st of results) {
    for (const row of normalizeSpanshMarketArray(st.market)) {
      const comm = typeof row.commodity === "string" ? row.commodity : "";
      if (comm && (row.supply ?? 0) > 0) return comm;
    }
  }
  return null;
}

export function stationKey(r: SpanshStationResult): string {
  const mid = parseMarketId(r.market_id);
  if (mid) return `m:${mid}`;
  const sys = r.system_id64;
  return `s:${sys != null ? String(sys) : "?"}:${String(r.name ?? "")}`;
}

export function marketRowForCommodity(
  market: MarketRow[] | undefined,
  spanshCommodity: string,
  minQty: number,
  minSupplyFilter: number | null,
  need?: { id: string; label: string },
): { buyPrice: number | null; supply: number | null } | null {
  if (!Array.isArray(market)) return null;
  for (const row of market) {
    const comm = typeof row.commodity === "string" ? row.commodity : "";
    if (!comm) continue;
    const matches = need
      ? commodityNeedMatchesLabel(need.id, need.label, comm)
      : commodityLabelsEquivalent(comm, spanshCommodity);
    if (!matches) continue;
    const sup = typeof row.supply === "number" ? row.supply : 0;
    const minSup = Math.max(minQty, minSupplyFilter ?? 0);
    if (sup < minSup) continue;
    const buyPrice = typeof row.buy_price === "number" ? row.buy_price : null;
    if (!isCommanderBuyOffer(sup, buyPrice)) continue;
    return { buyPrice, supply: sup };
  }
  return null;
}

export function stationHasProvenCommodity(st: Unified, spanshCommodity: string): boolean {
  if (st.provenSpansh.has(spanshCommodity)) return true;
  for (const p of st.provenSpansh) {
    if (commodityLabelsEquivalent(p, spanshCommodity)) return true;
  }
  return false;
}

/** Station sells this need (full merged market / index buckets — not just one commodity row). */
export function stationRowCompatibleWithCommodity(
  st: Unified,
  spanshCommodity: string,
  minQty: number,
  minSupplyFilter: number | null,
  need: { id: string; label: string },
): boolean {
  const sell = stationSellsNeed(st, need, spanshCommodity);
  if (!sell) return false;
  if (
    minSupplyFilter != null &&
    minSupplyFilter > 0 &&
    sell.supply != null &&
    sell.supply < minSupplyFilter
  ) {
    return false;
  }
  if (sell.supply != null && sell.supply > 0 && sell.supply < minQty) return false;
  return true;
}

function mergeMarketRows(a: MarketRow[] | undefined, b: MarketRow[] | undefined): MarketRow[] {
  const byKey = new Map<string, MarketRow>();
  for (const row of [...(a ?? []), ...(b ?? [])]) {
    const comm = typeof row.commodity === "string" ? row.commodity : "";
    if (!comm) continue;
    const key = spanshLabelKey(comm);
    const prev = byKey.get(key);
    const sup = typeof row.supply === "number" ? row.supply : 0;
    const prevSup = typeof prev?.supply === "number" ? prev.supply : 0;
    if (!prev || sup > prevSup) byKey.set(key, row);
  }
  return [...byKey.values()];
}

export function pseudoFromIndexedHit(hit: MaterialBuyStationHit): SpanshStationResult {
  return {
    name: hit.stationName,
    system_name: hit.systemName,
    market_id: hit.marketId,
    distance: hit.distanceLy ?? undefined,
    type: hit.stationType ?? undefined,
    body_name: hit.bodyName ?? undefined,
    market: [
      { commodity: hit.spanshCommodity, supply: hit.supply ?? 0, buy_price: hit.buyPrice ?? undefined },
    ],
  };
}

export function buildStationsByNeedId(stationByKey: Map<string, Unified>): Map<string, Unified[]> {
  const out = new Map<string, Unified[]>();
  for (const st of stationByKey.values()) {
    for (const needId of st.needBuckets) {
      const list = out.get(needId) ?? [];
      list.push(st);
      out.set(needId, list);
    }
  }
  return out;
}

export function noteNearestHitsForNeeds(
  preNeeds: Array<{ id: string; label: string }>,
  stationByKey: Map<string, Unified>,
  nearestHitByNeed: Map<string, NearestHit>,
): void {
  const sellersByNeed = buildStationsByNeedId(stationByKey);
  for (const need of preNeeds) {
    if (!need.id || nearestHitByNeed.has(need.id)) continue;
    let bestKey: string | null = null;
    let bestSell: {
      spansh: string;
      buyPrice: number | null;
      supply: number | null;
      source: CheckoutOfferSource;
    } | null = null;
    let bestDist: Ly = null;
    const candidates = sellersByNeed.get(need.id) ?? [];
    for (const st of candidates) {
      const sell = stationSellsNeed(st, need);
      if (!sell || sell.supply == null || sell.supply <= 0) continue;
      // compareLy, not a strict < against Infinity: an unknown-distance seller must still count.
      if (bestKey == null || compareLy(st.distanceLy, bestDist) < 0) {
        bestDist = st.distanceLy;
        bestKey = st.key;
        bestSell = sell;
      }
    }
    if (bestKey && bestSell) {
      noteNearestHit(nearestHitByNeed, need.id, bestKey, bestSell.spansh, bestDist, bestSell.source);
    }
  }
}

export function isPlanetaryOrGroundInstallation(r: SpanshStationResult): boolean {
  const t = typeof r.type === "string" ? r.type.trim() : "";
  const name = typeof r.name === "string" ? r.name : "";
  return isSurfaceStationType(t || null, r.is_planetary === true, name) || isSurfaceStationLabel(name);
}

export function isKnownShopStation(
  filters: CheckoutFilters,
  systemName: string,
  stationName: string,
): boolean {
  if (matchesDockedStation({ systemName, stationName }, filters.dockedStation)) return true;
  return (filters.knownShopStations ?? []).some((s) => matchesDockedStation({ systemName, stationName }, s));
}

export type Unified = {
  key: string;
  systemName: string;
  stationName: string;
  distanceLy: Ly;
  marketId: string;
  market: MarketRow[];
  provenSpansh: Set<string>;
  needBuckets: Set<string>;
  commoditySources: Map<string, CheckoutOfferSource>;
  isPlanetaryOrGround: boolean;
  stationType: string | null;
  bodyName: string | null;
  marketUpdatedAt: string | null;
};

export type NearestHit = {
  stationKey: string;
  spansh: string;
  distanceLy: Ly;
  source: CheckoutOfferSource;
};

export function noteNearestHit(
  map: Map<string, NearestHit>,
  needId: string,
  stationKeyStr: string,
  spansh: string,
  distanceLy: Ly | undefined,
  source: CheckoutOfferSource,
): void {
  if (!needId || !stationKeyStr) return;
  const d = toLy(distanceLy);
  const prev = map.get(needId);
  if (!prev || lyOrLast(d) < lyOrLast(prev.distanceLy)) {
    map.set(needId, { stationKey: stationKeyStr, spansh, distanceLy: d, source });
  }
}

export function mergeStation(
  u: Unified | undefined,
  r: SpanshStationResult,
  spanshCommodity: string,
  source: CheckoutOfferSource = "spansh",
  needId?: string,
): Unified {
  const market = normalizeSpanshMarketArray(r.market);
  const stationName = typeof r.name === "string" ? r.name : "";
  const systemName = typeof r.system_name === "string" ? r.system_name : "";
  const dist = toLy(r.distance);
  const marketId = parseMarketId(r.market_id) ?? "";
  const stType = typeof r.type === "string" && r.type.trim() ? r.type.trim() : null;
  const pOrG = isPlanetaryOrGroundInstallation(r);
  const bodyName = spanshBodyName(r);
  const mUp = typeof r.market_updated_at === "string" ? r.market_updated_at : null;
  const provenSpansh = u ? new Set(u.provenSpansh) : new Set<string>();
  provenSpansh.add(spanshCommodity);
  const needBuckets = u ? new Set(u.needBuckets) : new Set<string>();
  if (needId) {
    needBuckets.add(needId);
    const canon = commodityMergeBucket(needId) || commodityNormKey(needId);
    if (canon) needBuckets.add(canon);
  }
  const commoditySources = u ? new Map(u.commoditySources) : new Map<string, CheckoutOfferSource>();
  const rank: Record<CheckoutOfferSource, number> = { journal: 4, edsm: 3, spansh: 2, inara: 1 };
  const prev = commoditySources.get(spanshCommodity);
  if (!prev || rank[source] >= rank[prev]) commoditySources.set(spanshCommodity, source);

  if (!u) {
    return {
      key: stationKey(r),
      systemName,
      stationName,
      distanceLy: dist,
      marketId,
      market,
      provenSpansh,
      needBuckets,
      commoditySources,
      isPlanetaryOrGround: pOrG,
      stationType: stType,
      bodyName,
      marketUpdatedAt: mUp,
    };
  }
  return {
    ...u,
    systemName: u.systemName || systemName,
    stationName: u.stationName || stationName,
    distanceLy: nearerLy(u.distanceLy, dist),
    marketId: u.marketId || marketId,
    market: mergeMarketRows(u.market, market),
    provenSpansh,
    needBuckets,
    commoditySources,
    isPlanetaryOrGround: u.isPlanetaryOrGround || pOrG,
    stationType: u.stationType ?? stType,
    bodyName: u.bodyName ?? bodyName,
    marketUpdatedAt: u.marketUpdatedAt ?? mUp,
  };
}

function marketRowMatchesNeed(need: { id: string; label: string }, commodity: string): boolean {
  return commodityNeedMatchesLabel(need.id, need.label, commodity);
}

export function stationSellsNeed(
  st: Unified,
  need: { id: string; label: string },
  forcedSpansh?: string,
): { spansh: string; buyPrice: number | null; supply: number | null; source: CheckoutOfferSource } | null {
  const needCanon = commodityMergeBucket(need.id) || commodityNormKey(need.id);
  if (st.needBuckets.has(need.id) || (needCanon && st.needBuckets.has(needCanon))) {
    const sp = forcedSpansh ?? [...st.provenSpansh].find((k) => marketRowMatchesNeed(need, k));
    if (sp) {
      const offer = marketRowForCommodity(st.market, sp, 1, null, need);
      const source = st.commoditySources.get(sp) ?? "spansh";
      if (offer && isCommanderBuyOffer(offer.supply, offer.buyPrice)) {
        return { spansh: sp, buyPrice: offer.buyPrice, supply: offer.supply, source };
      }
    }
  }
  if (Array.isArray(st.market)) {
    for (const row of st.market) {
      const comm = typeof row.commodity === "string" ? row.commodity : "";
      if (!comm || !marketRowMatchesNeed(need, comm)) continue;
      const sup = typeof row.supply === "number" ? row.supply : 0;
      if (sup <= 0) continue;
      const buyPrice = typeof row.buy_price === "number" ? row.buy_price : null;
      if (!isCommanderBuyOffer(sup, buyPrice)) continue;
      const source =
        st.commoditySources.get(comm) ?? st.commoditySources.get(spanshLabelKey(comm)) ?? "spansh";
      return { spansh: comm, buyPrice, supply: sup, source };
    }
  }
  for (const sp of st.provenSpansh) {
    if (!marketRowMatchesNeed(need, sp)) continue;
    const offer = marketRowForCommodity(st.market, sp, 1, null, need);
    if (offer && offer.supply != null && offer.supply > 0) {
      return {
        spansh: sp,
        buyPrice: offer.buyPrice,
        supply: offer.supply,
        source: st.commoditySources.get(sp) ?? "spansh",
      };
    }
  }
  return null;
}
