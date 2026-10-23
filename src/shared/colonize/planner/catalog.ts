import { resolveHitDistanceLy } from "../materialShopPurchases";
import type { MaterialBuyListing } from "../materialBuyIndexTypes";
import { mergeMaterialListings } from "../mergeCheckoutPlans";
import type { BasketCheckoutResult, CheckoutStationCatalogEntry, DepotSnapshot } from "../types";
import { type ShopHistoryEntry } from "../shopHistory";
import { commodityNeedMatchesLabel } from "../commodityKey";
import { isCommanderBuyOffer } from "../stationSellOffer";
import { shopEntryBoughtNeed } from "../shopHistory";
import { galaxyLyFromSite, isKnownLy, nearerLy, toLy } from "../systemDistanceLy";
import { isConstructionDepotStation } from "../constructionDepot";
import { isSurfaceStationLabel, isSurfaceStationType, normSystemName } from "../stationFilter";
import { catalogStationKey, markStationSells, stationSellsCommodity } from "./stationKeys";
import type { ListingProof, PlannerNeed, PlannerStation } from "./types";

/** Build the set of stations worth considering, from listings, dock history and distances. */

function surfaceFlag(name: string, stationType: string | null, flagged?: boolean): boolean {
  if (flagged === true) return true;
  return isSurfaceStationType(stationType, false, name) || isSurfaceStationLabel(name);
}

/** Distance / pad metadata only — never infer sellable commodities from catalog rows. */
function ingestCatalogStationMeta(
  catalog: Map<string, PlannerStation>,
  e: CheckoutStationCatalogEntry,
  _fromConstructionRef: boolean,
): void {
  const key = catalogStationKey(e.systemName, e.stationName, e.marketId);
  const planetary = surfaceFlag(e.stationName, e.stationType, e.isPlanetaryOrGround);
  let st = catalog.get(key);
  if (!st) {
    st = {
      key,
      systemName: e.systemName,
      stationName: e.stationName,
      marketId: e.marketId,
      distanceLy: null,
      isPlanetaryOrGround: planetary,
      stationType: e.stationType,
      bodyName: e.bodyName ?? null,
      offers: new Map(),
    };
    catalog.set(key, st);
  }
  st.isPlanetaryOrGround = st.isPlanetaryOrGround || planetary;
  if (!st.marketId && e.marketId) st.marketId = e.marketId;
  if (!st.stationType && e.stationType) st.stationType = e.stationType;
  if (!st.bodyName && e.bodyName) st.bodyName = e.bodyName;
}

/**
 * Stock assumed at a station the commander bought a commodity from when its stock is not known (no Market.json there,
 * no Spansh row yet). It was 1 t: since shelves empty as the plan buys (packing.ts), every such seller ran dry after
 * one ton, and the plan stopped with most materials listed as "sellers are known, but none fits" (owner's profile,
 * 2026-10-23: 30 of 33 materials). A market that sold it restocks; the market-id refresh replaces this with real
 * figures as soon as Spansh has them.
 */
export const UNKNOWN_PROVEN_SUPPLY = 100_000;

function effectiveListingSupply(hit: MaterialBuyListing["stations"][number]): number {
  if (hit.purchaseProven) return (hit.supply ?? 0) > 0 ? hit.supply! : UNKNOWN_PROVEN_SUPPLY;
  const sup = hit.supply ?? 0;
  return sup > 0 ? sup : 0;
}

export function buildStationCatalog(
  checkouts: BasketCheckoutResult[],
  constructionSystems: string[] = [],
  needs?: Map<string, PlannerNeed>,
  listingsOverride?: MaterialBuyListing[],
): { catalog: Map<string, PlannerStation>; proof: ListingProof } {
  const constructionRefs = new Set(constructionSystems.map((s) => normSystemName(s)));
  const catalog = new Map<string, PlannerStation>();
  const proof: ListingProof = new Map();
  const listings = listingsOverride ?? mergeMaterialListings(checkouts);
  for (const mat of listings) {
    const fromConstruction = checkouts.some(
      (plan) => constructionRefs.size === 0 || constructionRefs.has(normSystemName(plan.referenceSystem)),
    );
    ingestMaterialListing(catalog, proof, mat, fromConstruction, needs?.get(mat.id)?.tons);
  }
  for (const plan of checkouts) {
    const fromConstruction =
      constructionRefs.size === 0 || constructionRefs.has(normSystemName(plan.referenceSystem));
    if (plan.catalogStations?.length) {
      for (const e of plan.catalogStations) ingestCatalogStationMeta(catalog, e, fromConstruction);
    }
  }
  return { catalog, proof };
}

export function applySystemDistanceMap(
  catalog: Map<string, PlannerStation>,
  distanceBySystem: Record<string, number>,
  constructionSite: string,
): void {
  const site = constructionSite.trim();
  if (!site) return;
  for (const st of catalog.values()) {
    const mapped = galaxyLyFromSite(st.systemName, site, distanceBySystem);
    if (mapped != null) st.distanceLy = mapped;
  }
}

export function removeConstructionDepotsFromCatalog(
  catalog: Map<string, PlannerStation>,
  depots: DepotSnapshot[],
): void {
  for (const [key, st] of catalog) {
    if (
      isConstructionDepotStation(depots, {
        systemName: st.systemName,
        stationName: st.stationName,
        marketId: st.marketId,
      })
    ) {
      catalog.delete(key);
    }
  }
}

