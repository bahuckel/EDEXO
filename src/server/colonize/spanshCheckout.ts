import { buyStationPlaceKey } from "../../shared/colonize/buyStationMerge";
import { parseMarketId } from "../../shared/colonize/marketId";
import { TtlCache } from "../../shared/colonize/ttlCache";
import { mapPool } from "../../shared/colonize/mapPool";
import { commodityMergeBucket, commodityNormKey } from "../../shared/colonize/commodityKey";
import type { MaterialBuyStationHit } from "../../shared/colonize/materialBuyIndexTypes";
import { spanshPrimaryStationSearchFilters } from "../../shared/colonize/spanshCommodity";
import { MATERIAL_BUY_CACHE_TTL_MS, MaterialBuyIndex } from "./materialBuyIndex";
import type {
  BasketCheckoutBundle,
  BasketCheckoutItem,
  BasketCheckoutResult,
  CheckoutFilters,
  CheckoutRoutingMode,
  CheckoutStationGroup,
} from "../../shared/colonize/types";
import { hasBuyStationWithinLy } from "../../shared/colonize/buyStationNearby";
import { isConstructionDepotStation } from "../../shared/colonize/constructionDepot";
import { tryCheckoutFromMarketJson } from "./localMarketCheckout";
import { exhaustiveEdsmBuySearch } from "./edsmMarket";
import {
  resolveSpanshReferenceSystem,
  resolveSpanshReferenceSystemLocal,
  resolveSystemDistanceMap,
} from "./galaxySystemCoords";
import { constructionHopLy } from "../../shared/colonize/systemDistanceLy";

import {
  normalizeSpanshMarketArray,
  pickSpanshCommodityFromSearchResults,
  searchSpanshBuyStations,
  spanshSearchToBuyPayload,
} from "./spanshStationBuySearch";
import { assignNearestStationPerCommodity } from "../../shared/colonize/dijkstraStationReach";
import { enrichHitsWithBodyNames, enrichRecordsWithBodyNames } from "./spanshStationBody";
import { stationMarketSellsNeed } from "../../shared/colonize/stationSellOffer";
import type { MarketRow, NearestHit, SpanshBuyPayload, SpanshStationResult, Unified } from "./checkoutStationMap";
import {
  SPANSH_RESULTS_INGEST_MAX,
  inferSpanshLabelFromPayload,
  isKnownShopStation,
  mergeStation,
  noteNearestHit,
  noteNearestHitsForNeeds,
  pseudoFromIndexedHit,
  stationKey,
  stationSellsNeed,
} from "./checkoutStationMap";
import type { NeedRow } from "./checkoutRouting";
import {
  appendNearestStopsForMissing,
  buildCatalogFromStationMap,
  buildNearestStopPerItem,
  routeStations,
} from "./checkoutRouting";
import {
  enrichKnownShopDistances,
  enrichStationMapFromDockMarket,
  injectShopMarketSnapshots,
} from "./checkoutEnrich";
import {
  buildMaterialListings,
  filterHitsForBuyIndex,
  hitsFromBuyPayload,
  hydrateStationMapFromIndex,
  isConstructionDepotHit,
  persistStationHitsToIndex,
} from "./checkoutIndexBridge";

const RESOLVE_COMMODITY_CONCURRENCY = 2;

const EDSM_CHECKOUT_MARKET_BUDGET = 48;

const CHECKOUT_MEMO_TTL_MS = 30 * 60 * 1000;

const CHECKOUT_MEMO_MAX = 32;

const checkoutMemo = new TtlCache<string, BasketCheckoutResult>({
  max: CHECKOUT_MEMO_MAX,
  ttlMs: CHECKOUT_MEMO_TTL_MS,
});

const DEFAULT_FILTERS: CheckoutFilters = {
  includePlanetaryAndGround: false,
  maxDistanceLy: null,
  minSupply: null,
  largePadOnly: false,
  minLandingPad: "any",
  stationKind: "any",
  excludeFleetCarriers: false,
  constructionSystems: [],
};

