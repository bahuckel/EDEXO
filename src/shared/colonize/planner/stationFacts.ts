import { buyStationHitMatchesNeed } from "../buyStationHitMatch";
import { compareBuyStationHits } from "../buyStationSort";
import type { MaterialBuyListing, MaterialBuyStationHit } from "../materialBuyIndexTypes";
import type { DepotSnapshot } from "../types";
import {
  findShopHistoryEntry,
  hasBoughtFromStation,
  isRecentShopStation,
  type ShopHistoryEntry,
} from "../shopHistory";
import { isCommanderBuyOffer } from "../stationSellOffer";
import { isKnownLy, lyOrLast, toLy } from "../systemDistanceLy";
import { isConstructionDepotStation } from "../constructionDepot";
import { isStationBanned, type BannedStation } from "../stationBans";
import {
  allowSurfaceStation,
  isFleetCarrierStationType,
  matchesDockedStation,
  normSystemName,
  stationMeetsKindFilter,
  stationMeetsMinPad,
  type DockedStationRef,
  type MinLandingPad,
  type StationKindFilter,
} from "../stationFilter";
import { catalogStationKey, stationSellsCommodity } from "./stationKeys";
import type {
  BuyStationPreference,
  ListingProof,
  MaterialBuyStationFilter,
  PackRouteContext,
  PlannerNeed,
  PlannerStation,
  TripStop,
} from "./types";

/** Everything the planner asks about one station: is it allowed, how far, how much it fills. */

export function buildBuyStationPreference(listings: MaterialBuyListing[]): Map<string, BuyStationPreference> {
  const pref = new Map<string, BuyStationPreference>();
  for (const mat of listings) {
    mat.stations.forEach((hit, idx) => {
      const key = catalogStationKey(hit.systemName, hit.stationName, hit.marketId);
      const dist = toLy(hit.distanceLy);
      const prev = pref.get(key);
      if (!prev || idx < prev.rank || (idx === prev.rank && lyOrLast(dist) < lyOrLast(prev.distanceLy))) {
        pref.set(key, { rank: idx, distanceLy: dist });
      }
    });
  }
  return pref;
}

/** Same station filters as trip planning — keeps buy list and trips aligned. */
export function filterMaterialBuyStationHits(
  stations: MaterialBuyStationHit[],
  args: MaterialBuyStationFilter,
): MaterialBuyStationHit[] {
  const bannedStations = args.bannedStations ?? [];
  const constructionSystems = args.constructionSystems ?? [];
  const shopHistory = args.shopHistory ?? [];
  const constructionDepots = args.constructionDepots ?? [];
  return stations.filter((hit) => {
    if (!hit.purchaseProven && !isCommanderBuyOffer(hit.supply, hit.buyPrice)) return false;
    if (
      constructionDepots.length &&
      isConstructionDepotStation(constructionDepots, {
        systemName: hit.systemName,
        stationName: hit.stationName,
        marketId: hit.marketId,
      })
    ) {
      return false;
    }
    if (isStationBanned(bannedStations, hit.systemName, hit.stationName)) return false;
    const dockedHere = matchesDockedStation(hit, args.dockedStation);
    const minPad: MinLandingPad = args.minLandingPad ?? (args.largePadOnly ? "L" : "any");
    if (!dockedHere && !stationMeetsMinPad(minPad, hit.pad, hit.stationType)) return false;
    if (args.excludeFleetCarriers && (hit.stationType ? isFleetCarrierStationType(hit.stationType) : false))
      return false;
    if (!dockedHere && !stationMeetsKindFilter(hit.isPlanetaryOrGround === true, args.stationKind))
      return false;
    const ly = toLy(hit.distanceLy);
    const knownShop =
      hasBoughtFromStation(shopHistory, hit.systemName, hit.stationName) ||
      isRecentShopStation(shopHistory, hit.systemName, hit.stationName);
    if (
      !dockedHere &&
      !knownShop &&
      args.maxDistanceLy != null &&
      Number.isFinite(args.maxDistanceLy) &&
      lyOrLast(ly) > args.maxDistanceLy
    ) {
      return false;
    }
    if (
      args.stationKind !== "space" &&
      args.stationKind !== "ground" &&
      !dockedHere &&
      !knownShop &&
      !allowSurfaceStation({
        isPlanetaryOrGround: hit.isPlanetaryOrGround === true,
        distanceLy: ly,
        systemName: hit.systemName,
        constructionSystems,
        includeAllPlanetaryAndGround: args.includeAllPlanetaryAndGround === true,
      })
    ) {
      return false;
    }
    return true;
  });
}

