import { buyStationPlaceKey } from "../../shared/colonize/buyStationMerge";
import { parseMarketId } from "../../shared/colonize/marketId";
import { commodityNeedMatchesLabel } from "../../shared/colonize/commodityKey";
import type { MaterialBuyListing, MaterialBuyStationHit } from "../../shared/colonize/materialBuyIndexTypes";
import type { MaterialBuyIndex } from "./materialBuyIndex";
import type { CheckoutFilters, CheckoutOfferSource } from "../../shared/colonize/types";
import { isConstructionDepotStation } from "../../shared/colonize/constructionDepot";
import { isCommanderBuyOffer } from "../../shared/colonize/stationSellOffer";
import { normSystemName } from "../../shared/colonize/stationFilter";
import { constructionHopLy, lyOrLast, toLy } from "../../shared/colonize/systemDistanceLy";
import { assignNearestStationPerCommodity, orderHitsByDijkstraReach } from "../../shared/colonize/dijkstraStationReach";
import { normalizeSpanshMarketArray } from "./spanshStationBuySearch";
import type { NearestHit, SpanshBuyPayload, SpanshStationResult, Unified } from "./checkoutStationMap";
import {
  SPANSH_RESULTS_INGEST_MAX,
  buildStationsByNeedId,
  inferSpanshLabelFromPayload,
  isPlanetaryOrGroundInstallation,
  mergeStation,
  noteNearestHit,
  noteNearestHitsForNeeds,
  pseudoFromIndexedHit,
  spanshBodyName,
  stationSellsNeed,
} from "./checkoutStationMap";

const MATERIAL_LISTING_MAX = 40;

export function filterHitsForBuyIndex(
  hits: MaterialBuyStationHit[],
  depots: CheckoutFilters["constructionDepots"] = [],
): MaterialBuyStationHit[] {
  return hits.filter(
    (h) =>
      isCommanderBuyOffer(h.supply, h.buyPrice) &&
      !isConstructionDepotStation(depots ?? [], {
        systemName: h.systemName,
        stationName: h.stationName,
        marketId: h.marketId,
        stationType: h.stationType,
      }),
  );
}

function hitFromUnified(
  st: Unified,
  sell: { spansh: string; buyPrice: number | null; supply: number | null; source: CheckoutOfferSource },
  constructionRef?: string,
  distanceBySystem?: Record<string, number>,
): MaterialBuyStationHit {
  const distanceLy = constructionRef
    ? constructionHopLy(constructionRef, st.systemName, distanceBySystem)
    : toLy(st.distanceLy);
  return {
    systemName: st.systemName || "—",
    stationName: st.stationName || "—",
    marketId: st.marketId,
    distanceLy,
    buyPrice: sell.buyPrice,
    supply: sell.supply,
    spanshCommodity: sell.spansh,
    dataSource: sell.source,
    stationType: st.stationType,
    isPlanetaryOrGround: st.isPlanetaryOrGround,
    bodyName: st.bodyName,
    marketUpdatedAt: st.marketUpdatedAt,
    foundAtIso: new Date().toISOString(),
  };
}