function filtersForMemo(filters: CheckoutFilters): Omit<CheckoutFilters, "shopMarketSnapshots" | "knownShopStations"> {
  const { shopMarketSnapshots: _s, knownShopStations: _k, ...rest } = filters;
  return rest;
}

function memoKeyCheckout(args: {
  referenceSystem: string;
  /** Distances are measured from the construction site, which two depots can differ on. */
  distanceRef: string;
  constructionSiteSystem: string;
  filters: CheckoutFilters;
  routingMode: CheckoutRoutingMode;
  journalDir: string | null;
  items: BasketCheckoutItem[];
  cacheOnly: boolean;
  forceLiveScan: boolean;
  /** Buy-index merge generation — a scan that lands new stations must not hit a stale memo. */
  indexGen: number;
}): string {
  const ids = args.items
    .map((i) => `${i.id || commodityMergeBucket(i.name) || i.name}:${Math.max(1, Math.ceil(i.quantityTons || 1))}`)
    .sort();
  return JSON.stringify({
    ref: args.referenceSystem.trim().toLowerCase(),
    dref: args.distanceRef.trim().toLowerCase(),
    site: args.constructionSiteSystem.trim().toLowerCase(),
    f: filtersForMemo(args.filters),
    mode: args.routingMode,
    j: args.journalDir?.trim() ?? "",
    ids,
    co: args.cacheOnly,
    fls: args.forceLiveScan,
    gen: args.indexGen,
  });
}

function spanshSearchHitCount(search: { count?: number; results?: unknown[] } | null): number {
  if (!search) return 0;
  if (typeof search.count === "number" && search.count > 0) return search.count;
  return Array.isArray(search.results) ? search.results.length : 0;
}

async function resolveSpanshCommodityName(
  referenceSystem: string,
  id: string,
  name: string,
  nameLocalised: string,
): Promise<{ spansh: string | null; tried: string[]; buyPayload: SpanshBuyPayload | null }> {
  const tried: string[] = [];

  for (const filter of spanshPrimaryStationSearchFilters(name, nameLocalised, id)) {
    tried.push(`search:${filter.field}:${filter.value}`);
    const search = await searchSpanshBuyStations({
      referenceSystem,
      commodityFilterName: filter.value,
      commodityFilterField: filter.field,
    });
    if (spanshSearchHitCount(search) <= 0) continue;
    const spansh =
      pickSpanshCommodityFromSearchResults(search!, filter.value) ??
      (filter.field === "name" ? filter.value : null) ??
      search!.results?.[0]?.market?.find((m) => (m.supply ?? 0) > 0)?.commodity ??
      null;
    return {
      spansh,
      tried,
      buyPayload: spanshSearchToBuyPayload(search!) as SpanshBuyPayload,
    };
  }

  return { spansh: null, tried, buyPayload: null };
}

function needHasBuySeller(
  need: { id: string; label: string },
  stationByKey: Map<string, Unified>,
  nearestHitByNeed: Map<string, NearestHit>,
): boolean {
  const recorded = nearestHitByNeed.get(need.id);
  if (recorded) {
    const st = stationByKey.get(recorded.stationKey);
    if (st && stationSellsNeed(st, need, recorded.spansh)) return true;
  }
  for (const st of stationByKey.values()) {
    if (stationSellsNeed(st, need)) return true;
  }
  return false;
}

