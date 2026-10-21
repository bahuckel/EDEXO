import { useMemo } from "react";
import { compareBuyStationHits } from "../../../../shared/colonize/buyStationSort";
import { buyStationHitMatchesNeed } from "../../../../shared/colonize/buyStationHitMatch";
import { dedupeBuyStationHits } from "../../../../shared/colonize/buyStationMerge";
import { filterMaterialBuyStationHits } from "../../../../shared/colonize/logisticsPlanner";
import type { MaterialBuyListing } from "../../../../shared/colonize/materialBuyIndexTypes";
import { groupStationsSellingMultipleRemaining, type MultiBuyStationGroup } from "../../../../shared/colonize/multiBuyStations";
import { depotNeedLabel, type DepotNeedItem } from "../../../../shared/colonize/plannerDepotNeeds";
import type { BannedStation } from "../../../../shared/colonize/stationBans";
import type { MinLandingPad, StationKindFilter } from "../../../../shared/colonize/stationFilter";
import { isCommanderBuyOffer } from "../../../../shared/colonize/stationSellOffer";
import type { DepotSnapshot, LiveDockedInfo } from "../../../../shared/colonize/types";
import type { PlannerInputs } from "./useDeferredPlannerInputs";

export type MergedListingsArgs = {
  depotNeeds: DepotNeedItem[];
  /** Already deferred — see useDeferredPlannerInputs. */
  deferred: PlannerInputs;
  largePadOnly: boolean;
  minLandingPad: MinLandingPad | undefined;
  stationKind: StationKindFilter;
  excludeFleetCarriers: boolean;
  bannedStations: BannedStation[];
  docked: LiveDockedInfo;
  dockMarketSystem: string | undefined;
  activeDepots: DepotSnapshot[] | undefined;
  constructionRefSystems: string[];
  constructionSite: string;
  includeAllPlanetaryAndGround: boolean;
};

export type MergedListings = {
  /** One card per depot need, with the sellers that survive the filters, nearest-first. */
  listings: MaterialBuyListing[];
  /** marketId → orbiting body, so trip stops can name a body the plan itself does not carry. */
  bodyNameByMarketId: Map<string, string>;
  multiBuyGroups: MultiBuyStationGroup[];
  /** Distinct buy stations across the cards and the checkout catalogue. */
  stationCount: number;
};

/**
 * The buy cards: every depot need, paired with the sellers that pass the station filters,
 * deduped and ordered by the same preference the planner routes with.
 */
export function useMergedListings({
  depotNeeds,
  deferred,
  largePadOnly,
  minLandingPad,
  stationKind,
  excludeFleetCarriers,
  bannedStations,
  docked,
  dockMarketSystem,
  activeDepots,
  constructionRefSystems,
  constructionSite,
  includeAllPlanetaryAndGround,
}: MergedListingsArgs): MergedListings {
  const buyStationFilter = useMemo(
    () => ({
      largePadOnly,
      minLandingPad,
      stationKind,
      excludeFleetCarriers,
      maxDistanceLy: null,
      bannedStations,
      dockedStation: docked
        ? {
            stationName: docked.stationName,
            systemName: docked.starSystem?.trim() || dockMarketSystem || "",
          }
        : null,
      constructionSystems: constructionRefSystems,
      constructionDepots: activeDepots ?? [],
      includeAllPlanetaryAndGround,
      shopHistory: deferred.shopHistory,
    }),
    [
      largePadOnly,
      minLandingPad,
      stationKind,
      excludeFleetCarriers,
      bannedStations,
      docked,
      dockMarketSystem,
      activeDepots,
      constructionRefSystems,
      includeAllPlanetaryAndGround,
      deferred.shopHistory,
    ],
  );

  const listings = useMemo(() => {
    const byId = new Map(deferred.buyListings.map((m) => [m.id, m]));
    return depotNeeds.map((need) => {
      const label = depotNeedLabel(need);
      const hit = byId.get(need.id);
      const base = hit ?? {
        id: need.id,
        label,
        quantityNeeded: need.quantityTons,
        stations: [],
        servedFromCache: false,
      };
      const filtered = dedupeBuyStationHits(
        filterMaterialBuyStationHits(base.stations, buyStationFilter).filter((st) => {
          if (!buyStationHitMatchesNeed(need.id, label, st)) return false;
          if (!isCommanderBuyOffer(st.supply, st.buyPrice) && !st.purchaseProven) return false;
          return true;
        }),
      );
      const stations = [...filtered].sort((a, b) =>
        compareBuyStationHits(a, b, deferred.shopHistory, constructionSite, deferred.systemDistanceLy),
      );
      return {
        ...base,
        label,
        quantityNeeded: need.quantityTons,
        stations,
      };
    });
  }, [
    depotNeeds,
    deferred.buyListings,
    deferred.shopHistory,
    deferred.systemDistanceLy,
    buyStationFilter,
    constructionSite,
  ]);

  const bodyNameByMarketId = useMemo(() => {
    const map = new Map<string, string>();
    for (const mat of listings) {
      for (const st of mat.stations) {
        const mid = st.marketId?.trim();
        const body = st.bodyName?.trim();
        if (mid && body) map.set(mid, body);
      }
    }
    return map;
  }, [listings]);

  const multiBuyGroups = useMemo(() => groupStationsSellingMultipleRemaining(listings), [listings]);

  const stationCount = useMemo(() => {
    const keys = new Set<string>();
    for (const mat of listings) {
      for (const st of mat.stations) keys.add(`${st.systemName}\0${st.stationName}`);
    }
    for (const p of deferred.checkouts) {
      for (const e of p.catalogStations ?? []) keys.add(`${e.systemName}\0${e.stationName}`);
      for (const g of p.groups) keys.add(`${g.systemName}\0${g.stationName}`);
    }
    return keys.size;
  }, [deferred.checkouts, listings]);

  return { listings, bodyNameByMarketId, multiBuyGroups, stationCount };
}