export function hitsFromBuyPayload(
  referenceSystem: string,
  need: { id: string; label: string },
  buyPayload: SpanshBuyPayload,
  source: CheckoutOfferSource = "spansh",
  spanshLabel: string | null = null,
): MaterialBuyStationHit[] {
  const refNorm = normSystemName(referenceSystem);
  const now = new Date().toISOString();
  const hits: MaterialBuyStationHit[] = [];
  const commodityLabel =
    spanshLabel?.trim() || inferSpanshLabelFromPayload(buyPayload) || need.label.trim() || need.label;
  const results = Array.isArray(buyPayload.results) ? buyPayload.results : [];
  for (const r of results.slice(0, SPANSH_RESULTS_INGEST_MAX)) {
    const stationName = typeof r.name === "string" ? r.name : "";
    if (!stationName) continue;
    const normR: SpanshStationResult = { ...r, market: normalizeSpanshMarketArray(r.market) };
    const systemName = typeof normR.system_name === "string" ? normR.system_name : referenceSystem;
    const marketId = parseMarketId(normR.market_id) ?? "";
    let buyPrice: number | null = null;
    let supply: number | null = null;
    let spanshCommodity = commodityLabel;
    for (const row of normR.market ?? []) {
      const comm = typeof row.commodity === "string" ? row.commodity : "";
      if (!comm) continue;
      if (!commodityNeedMatchesLabel(need.id, need.label, comm)) continue;
      const sup = typeof row.supply === "number" ? row.supply : 0;
      if (sup <= 0) continue;
      spanshCommodity = comm;
      buyPrice = typeof row.buy_price === "number" ? row.buy_price : null;
      supply = sup;
      break;
    }
    if (!isCommanderBuyOffer(supply, buyPrice)) continue;
    hits.push({
      systemName: systemName || referenceSystem,
      stationName,
      marketId,
      distanceLy: null,
      buyPrice,
      supply,
      spanshCommodity,
      dataSource: source,
      stationType: typeof normR.type === "string" ? normR.type : null,
      isPlanetaryOrGround: isPlanetaryOrGroundInstallation(normR),
      bodyName: spanshBodyName(normR),
      marketUpdatedAt: typeof normR.market_updated_at === "string" ? normR.market_updated_at : null,
      foundAtIso: now,
    });
  }
  hits.sort((a, b) => {
    const aLocal = normSystemName(a.systemName) === refNorm ? 0 : 1;
    const bLocal = normSystemName(b.systemName) === refNorm ? 0 : 1;
    if (aLocal !== bLocal) return aLocal - bLocal;
    return lyOrLast(a.distanceLy) - lyOrLast(b.distanceLy);
  });
  return hits;
}

export function hydrateStationMapFromIndex(
  index: MaterialBuyIndex,
  referenceSystem: string,
  preNeeds: Array<{ id: string; label: string; quantityTons: number }>,
  stationByKey: Map<string, Unified>,
  nearestHitByNeed: Map<string, NearestHit>,
  constructionDepots: CheckoutFilters["constructionDepots"] = [],
): void {
  const hitsByCommodity = new Map<string, MaterialBuyStationHit[]>();
  for (const need of preNeeds) {
    if (!need.id) continue;
    const cached = index.getAllStationsForNeed(
      referenceSystem,
      need.id,
      need.label,
      {},
      referenceSystem,
      constructionDepots,
    );
    if (!cached.length) continue;
    hitsByCommodity.set(need.id, cached);
    for (const hit of cached) {
      if (isConstructionDepotHit(constructionDepots, hit)) continue;
      const k = buyStationPlaceKey(hit);
      stationByKey.set(
        k,
        mergeStation(
          stationByKey.get(k),
          pseudoFromIndexedHit(hit),
          hit.spanshCommodity,
          hit.dataSource,
          need.id,
        ),
      );
    }
  }

  const assigned = assignNearestStationPerCommodity({
    originSystem: referenceSystem,
    needs: preNeeds,
    hitsByCommodity,
  });
  for (const [needId, hit] of assigned) {
    noteNearestHit(
      nearestHitByNeed,
      needId,
      buyStationPlaceKey(hit),
      hit.spanshCommodity,
      hit.distanceLy,
      hit.dataSource,
    );
  }

  noteNearestHitsForNeeds(preNeeds, stationByKey, nearestHitByNeed);
}

