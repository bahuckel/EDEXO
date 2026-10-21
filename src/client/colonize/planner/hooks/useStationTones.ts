import { useCallback, useEffect, useMemo, useRef } from "react";
import type { HaulTrip, TripStop } from "../../../../shared/colonize/logisticsPlanner";
import type { MaterialBuyListing } from "../../../../shared/colonize/materialBuyIndexTypes";
import { commodityToneByBuyStation, toneForStation } from "../../../../shared/colonize/mergeCheckoutPlans";
import {
  buildStationColorAssignments,
  buildStationToneMap,
  loadStationToneRegistry,
  saveStationToneRegistry,
  stationNameKey,
  type StationRef,
  type StationToneRegistry,
} from "../../../../shared/colonize/stationToneRegistry";
import type { LiveDockedInfo } from "../../../../shared/colonize/types";

export type StationTonesArgs = {
  listings: MaterialBuyListing[];
  trips: HaulTrip[] | undefined;
  docked: LiveDockedInfo;
  dockMarketSystem: string | undefined;
};

export type StationTones = {
  /** commodityId → palette slot of the station its buy card points at. */
  materialTones: Map<string, number>;
  resolveStationTone: (systemName: string, stationName: string, marketId?: string | null) => number | null;
  tripCommodityBuyStop: (trip: HaulTrip, commodityId: string) => TripStop | null;
  tripCommodityBuyTone: (trip: HaulTrip, commodityId: string) => number | null;
};

/** The lookups a trip needs to colour its stops — the buy cards keep the rest. */
export type TripToneLookups = Pick<
  StationTones,
  "resolveStationTone" | "tripCommodityBuyStop" | "tripCommodityBuyTone"
>;

/**
 * One palette slot per station, stable across sessions, so a buy card and the trip stop that
 * fills it wear the same colour.
 */
export function useStationTones({
  listings,
  trips,
  docked,
  dockMarketSystem,
}: StationTonesArgs): StationTones {
  const stationRefs = useMemo(() => {
    const refs: StationRef[] = [];
    const seen = new Set<string>();
    const add = (systemName: string, stationName: string, marketId?: string | null) => {
      const name = stationNameKey(stationName);
      if (!name || seen.has(name)) return;
      seen.add(name);
      refs.push({ systemName, stationName, marketId });
    };
    for (const mat of listings) {
      const nearest = mat.stations[0];
      if (nearest) add(nearest.systemName, nearest.stationName, nearest.marketId);
    }
    for (const trip of trips ?? []) {
      for (const stop of trip.stops) {
        if (stop.kind !== "buy") continue;
        add(stop.systemName, stop.stationName, stop.marketId);
      }
    }
    if (docked) {
      add(docked.starSystem?.trim() || dockMarketSystem || "", docked.stationName, docked.marketId);
    }
    return refs;
  }, [listings, trips, docked, dockMarketSystem]);

  // Reading the registry as useRef(loadStationToneRegistry()) parsed localStorage on every render
  // and threw all but the first result away, so it is created on first use instead.
  const toneRegistryRef = useRef<StationToneRegistry | null>(null);
  if (!toneRegistryRef.current) toneRegistryRef.current = loadStationToneRegistry();

  const stationColorPlan = useMemo(() => {
    const persisted = toneRegistryRef.current ?? loadStationToneRegistry();
    const { assignments, order, changed } = buildStationColorAssignments(
      stationRefs,
      persisted.assignments,
      persisted.order,
    );
    return {
      assignments,
      order,
      stationTones: buildStationToneMap(stationRefs, assignments),
      changed,
    };
  }, [stationRefs]);

  // Assignments only ever grow, so the registry can be advanced here rather than from the memo:
  // a render React throws away must not be able to hand the next one slots nobody saw. Persisting
  // on stationColorPlan.changed alone would lose writes for the same reason the memo cannot be
  // trusted to fire once, so compare the committed assignments against the last thing written.
  const lastSavedToneRegistryRef = useRef("");
  useEffect(() => {
    toneRegistryRef.current = {
      assignments: stationColorPlan.assignments,
      order: stationColorPlan.order,
    };
    const key = JSON.stringify({ a: stationColorPlan.assignments, o: stationColorPlan.order });
    if (key === lastSavedToneRegistryRef.current) return;
    lastSavedToneRegistryRef.current = key;
    saveStationToneRegistry({
      assignments: stationColorPlan.assignments,
      order: stationColorPlan.order,
    });
  }, [stationColorPlan]);

  const materialTones = useMemo(
    () => commodityToneByBuyStation(listings, stationColorPlan.stationTones, stationColorPlan.assignments),
    [listings, stationColorPlan],
  );

  const resolveStationTone = useCallback(
    (systemName: string, stationName: string, marketId?: string | null): number | null =>
      toneForStation(
        stationColorPlan.stationTones,
        systemName,
        stationName,
        marketId,
        stationColorPlan.assignments,
      ),
    [stationColorPlan],
  );

  const tripCommodityBuyStop = useCallback((trip: HaulTrip, commodityId: string) => {
    for (const stop of trip.stops) {
      if (stop.kind !== "buy") continue;
      if (!stop.buys.some((b) => b.commodityId === commodityId)) continue;
      return stop;
    }
    return null;
  }, []);

  const tripCommodityBuyTone = useCallback(
    (trip: HaulTrip, commodityId: string): number | null => {
      const stop = tripCommodityBuyStop(trip, commodityId);
      if (stop) return resolveStationTone(stop.systemName, stop.stationName, stop.marketId);
      return materialTones.get(commodityId) ?? null;
    },
    [tripCommodityBuyStop, resolveStationTone, materialTones],
  );

  return {
    materialTones,
    resolveStationTone,
    tripCommodityBuyStop,
    tripCommodityBuyTone,
  };
}