function ingestSpanshBuyResults(
  spanshResolved: Array<{
    id: string;
    label: string;
    spansh: string;
    buyPayload: SpanshBuyPayload | null;
  }>,
  stationByKey: Map<string, Unified>,
  nearestHitByNeed: Map<string, NearestHit>,
  searchFilters: CheckoutFilters,
  filters: CheckoutFilters,
): void {
  for (const row of spanshResolved) {
    if (!row.buyPayload || !row.id) continue;
    const results = Array.isArray(row.buyPayload.results) ? row.buyPayload.results.slice(0, SPANSH_RESULTS_INGEST_MAX) : [];
    let nearestRecorded = false;
    for (const r of results) {
      const normR: SpanshStationResult = { ...r, market: normalizeSpanshMarketArray(r.market) };
      if (!passesBuyGatherFilters(normR, searchFilters)) continue;
      if (!stationMarketSellsNeed(normR.market, { id: row.id, label: row.label }, row.spansh)) continue;
      const k = stationKey(normR);
      if (!nearestRecorded) {
        noteNearestHit(
          nearestHitByNeed,
          row.id,
          k,
          row.spansh,
          typeof normR.distance === "number" ? normR.distance : undefined,
          "spansh",
        );
        nearestRecorded = true;
      }
      stationByKey.set(k, mergeStation(stationByKey.get(k), normR, row.spansh, "spansh", row.id));
    }
    for (const r of results) {
      const normR: SpanshStationResult = { ...r, market: normalizeSpanshMarketArray(r.market) };
      if (!passesBuyGatherFilters(normR, searchFilters)) continue;
      if (!stationMarketSellsNeed(normR.market, { id: row.id, label: row.label }, row.spansh)) continue;
      const systemName = typeof normR.system_name === "string" ? normR.system_name : "";
      const stationName = typeof normR.name === "string" ? normR.name : "";
      if (!isKnownShopStation(filters, systemName, stationName)) continue;
      const k = stationKey(normR);
      stationByKey.set(k, mergeStation(stationByKey.get(k), normR, row.spansh, "spansh", row.id));
    }
  }
}

function stationResultDepotArgs(r: SpanshStationResult): {
  systemName: string;
  stationName: string;
  marketId: string;
  stationType: string | null;
} {
  return {
    systemName: typeof r.system_name === "string" ? r.system_name : "",
    stationName: typeof r.name === "string" ? r.name : "",
    marketId: parseMarketId(r.market_id) ?? "",
    stationType: typeof r.type === "string" ? r.type : null,
  };
}

/** Buy gather: only exclude construction depots — not pad/fleet/surface user prefs. */
function passesBuyGatherFilters(r: SpanshStationResult, filters: CheckoutFilters): boolean {
  const args = stationResultDepotArgs(r);
  if (!args.stationName.trim()) return false;
  return !isConstructionDepotStation(filters.constructionDepots ?? [], args);
}

/** Background / warmup: one commodity Spansh scan → persist all station hits. */
export async function scanAndPersistMaterialHits(args: {
  index: MaterialBuyIndex;
  referenceSystem: string;
  item: BasketCheckoutItem;
  constructionDepots?: CheckoutFilters["constructionDepots"];
}): Promise<number> {
  const id =
    args.item.id ||
    commodityMergeBucket(args.item.name) ||
    commodityMergeBucket(args.item.nameLocalised) ||
    commodityNormKey(args.item.name);
  const label = (args.item.nameLocalised || args.item.name).trim() || args.item.name;
  if (!id) return 0;
  const { spansh, buyPayload } = await resolveSpanshCommodityName(
    args.referenceSystem,
    id,
    args.item.name,
    args.item.nameLocalised,
  );
  if (!buyPayload || spanshSearchHitCount(buyPayload) <= 0) return 0;
  let hits = hitsFromBuyPayload(args.referenceSystem, { id, label }, buyPayload, "spansh", spansh);
  hits = await enrichHitsWithBodyNames(hits, 5);
  hits = filterHitsForBuyIndex(hits, args.constructionDepots);
  if (hits.length) args.index.mergeStations(args.referenceSystem, id, label, hits);
  return hits.length;
}

const CHECKOUT_YIELD_EVERY = 10;

