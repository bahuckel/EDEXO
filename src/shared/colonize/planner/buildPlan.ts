import { dedupeBuyStationHits } from "../buyStationMerge";
import { finalizeMaterialBuyListings, ensureListingRowsForNeeds } from "../materialShopPurchases";
import type { MaterialBuyListing } from "../materialBuyIndexTypes";
import { mergeMaterialListings } from "../mergeCheckoutPlans";
import type { BasketCheckoutResult, DepotSnapshot } from "../types";
import type { WingMember } from "../wingManifest";
import { hasBoughtFromStation, isRecentShopStation, type ShopHistoryEntry } from "../shopHistory";
import { toLy } from "../systemDistanceLy";
import {
  isConstructionDepotStation,
  looksLikeConstructionDepotStation,
  purgeConstructionDepotsFromShopHistory,
} from "../constructionDepot";
import { type BannedStation } from "../stationBans";
import {
  collectConstructionSystems,
  isLargePadStationType,
  normSystemName,
  type MinLandingPad,
  type StationKindFilter,
} from "../stationFilter";
import { applySystemDistanceMap, buildStationCatalog, injectShopHistoryIntoCatalog, pruneUnprovenOffers, removeConstructionDepotsFromCatalog } from "./catalog";
import { buildDepotNeedStates, collectPlannerNeeds, makeDeliverStops, seedTripAllocationFromCargo, sumCargo, totalNeedTons } from "./needs";
import type { SystemCoordsByNorm } from "./legLy";
import { packAtStation } from "./packing";
import { orderBuyStopsForTrip, pickNextBuyStation, primaryDeliverSystem, pruneSurfaceStations, sumBuyRouteLy } from "./routing";
import { buildBuyStationPreference, buildPreferredBuyStationByCommodity, hasPrimaryNeedAtStation, stationFillTons, stationLy } from "./stationFacts";
import { stationKey, stationMatches, stationSellsCommodity } from "./stationKeys";
import type { HaulTrip, LogisticsPlan, MaterialBuyStationFilter, MissingBuyIndexedItem, PackAllocCtx, PackLine, PackRouteContext, PickBuyStationArgs, PlannerStation, TripAllocationMap, TripBuyLine, TripStop } from "./types";

/** The orchestrator: turn depot needs and a station catalog into a sequence of hauls. */

/**
 * Capacity-aware multi-trip haul planner.
 * Each trip: one or more buy stops (fill the hold) → deliver to construction → repeat.
 */