/** Closest eligible seller per commodity — buy cards and primary trip targets. */
export function buildPreferredBuyStationByCommodity(
  listings: MaterialBuyListing[],
  catalog: Map<string, PlannerStation>,
  proof: ListingProof,
  filterArgs: MaterialBuyStationFilter,
  constructionSite = "",
  distanceBySystem: Record<string, number> = {},
): Map<string, string> {
  const out = new Map<string, string>();
  const site = constructionSite.trim();
  const shopHistory = filterArgs.shopHistory ?? [];
  for (const mat of listings) {
    const eligibleHits = [...filterMaterialBuyStationHits(mat.stations, filterArgs)].sort((a, b) =>
      compareBuyStationHits(a, b, shopHistory, site, distanceBySystem),
    );
    for (const hit of eligibleHits) {
      if (!buyStationHitMatchesNeed(mat.id, mat.label, hit)) continue;
      const key = catalogStationKey(hit.systemName, hit.stationName, hit.marketId);
      if (!catalog.has(key)) continue;
      if (!stationSellsCommodity(proof, key, mat.id)) continue;
      const offer = catalog.get(key)?.offers.get(mat.id);
      if (!offer || offer.supply <= 0) continue;
      out.set(mat.id, key);
      break;
    }
  }
  return out;
}

/** What a station still has of a commodity: its offer, less what the plan already bought there. */
export function supplyAt(station: PlannerStation, commodityId: string, ctx?: PackRouteContext): number {
  const offer = station.offers.get(commodityId);
  if (!offer) return 0;
  return ctx?.supplyLeft?.get(`${station.key}|${commodityId}`) ?? offer.supply;
}

/**
 * How a station would fill `freeTons`: its sellable lines biggest first, as packAtStation buys them. `lines` is how
 * many commodities that takes - fewer is better (owner, 2026-10-22: "fewer commodities, bigger batches first").
 */
export function stationFillPlan(
  station: PlannerStation,
  proof: ListingProof,
  needs: Map<string, PlannerNeed>,
  freeTons: number,
  routeCtx?: PackRouteContext,
): { fill: number; lines: number } {
  const sizes: number[] = [];
  for (const [id, need] of needs) {
    if (need.tons <= 0) continue;
    if (routeCtx && !canPackCommodityAtStation(id, station, routeCtx)) continue;
    if (!stationSellsCommodity(proof, station.key, id)) continue;
    const supply = supplyAt(station, id, routeCtx);
    if (supply <= 0) continue;
    sizes.push(Math.min(need.tons, supply));
  }
  sizes.sort((a, b) => b - a);
  let fill = 0;
  let lines = 0;
  for (const s of sizes) {
    if (fill >= freeTons - 0.01) break;
    fill += Math.min(s, freeTons - fill);
    lines += 1;
  }
  return { fill, lines };
}

export function canPackCommodityAtStation(
  commodityId: string,
  station: PlannerStation,
  ctx: PackRouteContext,
): boolean {
  if (ctx.primaryPreferred.get(commodityId) === station.key) return true;
  if (ctx.exhausted?.has(commodityId)) return true;
  return ctx.committedSystems.has(normSystemName(station.systemName));
}

export function hasPrimaryNeedAtStation(
  station: PlannerStation,
  needs: Map<string, PlannerNeed>,
  primaryPreferred: Map<string, string>,
  exhausted?: Set<string>,
): boolean {
  for (const [id, need] of needs) {
    if (need.tons <= 0) continue;
    if (primaryPreferred.get(id) === station.key) return true;
    // Its preferred seller ran out: a station that sells it takes that seller's place.
    if (exhausted?.has(id) && station.offers.has(id)) return true;
  }
  return false;
}

export function countCompletableAtStation(
  station: PlannerStation,
  proof: ListingProof,
  needs: Map<string, PlannerNeed>,
  freeTons: number,
  ctx: PackRouteContext,
): number {
  let count = 0;
  for (const [id, need] of needs) {
    if (need.tons <= 0) continue;
    if (!canPackCommodityAtStation(id, station, ctx)) continue;
    if (!stationSellsCommodity(proof, station.key, id)) continue;
    const supply = supplyAt(station, id, ctx);
    if (supply <= 0) continue;
    const buy = Math.min(need.tons, supply, freeTons);
    if (buy >= need.tons - 0.01) count += 1;
  }
  return count;
}