export function persistStationHitsToIndex(
  index: MaterialBuyIndex,
  referenceSystem: string,
  preNeeds: Array<{ id: string; label: string }>,
  stationByKey: Map<string, Unified>,
  constructionDepots: CheckoutFilters["constructionDepots"] = [],
): void {
  const sellersByNeed = buildStationsByNeedId(stationByKey);
  for (const need of preNeeds) {
    if (!need.id) continue;
    const hits: MaterialBuyStationHit[] = [];
    for (const st of sellersByNeed.get(need.id) ?? []) {
      if (
        isConstructionDepotStation(constructionDepots ?? [], {
          systemName: st.systemName,
          stationName: st.stationName,
          marketId: st.marketId,
          stationType: st.stationType,
        })
      ) {
        continue;
      }
      const sell = stationSellsNeed(st, need);
      if (!sell || !isCommanderBuyOffer(sell.supply, sell.buyPrice)) continue;
      hits.push(hitFromUnified(st, sell));
    }
    const filtered = filterHitsForBuyIndex(hits, constructionDepots);
    if (filtered.length) index.mergeStations(referenceSystem, need.id, need.label, filtered);
  }
}

export function isConstructionDepotHit(
  depots: CheckoutFilters["constructionDepots"],
  hit: Pick<MaterialBuyStationHit, "systemName" | "stationName" | "marketId" | "stationType">,
): boolean {
  return Boolean(depots?.length && isConstructionDepotStation(depots, hit));
}

export function buildMaterialListings(
  index: MaterialBuyIndex | null,
  referenceSystem: string,
  preNeeds: Array<{ id: string; label: string; quantityTons: number }>,
  stationByKey: Map<string, Unified>,
  liveScannedIds: Set<string>,
  distanceBySystem: Record<string, number> = {},
  distanceOrigin?: string,
  constructionDepots: CheckoutFilters["constructionDepots"] = [],
  /** Hits already fetched with identical args — skips re-scanning the index per need. */
  precomputedIndexHits?: Map<string, MaterialBuyStationHit[]>,
): MaterialBuyListing[] {
  const distRef = distanceOrigin?.trim() || referenceSystem;
  const sellersByNeed = buildStationsByNeedId(stationByKey);
  const out: MaterialBuyListing[] = [];
  for (const need of preNeeds) {
    if (!need.id) continue;
    const byKey = new Map<string, MaterialBuyStationHit>();
    const addHit = (h: MaterialBuyStationHit) => {
      if (!isCommanderBuyOffer(h.supply, h.buyPrice)) return;
      const k = buyStationPlaceKey(h);
      const prev = byKey.get(k);
      if (!prev || lyOrLast(h.distanceLy) < lyOrLast(prev.distanceLy)) {
        byKey.set(k, h);
      } else if (!prev.bodyName?.trim() && h.bodyName?.trim()) {
        byKey.set(k, { ...prev, bodyName: h.bodyName });
      }
    };
    const indexHits = precomputedIndexHits
      ? precomputedIndexHits.get(need.id) ?? []
      : index?.getAllStationsForNeed(
          referenceSystem,
          need.id,
          need.label,
          distanceBySystem,
          distRef,
          constructionDepots,
        ) ?? [];
    for (const h of orderHitsByDijkstraReach(distRef, indexHits, distanceBySystem)) {
      if (!isConstructionDepotHit(constructionDepots, h)) addHit(h);
    }
    for (const st of sellersByNeed.get(need.id) ?? []) {
      if (
        isConstructionDepotStation(constructionDepots, {
          systemName: st.systemName,
          stationName: st.stationName,
          marketId: st.marketId,
        })
      ) {
        continue;
      }
      const sell = stationSellsNeed(st, need);
      if (!sell) continue;
      addHit(hitFromUnified(st, sell, distRef, distanceBySystem));
    }
    const stations = orderHitsByDijkstraReach(distRef, [...byKey.values()], distanceBySystem).slice(
      0,
      MATERIAL_LISTING_MAX,
    );
    if (!stations.length) continue;
    const servedFromCache =
      !liveScannedIds.has(need.id) &&
      (index?.hasCheckoutData(referenceSystem, need.id, need.label) ||
        index?.hasCheckoutDataAnyRef(need.id, need.label) ||
        false);
    out.push({
      id: need.id,
      label: need.label,
      quantityNeeded: need.quantityTons,
      servedFromCache,
      stations,
    });
  }
  return out;
}