export function buildLogisticsPlan(args: {
  checkouts: BasketCheckoutResult[];
  activeDepots: DepotSnapshot[];
  cargoByKey: Map<string, number>;
  cargoCapacity: number | null;
  wing: WingMember[];
  shopHistory: ShopHistoryEntry[];
  bannedStations?: BannedStation[];
  homeSystem: string;
  /** When docked — highlight buys for this station only. */
  dockedStation?: { stationName: string; systemName: string } | null;
  includeAllPlanetaryAndGround?: boolean;
  /** Min ly from construction refs — keyed by normalized system name (Spansh coords). */
  systemDistanceLy?: Record<string, number>;
  /** Construction site star systems — 3D Ly from these (never pinned shopping hub). */
  constructionDistanceSystems?: string[];
  /** Galaxy coordinates keyed by normalized system name — seller-to-seller legs (S-13). */
  systemCoords?: SystemCoordsByNorm;
  /** Trip buy stops only at large-pad stations (Coriolis, Ocellus, Orbis, etc.). */
  largePadOnly?: boolean;
  minLandingPad?: MinLandingPad;
  stationKind?: StationKindFilter;
  excludeFleetCarriers?: boolean;
  /** Max Ly from construction — same filter as buy-stations checkout. */
  maxDistanceLy?: number | null;
  /** Index-backed listings from getDepotMaterialListings — same DB as Search. */
  buyListings?: MaterialBuyListing[];
}): LogisticsPlan {
  const minLandingPad: MinLandingPad = args.minLandingPad ?? (args.largePadOnly ? "L" : "any");
  const stationKind: StationKindFilter = args.stationKind ?? "any";
  const excludeFleetCarriers = args.excludeFleetCarriers === true;
  const largePadOnly = minLandingPad === "L";
  const bannedStations = args.bannedStations ?? [];
  const shopHistory = purgeConstructionDepotsFromShopHistory(args.shopHistory, args.activeDepots);
  const constructionSystems = collectConstructionSystems(args.activeDepots);
  const constructionRefs =
    args.constructionDistanceSystems?.filter((s) => s.trim()).length
      ? args.constructionDistanceSystems!.map((s) => s.trim()).filter(Boolean)
      : constructionSystems;
  const warnings: string[] = [];
  const missingBuyIndexed: MissingBuyIndexedItem[] = [];
  const missingTripEligible: MissingBuyIndexedItem[] = [];
  const capacity = args.cargoCapacity;
  const cargoOnHand = sumCargo(args.cargoByKey);
  const cargoFree = capacity != null && capacity > 0 ? Math.max(0, capacity - cargoOnHand) : 0;

  if (capacity == null || capacity <= 0) {
    warnings.push("Cargo capacity unknown — click Capacity unknown in the logistics planner to enter your hold size.");
  }

  const needs = collectPlannerNeeds(args.activeDepots, args.cargoByKey, args.wing);
  const totalRemainingTons = totalNeedTons(needs);

  if (totalRemainingTons <= 0) {
    return {
      homeSystem: args.homeSystem,
      capacity,
      cargoOnHand,
      cargoFree,
      totalRemainingTons: 0,
      trips: [],
      warnings,
      missingBuyIndexed,
      missingTripEligible,
      dockBuys: [],
    };
  }

  const distanceMap = args.systemDistanceLy ?? {};
  const constructionSite = constructionRefs[0]?.trim() || "";
  const useIndexListings = args.buyListings != null;
  const needRows = [...needs.entries()].map(([id, need]) => ({
    id,
    label: need.label,
    quantityTons: need.tons,
  }));
  const materialListings = useIndexListings
    ? args.buyListings!.map((m) => ({ ...m, stations: dedupeBuyStationHits(m.stations) }))
    : finalizeMaterialBuyListings({
        listings: ensureListingRowsForNeeds(mergeMaterialListings(args.checkouts), needRows),
        shopHistory,
        depots: args.activeDepots,
        constructionSite,
        constructionSites: constructionRefs,
        distanceMap,
      });
  const buyPreference = buildBuyStationPreference(materialListings);
  const { catalog, proof } = buildStationCatalog(args.checkouts, constructionSystems, needs, materialListings);
  if (!useIndexListings) {
    injectShopHistoryIntoCatalog(
      catalog,
      proof,
      shopHistory,
      needs,
      args.activeDepots,
      constructionSite,
      distanceMap,
      constructionRefs,
    );
  }
  pruneUnprovenOffers(catalog, proof);

  for (const [id, need] of needs) {
    if (need.tons <= 0) continue;
    if (useIndexListings) {
      const listing = materialListings.find((m) => m.id === id);
      if (!listing?.stations.length) {
        missingBuyIndexed.push({ id, label: need.label, quantityTons: need.tons });
      }
      continue;
    }
    let hasSeller = false;
    for (const st of catalog.values()) {
      if (stationSellsCommodity(proof, st.key, id)) {
        hasSeller = true;
        break;
      }
    }
    if (!hasSeller) {
      missingBuyIndexed.push({ id, label: need.label, quantityTons: need.tons });
    }
  }
  if (constructionSite && Object.keys(distanceMap).length) {
    applySystemDistanceMap(catalog, distanceMap, constructionSite);
  }
  removeConstructionDepotsFromCatalog(catalog, args.activeDepots);
  pruneSurfaceStations(
    catalog,
    constructionSystems,
    args.includeAllPlanetaryAndGround === true,
    shopHistory,
    bannedStations,
    args.dockedStation,
    stationKind,
  );
  if (largePadOnly && catalog.size > 0) {
    const largePadCount = [...catalog.values()].filter((st) => isLargePadStationType(st.stationType)).length;
    if (largePadCount === 0) {
      warnings.push(
        "No large-pad sellers in range — trip route needs Coriolis/Ocellus/Orbis-class stations. Refresh stations or check buy stations list for smaller pads.",
      );
    }
  }

  const stationFilterArgs: MaterialBuyStationFilter = {
    largePadOnly,
    minLandingPad,
    stationKind,
    excludeFleetCarriers,
    maxDistanceLy: args.maxDistanceLy,
    bannedStations,
    dockedStation: args.dockedStation,
    constructionSystems,
    constructionDepots: args.activeDepots,
    includeAllPlanetaryAndGround: args.includeAllPlanetaryAndGround === true,
    shopHistory,
  };
  const preferredBuyStationByCommodity = buildPreferredBuyStationByCommodity(
    materialListings,
    catalog,
    proof,
    stationFilterArgs,
    constructionSite,
    distanceMap,
  );
  const listingById = new Map(materialListings.map((m) => [m.id, m]));
  for (const [id, need] of needs) {
    if (need.tons <= 0) continue;
    if (useIndexListings) {
      const listing = listingById.get(id);
      if (listing?.stations.length) continue;
    }
    if (preferredBuyStationByCommodity.has(id)) continue;
    if (missingBuyIndexed.some((m) => m.id === id)) continue;
    if (missingTripEligible.some((m) => m.id === id)) continue;
    missingTripEligible.push({ id, label: need.label, quantityTons: need.tons });
  }

  if (catalog.size === 0) {
    warnings.push(
      "No qualifying stations — refresh after docking at your supplier, unban a station, or wait for live scan. Your dock history + Market.json are used when Spansh omits a seller.",
    );
    return {
      homeSystem: args.homeSystem,
      capacity,
      cargoOnHand,
      cargoFree,
      totalRemainingTons,
      trips: [],
      warnings,
      missingBuyIndexed,
      missingTripEligible,
      dockBuys: [],
    };
  }

  if (capacity == null || capacity <= 0) {
    return {
      homeSystem: args.homeSystem,
      capacity,
      cargoOnHand,
      cargoFree: 0,
      totalRemainingTons,
      trips: [],
      warnings,
      missingBuyIndexed,
      missingTripEligible,
      dockBuys: [],
    };
  }

  const deliverSystem = primaryDeliverSystem(args.activeDepots);
  const depotStates = buildDepotNeedStates(args.activeDepots, args.wing);
  const trips: HaulTrip[] = [];

  let tripNumber = 0;
  /** Hard stop so a pathological plan cannot loop; hitting it is reported, not silent. */
  const MAX_TRIPS = 80;

  while (totalNeedTons(needs) > 0.01 && tripNumber < MAX_TRIPS) {
    tripNumber++;
    const tripStops: TripStop[] = [];
    const tripAllocation: TripAllocationMap = new Map();
    const allocCtx: PackAllocCtx = { tripAllocation, depotStates };
    const visited = new Set<string>();
    let stopIndex = 0;
    let holdTons = tripNumber === 1 ? cargoOnHand : 0;
    let free = capacity - holdTons;
    let lastStopLy: number | null = null;
    let lastStopSystem: string | null = null;

    if (tripNumber === 1 && cargoOnHand > 0) {
      seedTripAllocationFromCargo(tripAllocation, depotStates, args.cargoByKey);
    }

    if (free <= 0 && holdTons > 0) {
      const deliverStops = makeDeliverStops(stopIndex, tripAllocation, depotStates, holdTons, deliverSystem);
      stopIndex += deliverStops.length;
      tripStops.push(...deliverStops);
      trips.push({
        tripNumber,
        loadTons: holdTons,
        capacity,
        buyRouteLy: 0,
        stops: tripStops,
      });
      continue;
    }

    const committedSystems = new Set<string>();
    const routeCtx: PackRouteContext = {
      primaryPreferred: preferredBuyStationByCommodity,
      committedSystems,
    };

    const pickArgs: PickBuyStationArgs = {
      catalog,
      proof,
      needs,
      freeTons: free,
      history: shopHistory,
      bannedStations,
      visited,
      activeDepots: args.activeDepots,
      constructionSystems,
      includeAllPlanetaryAndGround: args.includeAllPlanetaryAndGround === true,
      dockedStation: args.dockedStation,
      lastStopLy,
      lastStopSystem,
      systemCoords: args.systemCoords,
      largePadOnly,
      minLandingPad,
      stationKind,
      excludeFleetCarriers,
      maxDistanceLy: args.maxDistanceLy,
      buyPreference,
      routeCtx,
    };

    /**
     * Held in one mutable record, not two `let`s: both are written from the
     * closures below, and TypeScript's control-flow analysis does not see
     * closure writes, so `let` reads back as `never` at the loop head.
     */
    const active: { station: PlannerStation | null; stop: TripStop | null } = {
      station: null,
      stop: null,
    };

    const flushActiveStop = () => {
      if (active.stop?.buys.length) {
        tripStops.push(active.stop);
      }
      active.stop = null;
      active.station = null;
    };

    const ensureActiveStop = (station: PlannerStation) => {
      if (active.stop && active.station?.key === station.key) return;
      flushActiveStop();
      if (hasPrimaryNeedAtStation(station, needs, preferredBuyStationByCommodity)) {
        committedSystems.add(normSystemName(station.systemName));
      }
      const constructionLy = toLy(station.distanceLy);
      active.station = station;
      active.stop = {
        stopIndex: stopIndex++,
        kind: "buy",
        systemName: station.systemName,
        stationName: station.stationName,
        distanceLy: constructionLy,
        constructionDistanceLy: constructionLy,
        marketId: station.marketId,
        isPlanetaryOrGround: station.isPlanetaryOrGround,
        stationType: station.stationType ?? null,
        pad: station.pad ?? null,
        arrivalLs: station.arrivalLs ?? null,
        bodyName: station.bodyName ?? null,
        recentShop: isRecentShopStation(shopHistory, station.systemName, station.stationName),
        boughtBefore: hasBoughtFromStation(shopHistory, station.systemName, station.stationName),
        buys: [],
        deliverTo: [],
        cargoLoaded: holdTons,
      };
      lastStopLy = constructionLy ?? stationLy(station, buyPreference);
      lastStopSystem = station.systemName;
      pickArgs.lastStopLy = lastStopLy;
      pickArgs.lastStopSystem = lastStopSystem;
    };

    const mergePackIntoActiveStop = (pack: PackLine[]) => {
      if (!active.stop) return;
      for (const p of pack) {
        const existing = active.stop.buys.find((b) => b.commodityId === p.commodityId);
        if (existing) {
          existing.buyTons += p.buyTons;
          existing.stillNeedTotal = needs.get(p.commodityId)?.tons ?? 0;
        } else {
          active.stop.buys.push({
            ...p,
            stillNeedTotal: needs.get(p.commodityId)?.tons ?? 0,
          });
        }
        holdTons += p.buyTons;
        free -= p.buyTons;
      }
      active.stop.cargoLoaded = holdTons;
      pickArgs.freeTons = free;
    };

    while (free > 0 && totalNeedTons(needs) > 0.01) {
      if (
        !active.station ||
        stationFillTons(active.station, proof, needs, free, routeCtx) <= 0
      ) {
        if (active.station) {
          visited.add(active.station.key);
          flushActiveStop();
        }
        const best = pickNextBuyStation({ ...pickArgs, freeTons: free, lastStopLy, lastStopSystem });
        if (!best) break;
        ensureActiveStop(best);
      }

      const pack = packAtStation(
        active.station!,
        proof,
        needs,
        free,
        allocCtx,
        routeCtx,
      );
      if (!pack.length) {
        visited.add(active.station!.key);
        flushActiveStop();
        continue;
      }
      mergePackIntoActiveStop(pack);
    }

    if (active.station) visited.add(active.station.key);
    flushActiveStop();

    const buyStops = tripStops.filter((s) => s.kind === "buy");
    if (!buyStops.length) {
      warnings.push("Could not pack more materials — check unresolved checkout items or station supply.");
      break;
    }

    if (buyStops.length > 1) {
      const ordered = orderBuyStopsForTrip(buyStops, args.systemCoords);
      tripStops.length = 0;
      for (const s of ordered) tripStops.push({ ...s, stopIndex: tripStops.length });
    }

    tripStops.push(...makeDeliverStops(tripStops.length, tripAllocation, depotStates, holdTons, deliverSystem));

    trips.push({
      tripNumber,
      loadTons: holdTons,
      capacity,
      buyRouteLy: sumBuyRouteLy(tripStops, args.systemCoords),
      stops: tripStops,
    });
  }

  let dockBuys: TripBuyLine[] = [];
  const dockedAtConstructionDepot =
    args.dockedStation != null &&
    (isConstructionDepotStation(args.activeDepots, {
      systemName: args.dockedStation.systemName,
      stationName: args.dockedStation.stationName,
    }) ||
      looksLikeConstructionDepotStation(args.dockedStation.stationName));
  if (args.dockedStation && !dockedAtConstructionDepot) {
    const dockKey = stationKey(args.dockedStation.systemName, args.dockedStation.stationName);
    for (const trip of trips) {
      for (const stop of trip.stops) {
        if (stop.kind !== "buy") continue;
        if (stationKey(stop.systemName, stop.stationName) !== dockKey) continue;
        if (!stationMatches(stop.stationName, args.dockedStation.stationName)) continue;
        dockBuys = stop.buys.map((b) => ({
          ...b,
          buyTons: Math.min(b.buyTons, cargoFree > 0 ? cargoFree : 0),
        })).filter((b) => b.buyTons > 0);
        break;
      }
      if (dockBuys.length) break;
    }

    if (!dockBuys.length && cargoFree > 0) {
      const st = catalog.get(dockKey) ?? [...catalog.values()].find((s) =>
        stationMatches(s.stationName, args.dockedStation!.stationName),
      );
      if (st) {
        const needsCopy = collectPlannerNeeds(args.activeDepots, args.cargoByKey, args.wing);
        const pack = packAtStation(st, proof, needsCopy, cargoFree);
        dockBuys = pack.map((p) => ({
          ...p,
          stillNeedTotal: needsCopy.get(p.commodityId)?.tons ?? 0,
        }));
      }
    }
  }

  /**
   * S-18: the loop stops at MAX_TRIPS whether or not the list is finished. Saying so
   * beats showing a plan that quietly covers only part of what is outstanding.
   */
  /**
   * A material can have a preferred seller and still never be bought: the preferred station
   * is chosen from the listing's own distance, while trip eligibility uses the catalog's,
   * and when those disagree the station is filtered out of every trip. The check before the
   * trip loop only asks whether a preferred station exists, so those materials were left out
   * of both missing lists and simply vanished from the UI. Anything still outstanding that
   * nothing reported is reported here.
   */
  for (const [id, need] of needs) {
    if (need.tons <= 0.01) continue;
    if (missingBuyIndexed.some((m) => m.id === id)) continue;
    if (missingTripEligible.some((m) => m.id === id)) continue;
    missingTripEligible.push({ id, label: need.label, quantityTons: need.tons });
  }

  if (tripNumber >= MAX_TRIPS && totalNeedTons(needs) > 0.01) {
    warnings.push(
      `Plan stopped at ${MAX_TRIPS} trips with ${Math.round(totalNeedTons(needs)).toLocaleString()} t still outstanding — raise cargo capacity or narrow the active sites.`,
    );
  }

  return {
    homeSystem: args.homeSystem,
    capacity,
    cargoOnHand,
    cargoFree,
    totalRemainingTons: totalNeedTons(needs),
    trips,
    warnings,
    missingBuyIndexed,
    missingTripEligible,
    dockBuys,
    buyStationKeyByCommodityId: Object.fromEntries(preferredBuyStationByCommodity),
  };
}