export function stationFillTons(
  station: PlannerStation,
  proof: ListingProof,
  needs: Map<string, PlannerNeed>,
  freeTons: number,
  routeCtx?: PackRouteContext,
): number {
  return stationFillPlan(station, proof, needs, freeTons, routeCtx).fill;
}

export function stationInHistory(history: ShopHistoryEntry[], station: PlannerStation): boolean {
  return findShopHistoryEntry(history, station.systemName, station.stationName) != null;
}

export function stationEligible(
  station: PlannerStation,
  proof: ListingProof,
  needs: Map<string, PlannerNeed>,
  freeTons: number,
  visited: Set<string>,
  activeDepots: DepotSnapshot[],
  constructionSystems: string[],
  includeAllPlanetaryAndGround: boolean,
  history: ShopHistoryEntry[],
  bannedStations: BannedStation[],
  dockedStation?: DockedStationRef | null,
  largePadOnly?: boolean,
  maxDistanceLy?: number | null,
  buyPreference?: Map<string, BuyStationPreference>,
  routeCtx?: PackRouteContext,
  minLandingPad?: MinLandingPad,
  stationKind?: StationKindFilter,
  excludeFleetCarriers?: boolean,
): boolean {
  if (visited.has(station.key)) return false;
  if (isStationBanned(bannedStations, station.systemName, station.stationName)) return false;
  if (
    isConstructionDepotStation(activeDepots, {
      systemName: station.systemName,
      stationName: station.stationName,
      marketId: station.marketId,
    })
  ) {
    return false;
  }
  const dockedHere = matchesDockedStation(station, dockedStation);
  const knownShop = stationInHistory(history, station);
  const minPad: MinLandingPad = minLandingPad ?? (largePadOnly ? "L" : "any");
  if (!dockedHere && !stationMeetsMinPad(minPad, station.pad, station.stationType)) return false;
  if (excludeFleetCarriers && isFleetCarrierStationType(station.stationType)) return false;
  if (!dockedHere && !stationMeetsKindFilter(station.isPlanetaryOrGround, stationKind)) return false;
  const ly = stationLy(station, buyPreference);
  if (
    !dockedHere &&
    !knownShop &&
    maxDistanceLy != null &&
    Number.isFinite(maxDistanceLy) &&
    ly > maxDistanceLy
  ) {
    return false;
  }
  if (
    stationKind !== "space" &&
    stationKind !== "ground" &&
    !dockedHere &&
    !knownShop &&
    !allowSurfaceStation({
      isPlanetaryOrGround: station.isPlanetaryOrGround,
      distanceLy: station.distanceLy,
      systemName: station.systemName,
      constructionSystems,
      includeAllPlanetaryAndGround,
    })
  ) {
    return false;
  }
  const fill = stationFillTons(station, proof, needs, freeTons, routeCtx);
  if (fill <= 0) return false;
  if (!routeCtx) return true;
  if (hasPrimaryNeedAtStation(station, needs, routeCtx.primaryPreferred, routeCtx.exhausted)) return true;
  return routeCtx.committedSystems.has(normSystemName(station.systemName));
}

/**
 * A distance for scoring, never for display. Unknown counts as very far but stays finite: the
 * routing scores subtract and multiply these, and `Infinity - Infinity` is `NaN`, which silently
 * breaks every comparison it touches. A known 0 — a seller in the construction system — now scores
 * as the nearest there is; it used to fall through to this penalty and score as the farthest.
 */
const UNKNOWN_LY_FOR_SCORING = 999_999;

export function stationLy(
  station: PlannerStation,
  buyPreference?: Map<string, BuyStationPreference>,
): number {
  if (isKnownLy(station.distanceLy)) return station.distanceLy;
  const pref = buyPreference?.get(station.key);
  if (isKnownLy(pref?.distanceLy)) return pref.distanceLy;
  return UNKNOWN_LY_FOR_SCORING;
}

export function buyStopLy(stop: TripStop): number {
  const ly = stop.constructionDistanceLy ?? stop.distanceLy;
  return isKnownLy(ly) ? ly : UNKNOWN_LY_FOR_SCORING;
}