async function yieldMainThread(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function buildCacheOnlyCheckoutResult(args: {
  ref: string;
  distanceRef: string;
  preNeeds: Array<{ id: string; label: string; quantityTons: number }>;
  index: MaterialBuyIndex;
  filters: CheckoutFilters;
  searchFilters: CheckoutFilters;
  routingMode: CheckoutRoutingMode;
  depotLabel: string | null;
  journalDir: string | null;
  uniqueItems: BasketCheckoutItem[];
  constructionSiteSystem: string;
}): Promise<BasketCheckoutResult> {
  const stationByKey = new Map<string, Unified>();
  const nearestHitByNeed = new Map<string, NearestHit>();
  const triedById = new Map<string, string[]>();

  let processed = 0;
  for (const need of args.preNeeds) {
    if (!need.id) continue;
    const cached = args.index.getAllStationsForNeed(
      args.ref,
      need.id,
      need.label,
      {},
      args.distanceRef,
      args.filters.constructionDepots,
    );
    if (!cached.length) continue;
    for (const hit of cached) {
      if (isConstructionDepotHit(args.filters.constructionDepots, hit)) continue;
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
    const assigned = assignNearestStationPerCommodity({
      originSystem: args.ref,
      needs: [need],
      hitsByCommodity: new Map([[need.id, cached]]),
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
    processed += 1;
    if (processed % CHECKOUT_YIELD_EVERY === 0) await yieldMainThread();
  }
  noteNearestHitsForNeeds(args.preNeeds, stationByKey, nearestHitByNeed);

  const resolved: NeedRow[] = [];
  for (const need of args.preNeeds) {
    if (!need.id) continue;
    const recorded = nearestHitByNeed.get(need.id);
    if (recorded) {
      resolved.push({
        id: need.id,
        label: need.label,
        spansh: recorded.spansh,
        quantityTons: need.quantityTons,
      });
      continue;
    }
    for (const st of stationByKey.values()) {
      const sell = stationSellsNeed(st, need);
      if (!sell) continue;
      resolved.push({
        id: need.id,
        label: need.label,
        spansh: sell.spansh,
        quantityTons: need.quantityTons,
      });
      break;
    }
  }

  if (args.journalDir) {
    await enrichStationMapFromDockMarket(args.journalDir, stationByKey, resolved, args.searchFilters);
  }

  const sellerSystems = [
    ...new Set(
      [...stationByKey.values()]
        .map((st) => st.systemName.trim())
        .filter(Boolean),
    ),
  ];
  const distanceMap = await resolveSystemDistanceMap([args.distanceRef], sellerSystems);
  for (const st of stationByKey.values()) {
    st.distanceLy = constructionHopLy(args.distanceRef, st.systemName, st.distanceLy, distanceMap);
  }

  const hitsByCommodity = new Map<string, MaterialBuyStationHit[]>();
  processed = 0;
  for (const need of args.preNeeds) {
    if (!need.id) continue;
    const hits = args.index.getAllStationsForNeed(
      args.ref,
      need.id,
      need.label,
      distanceMap,
      args.distanceRef,
      args.filters.constructionDepots,
    );
    if (hits.length) hitsByCommodity.set(need.id, hits);
    processed += 1;
    if (processed % CHECKOUT_YIELD_EVERY === 0) await yieldMainThread();
  }
  const reassigned = assignNearestStationPerCommodity({
    originSystem: args.distanceRef,
    needs: args.preNeeds,
    hitsByCommodity,
    distanceBySystem: distanceMap,
  });
  for (const [needId, hit] of reassigned) {
    noteNearestHit(
      nearestHitByNeed,
      needId,
      buyStationPlaceKey(hit),
      hit.spanshCommodity,
      hit.distanceLy,
      hit.dataSource,
    );
  }

  await yieldMainThread();
  const materialListings = buildMaterialListings(
    args.index,
    args.ref,
    args.preNeeds,
    stationByKey,
    new Set(),
    distanceMap,
    args.distanceRef,
    args.filters.constructionDepots,
    hitsByCommodity,
  );
  const { groups, unresolved } = buildNearestStopPerItem(
    stationByKey,
    args.preNeeds,
    args.filters,
    triedById,
    nearestHitByNeed,
  );
  const listedIds = new Set(materialListings.map((m) => m.id));

  return {
    referenceSystem: args.ref,
    groups,
    catalogStations: buildCatalogFromStationMap(stationByKey, resolved, args.searchFilters),
    materialListings,
    unresolved: unresolved.filter((u) => !listedIds.has(u.id)),
    dataSource: "spansh",
    routingMode: args.routingMode,
    depotLabel: args.depotLabel,
    /**
     * The live path reports this and the renderer measures against it. Omitting it here left
     * every cache-only checkout — which is the default — without a site to measure from.
     */
    constructionSiteSystem: args.constructionSiteSystem,
  };
}

function dedupeBasketItems(items: BasketCheckoutItem[]): BasketCheckoutItem[] {
  const acc = new Map<string, BasketCheckoutItem>();
  for (const it of items) {
    const b =
      it.id ||
      commodityMergeBucket(it.name) ||
      commodityMergeBucket(it.nameLocalised) ||
      commodityNormKey(it.name);
    if (!b) continue;
    const qty = Math.max(1, Math.ceil(it.quantityTons || 1));
    const cur = acc.get(b);
    if (!cur) acc.set(b, { ...it, id: b, quantityTons: qty });
    else cur.quantityTons = Math.max(cur.quantityTons, qty);
  }
  return [...acc.values()];
}

export async function runBasketCheckout(args: {
  referenceSystem: string;
  items: BasketCheckoutItem[];
  journalDir?: string | null;
  filters?: Partial<CheckoutFilters>;
  routingMode?: CheckoutRoutingMode;
  depotLabel?: string | null;
  /** Journal construction star for 3D Ly (defaults to referenceSystem). */
  constructionSiteSystem?: string | null;
  /** Bypass checkout memo + Spansh buy-list cache (live planner scans). */
  skipCache?: boolean;
  materialIndex?: MaterialBuyIndex;
  /** Force live Spansh even when index rows are fresh. */
  forceLiveScan?: boolean;
  /** Serve from buy index only — no live Spansh/EDSM (instant UI). */
  cacheOnly?: boolean;
}): Promise<BasketCheckoutResult> {
  const filters: CheckoutFilters = { ...DEFAULT_FILTERS, ...args.filters };
  const routingMode = args.routingMode ?? "fewest_stops";
  const journalDir = args.journalDir?.trim() ? args.journalDir.trim() : null;
  const refInput = args.referenceSystem.trim();
  const siteInput = (args.constructionSiteSystem?.trim() || refInput).trim();
  const cacheOnly = args.cacheOnly === true;
  const ref = refInput
    ? cacheOnly
      ? resolveSpanshReferenceSystemLocal(refInput)
      : await resolveSpanshReferenceSystem(refInput)
    : "";
  const distanceRef = siteInput
    ? cacheOnly
      ? resolveSpanshReferenceSystemLocal(siteInput)
      : await resolveSpanshReferenceSystem(siteInput)
    : ref;
  const uniqueItems = dedupeBasketItems(args.items);
  const skipMemo = args.skipCache === true;

  const mk = memoKeyCheckout({
    referenceSystem: ref,
    distanceRef,
    constructionSiteSystem: siteInput,
    filters,
    routingMode,
    journalDir,
    items: uniqueItems,
    cacheOnly,
    forceLiveScan: args.forceLiveScan === true,
    indexGen: args.materialIndex?.mergeGeneration() ?? 0,
  });
  if (!skipMemo) {
    const memHit = checkoutMemo.get(mk);
    if (memHit) return memHit;
  }

  if (uniqueItems.length === 0) {
    return { referenceSystem: ref, groups: [], unresolved: [], dataSource: "edsm", routingMode, depotLabel: args.depotLabel ?? null };
  }

  const preNeeds = uniqueItems.map((it) => ({
    id:
      it.id ||
      commodityMergeBucket(it.name) ||
      commodityMergeBucket(it.nameLocalised) ||
      commodityNormKey(it.name),
    label: (it.nameLocalised || it.name).trim() || it.name,
    quantityTons: it.quantityTons,
  }));

  const index = args.materialIndex ?? null;
  if (index) {
    await index.load();
    index.sanitizeSellHits();
    if (filters.constructionDepots?.length) index.purgeConstructionDepotStations(filters.constructionDepots);
  }

  const searchFilters: CheckoutFilters = {
    ...filters,
    includePlanetaryAndGround: true,
    maxDistanceLy: null,
    minSupply: null,
    largePadOnly: false,
    minLandingPad: "any",
    stationKind: "any",
    excludeFleetCarriers: false,
  };

  if (cacheOnly && index && ref) {
    const fast = await buildCacheOnlyCheckoutResult({
      ref,
      distanceRef,
      preNeeds,
      index,
      filters,
      searchFilters,
      routingMode,
      depotLabel: args.depotLabel ?? null,
      journalDir,
      uniqueItems,
      constructionSiteSystem: siteInput || ref,
    });
    return fast;
  }

  const indexCoversBasket =
    Boolean(ref) &&
    preNeeds.length > 0 &&
    preNeeds.every(
      (need) => Boolean(need.id) && (index?.hasCheckoutDataAnyRef(need.id, need.label) ?? false),
    );

  if (journalDir && !cacheOnly && !indexCoversBasket) {
    const local = await tryCheckoutFromMarketJson(journalDir, uniqueItems, filters);
    if (local) return { ...local, routingMode, depotLabel: args.depotLabel ?? null };
  }

  type Resolved = {
    id: string;
    label: string;
    spansh: string;
    quantityTons: number;
    tried: string[];
    buyPayload: SpanshBuyPayload | null;
  };

  const stationByKey = new Map<string, Unified>();
  const triedById = new Map<string, string[]>();
  const nearestHitByNeed = new Map<string, NearestHit>();
  const liveScannedIds = new Set<string>();
  let usedEdsm = false;
  const forceLive = args.forceLiveScan === true && !cacheOnly;

  if (index) {
    hydrateStationMapFromIndex(index, ref, preNeeds, stationByKey, nearestHitByNeed, filters.constructionDepots);
  }

  const itemsNeedingLive = cacheOnly
    ? []
    : uniqueItems.filter((it) => {
        const id =
          it.id ||
          commodityMergeBucket(it.name) ||
          commodityMergeBucket(it.nameLocalised) ||
          commodityNormKey(it.name);
        const label = (it.nameLocalised || it.name).trim() || it.name;
        if (!id) return true;
        if (forceLive) return true;
        if (!index) return true;
        const savedHits = index.getAllStationsForNeed(
          ref,
          id,
          label,
          {},
          distanceRef,
          filters.constructionDepots,
        );
        if (hasBuyStationWithinLy(savedHits, undefined, {}, distanceRef)) return false;
        return index.needsPassiveScan(
          ref,
          id,
          MATERIAL_BUY_CACHE_TTL_MS,
          filters.maxSystemsPerMaterial ?? null,
          label,
          filters.constructionDepots,
        );
      });

  const resolvePass = await mapPool(itemsNeedingLive, RESOLVE_COMMODITY_CONCURRENCY, async (it) => {
    const label = (it.nameLocalised || it.name).trim() || it.name;
    const { spansh, tried, buyPayload } = await resolveSpanshCommodityName(
      ref,
      it.id,
      it.name,
      it.nameLocalised,
    );
    return { it, label, spansh, tried, buyPayload };
  });

  const spanshResolved: Resolved[] = [];
  for (const row of resolvePass) {
    const id =
      row.it.id ||
      commodityMergeBucket(row.it.name) ||
      commodityMergeBucket(row.it.nameLocalised) ||
      commodityNormKey(row.it.name);
    const prev = triedById.get(id) ?? [];
    triedById.set(id, [...new Set([...prev, ...row.tried, "spansh"])]);
    if (!row.buyPayload || spanshSearchHitCount(row.buyPayload) <= 0) continue;
    const spanshLabel = row.spansh || inferSpanshLabelFromPayload(row.buyPayload) || row.label;
    liveScannedIds.add(id || row.it.id);
    spanshResolved.push({
      id: id || row.it.id,
      label: row.label,
      spansh: spanshLabel,
      quantityTons: row.it.quantityTons,
      tried: row.tried,
      buyPayload: row.buyPayload,
    });
    if (index && id) {
      const hits = filterHitsForBuyIndex(
        hitsFromBuyPayload(ref, { id, label: row.label }, row.buyPayload, "spansh", row.spansh),
        filters.constructionDepots,
      );
      if (hits.length) index.mergeStations(ref, id, row.label, hits);
    }
  }

  ingestSpanshBuyResults(spanshResolved, stationByKey, nearestHitByNeed, searchFilters, filters);

  const edsmNeeds = cacheOnly
    ? []
    : preNeeds.filter((need) => {
        const savedHits =
          index?.getAllStationsForNeed(
            ref,
            need.id,
            need.label,
            {},
            distanceRef,
            filters.constructionDepots,
          ) ?? [];
        if (savedHits.length > 0) return false;
        return !needHasBuySeller(need, stationByKey, nearestHitByNeed);
      });
  if (edsmNeeds.length > 0) {
    const edsmResult = await exhaustiveEdsmBuySearch({
      referenceSystem: ref,
      needs: edsmNeeds,
      filters: searchFilters,
      maxMarketFetches: EDSM_CHECKOUT_MARKET_BUDGET,
    });
    for (const hit of edsmResult.hits) {
      if (
        isConstructionDepotStation(filters.constructionDepots ?? [], {
          systemName: hit.systemName,
          stationName: hit.stationName,
          marketId: hit.marketId,
          stationType: hit.stationType,
        })
      ) {
        continue;
      }
      usedEdsm = true;
      const market: MarketRow[] = [];
      for (const offer of hit.offers.values()) {
        market.push({ commodity: offer.edsmCommodity, supply: offer.stock, buy_price: offer.buyPrice });
      }
      const pseudo: SpanshStationResult = {
        name: hit.stationName,
        system_name: hit.systemName,
        market_id: hit.marketId,
        distance: hit.distanceLy ?? undefined,
        type: hit.stationType ?? undefined,
        market,
      };
      for (const [bucket, offer] of hit.offers) {
        const prev = triedById.get(bucket) ?? [];
        if (!prev.includes("edsm")) triedById.set(bucket, [...prev, "edsm"]);
        const k = `m:${hit.marketId}`;
        noteNearestHit(nearestHitByNeed, bucket, k, offer.edsmCommodity, hit.distanceLy, "edsm");
        stationByKey.set(k, mergeStation(stationByKey.get(k), pseudo, offer.edsmCommodity, "edsm", bucket));
      }
    }
  }

  const resolved: NeedRow[] = [];
  for (const need of preNeeds) {
    if (!need.id) continue;
    for (const st of stationByKey.values()) {
      const sell = stationSellsNeed(st, need);
      if (!sell) continue;
      resolved.push({
        id: need.id,
        label: need.label,
        spansh: sell.spansh,
        quantityTons: need.quantityTons,
      });
      break;
    }
  }

  if (journalDir && !cacheOnly) {
    await enrichStationMapFromDockMarket(journalDir, stationByKey, resolved, searchFilters);
  }
  if (!cacheOnly) {
    await injectShopMarketSnapshots(stationByKey, resolved, searchFilters, ref);
    await enrichKnownShopDistances(stationByKey, ref, filters);
  }

  if (!cacheOnly && (forceLive || liveScannedIds.size > 0)) {
    await enrichRecordsWithBodyNames(stationByKey.values(), 8);
  }

  const sellerSystems = [
    ...new Set(
      [...stationByKey.values()]
        .map((st) => st.systemName.trim())
        .filter(Boolean),
    ),
  ];
  const distanceMap = await resolveSystemDistanceMap([distanceRef], sellerSystems);
  for (const st of stationByKey.values()) {
    st.distanceLy = constructionHopLy(distanceRef, st.systemName, st.distanceLy, distanceMap);
  }

  const needRows: NeedRow[] = [];
  for (const need of preNeeds) {
    if (!need.id) continue;
    const recorded = nearestHitByNeed.get(need.id);
    if (recorded) {
      needRows.push({
        id: need.id,
        label: need.label,
        spansh: recorded.spansh,
        quantityTons: need.quantityTons,
      });
      continue;
    }
    for (const st of stationByKey.values()) {
      const sell = stationSellsNeed(st, need);
      if (!sell) continue;
      needRows.push({
        id: need.id,
        label: need.label,
        spansh: sell.spansh,
        quantityTons: need.quantityTons,
      });
      break;
    }
  }

  let groups: CheckoutStationGroup[];
  let unresolved: BasketCheckoutResult["unresolved"];
  if (routingMode === "nearest") {
    ({ groups, unresolved } = buildNearestStopPerItem(
      stationByKey,
      preNeeds,
      filters,
      triedById,
      nearestHitByNeed,
    ));
  } else {
    groups = routeStations(routingMode, stationByKey, needRows, filters);
    groups = appendNearestStopsForMissing(groups, stationByKey, needRows, filters, needRows.map((n) => n.id));
    const covered = new Set<string>();
    for (const g of groups) for (const id of g.commodityIds) covered.add(id);
    unresolved = [];
    for (const need of preNeeds) {
      if (!need.id || covered.has(need.id)) continue;
      unresolved.push({
        id: need.id,
        label: need.label,
        quantityNeeded: need.quantityTons,
        tried: triedById.get(need.id) ?? ["edsm", "spansh"],
      });
    }
  }

  const catalogStations = buildCatalogFromStationMap(stationByKey, resolved, searchFilters);
  if (index && !cacheOnly) {
    persistStationHitsToIndex(index, ref, preNeeds, stationByKey, filters.constructionDepots);
    await index.flush();
  }
  let materialListings = buildMaterialListings(
    index,
    ref,
    preNeeds,
    stationByKey,
    liveScannedIds,
    distanceMap,
    distanceRef,
    filters.constructionDepots,
  );
  if (!cacheOnly && liveScannedIds.size > 0) {
    materialListings = await Promise.all(
      materialListings.map(async (mat) => {
        if (!liveScannedIds.has(mat.id)) return mat;
        return {
          ...mat,
          stations: await enrichHitsWithBodyNames(mat.stations.slice(0, 3), 3),
        };
      }),
    );
  }
  const listedIds = new Set(materialListings.map((m) => m.id));
  const finalUnresolved = unresolved.filter((u) => !listedIds.has(u.id));

  const result: BasketCheckoutResult = {
    referenceSystem: ref,
    constructionSiteSystem: siteInput || ref,
    groups,
    catalogStations,
    materialListings,
    unresolved: finalUnresolved,
    /** EDSM wins when it contributed, since its rows carry the market timestamps. */
    dataSource: usedEdsm ? "edsm" : "spansh",
    routingMode,
    depotLabel: args.depotLabel ?? null,
  };
  if (!skipMemo) checkoutMemo.set(mk, result);

  return result;
}

export type DepotCheckoutPlan = {
  depotLabel: string;
  referenceSystem: string;
  constructionSiteSystem?: string;
  items: BasketCheckoutItem[];
};

export async function runBasketCheckoutBundle(args: {
  journalDir?: string | null;
  filters?: Partial<CheckoutFilters>;
  routingMode?: CheckoutRoutingMode;
  depotPlans: DepotCheckoutPlan[];
  skipCache?: boolean;
  materialIndex?: MaterialBuyIndex;
  forceLiveScan?: boolean;
  cacheOnly?: boolean;
}): Promise<BasketCheckoutBundle> {
  const eligible = args.depotPlans.filter((plan) => plan.items.length > 0 && plan.referenceSystem.trim());
  /**
   * Two at a time. Network concurrency is bounded by the gates in `httpGate.ts` either way; a
   * third plan in flight only held memory while it queued behind the other two.
   */
  const plans = await mapPool(eligible, 2, async (plan) =>
    runBasketCheckout({
      referenceSystem: plan.referenceSystem,
      constructionSiteSystem: plan.constructionSiteSystem,
      items: plan.items,
      journalDir: args.journalDir,
      filters: args.filters,
      routingMode: args.routingMode,
      depotLabel: plan.depotLabel,
      skipCache: args.skipCache === true,
      materialIndex: args.materialIndex,
      forceLiveScan: args.forceLiveScan,
      cacheOnly: args.cacheOnly,
    }),
  );
  return { plans };
}