/** Real shops you docked at — inject from Market.json + purchase memory when Spansh skipped them. */
export function injectShopHistoryIntoCatalog(
  catalog: Map<string, PlannerStation>,
  proof: ListingProof,
  history: ShopHistoryEntry[],
  needs: Map<string, PlannerNeed>,
  depots: DepotSnapshot[],
  constructionSite: string,
  distanceMap: Record<string, number>,
  constructionSites: string[],
): void {
  for (const h of history) {
    if (isConstructionDepotStation(depots, h)) continue;

    const key = catalogStationKey(h.systemName, h.stationName, h.marketId);
    const hopLy = resolveHitDistanceLy(
      h.systemName,
      constructionSite,
      distanceMap,
      h,
      undefined,
      constructionSites,
    );
    let st = catalog.get(key);
    if (!st) {
      st = {
        key,
        systemName: h.systemName,
        stationName: h.stationName,
        marketId: h.marketId,
        distanceLy: toLy(hopLy),
        isPlanetaryOrGround: false,
        offers: new Map(),
      };
      catalog.set(key, st);
    } else if (isKnownLy(hopLy)) {
      st.distanceLy = nearerLy(st.distanceLy, hopLy);
    }

    for (const o of h.cachedOffers ?? []) {
      if (!needs.has(o.commodityId) || o.supply <= 0) continue;
      /**
       * A Market.json snapshot is first-hand evidence: the commander had that market open
       * and saw the commodity on sale at a price. Proof used to come only from a recorded
       * purchase, so stock seen but never bought was dropped again by pruneUnprovenOffers
       * and the station looked like it did not sell the thing at all.
       */
      if (isCommanderBuyOffer(o.supply, o.buyPrice)) markStationSells(proof, key, o.commodityId);
      if (!stationSellsCommodity(proof, key, o.commodityId)) continue;
      const prev = st.offers.get(o.commodityId);
      if (!prev || o.supply > prev.supply) {
        st.offers.set(o.commodityId, { label: o.label, supply: o.supply, buyPrice: o.buyPrice });
      }
    }

    for (const [needId, need] of needs) {
      if (!shopEntryBoughtNeed(h, needId, need.label)) continue;
      markStationSells(proof, key, needId);
      const cached = h.cachedOffers?.find(
        (o) => o.commodityId === needId || commodityNeedMatchesLabel(needId, need.label, o.commodityId),
      );
      const purchase = h.purchases?.find(
        (p) => p.commodityId === needId || commodityNeedMatchesLabel(needId, need.label, p.commodityId),
      );
      const buyPrice = cached?.buyPrice ?? purchase?.buyPrice ?? null;
      const supply =
        cached && isCommanderBuyOffer(cached.supply, cached.buyPrice) ? cached.supply : purchase ? UNKNOWN_PROVEN_SUPPLY : null;
      const prev = st.offers.get(needId);
      const nextSupply = supply ?? prev?.supply ?? 1;
      if (!prev || nextSupply > prev.supply) {
        st.offers.set(needId, {
          label: purchase?.label || cached?.label || need.label,
          supply: nextSupply,
          buyPrice: buyPrice ?? prev?.buyPrice ?? null,
        });
      }
    }
  }
}

export function pruneUnprovenOffers(catalog: Map<string, PlannerStation>, proof: ListingProof): void {
  for (const [key, st] of catalog) {
    for (const commodityId of [...st.offers.keys()]) {
      if (!stationSellsCommodity(proof, key, commodityId)) st.offers.delete(commodityId);
    }
    if (st.offers.size === 0) catalog.delete(key);
  }
}

function ingestMaterialListing(
  catalog: Map<string, PlannerStation>,
  proof: ListingProof,
  mat: MaterialBuyListing,
  _fromConstructionRef: boolean,
  _plannerNeedTons?: number,
): void {
  for (const hit of mat.stations) {
    const key = catalogStationKey(hit.systemName, hit.stationName, hit.marketId);
    if (!hit.purchaseProven && !isCommanderBuyOffer(hit.supply, hit.buyPrice)) continue;
    markStationSells(proof, key, mat.id);
    const planetary = hit.isPlanetaryOrGround === true;
    let st = catalog.get(key);
    if (!st) {
      st = {
        key,
        systemName: hit.systemName,
        stationName: hit.stationName,
        marketId: hit.marketId,
        distanceLy: toLy(hit.distanceLy),
        isPlanetaryOrGround: planetary,
        stationType: hit.stationType ?? null,
        pad: hit.pad ?? null,
        arrivalLs: hit.arrivalLs ?? null,
        bodyName: hit.bodyName ?? null,
        offers: new Map(),
      };
      catalog.set(key, st);
    } else if (isKnownLy(hit.distanceLy)) {
      st.distanceLy = nearerLy(st.distanceLy, hit.distanceLy);
    }
    st.isPlanetaryOrGround = st.isPlanetaryOrGround || planetary;
    if (!st.stationType && hit.stationType) st.stationType = hit.stationType;
    if (!st.pad && hit.pad) st.pad = hit.pad;
    if (st.arrivalLs == null && hit.arrivalLs != null) st.arrivalLs = hit.arrivalLs;
    if (!st.bodyName && hit.bodyName) st.bodyName = hit.bodyName;
    const supply = effectiveListingSupply(hit);
    if (supply <= 0) continue;
    const prev = st.offers.get(mat.id);
    if (!prev || supply > prev.supply) {
      st.offers.set(mat.id, { label: mat.label, supply, buyPrice: hit.buyPrice });
    }
  }
}
