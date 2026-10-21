import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SystemCoordsByNorm } from "../../../../shared/colonize/galaxyDistanceCompute";
import { buildLogisticsPlan, type LogisticsPlan } from "../../../../shared/colonize/logisticsPlanner";
import type { BannedStation } from "../../../../shared/colonize/stationBans";
import type { MinLandingPad, StationKindFilter } from "../../../../shared/colonize/stationFilter";
import { formatHopLy } from "../../../../shared/colonize/systemDistanceLy";
import {
  adoptLegacyDepotIds,
  createTripPlanSnapshot,
  loadTripPlanSnapshot,
  planRefreshFingerprint,
  resolveDisplayLogisticsPlan,
  scheduleSaveTripPlanSnapshot,
  syncTripLineCompletions,
  type TripPlanSnapshot,
} from "../../../../shared/colonize/tripPlanProgress";
import type { DepotSnapshot, LiveDockedInfo } from "../../../../shared/colonize/types";
import type { WingMember } from "../../../../shared/colonize/wingManifest";
import type { PlannerInputs } from "./useDeferredPlannerInputs";

export type LogisticsPlanArgs = {
  isActive: boolean;
  /** Already deferred — see useDeferredPlannerInputs. */
  deferred: PlannerInputs;
  listingsReady: boolean;
  /** S-13 seller coordinates, and whether the first plan may be built yet — see usePlannerSystemCoords. */
  systemCoords: SystemCoordsByNorm;
  coordsReady: boolean;
  activeDepots: DepotSnapshot[] | undefined;
  docked: LiveDockedInfo;
  dockMarketSystem: string | undefined;
  effectiveCapacity: number | null;
  wing: WingMember[];
  bannedStations: BannedStation[];
  homeSystem: string;
  includeAllPlanetaryAndGround: boolean;
  largePadOnly: boolean;
  minLandingPad: MinLandingPad | undefined;
  stationKind: StationKindFilter;
  excludeFleetCarriers: boolean;
  maxDistanceLy: number | null;
  constructionSiteSystems: string[];
  /** Bump to re-read the pinned trip snapshot after Spansh / buy-index writes. */
  buyIndexRefreshToken: number;
};

export type LogisticsPlanState = {
  /** The freshly built plan — null while there is nothing to plan. */
  plan: LogisticsPlan | null;
  /** What the trips render from: the live plan, or the pinned snapshot when the live one is empty. */
  displayPlan: LogisticsPlan | null;
  completedLineIds: Set<string>;
  /** Commodity ids the current trips already buy — used to mark buy cards as planned. */
  tripMaterialIds: Set<string>;
  toggleTripLine: (lineId: string) => void;
};

/**
 * Builds the haul plan, keeps the pinned snapshot that survives a momentarily empty rebuild, and
 * owns the per-line "done" ticks.
 */
export function useLogisticsPlan({
  isActive,
  deferred,
  listingsReady,
  systemCoords,
  coordsReady,
  activeDepots,
  docked,
  dockMarketSystem,
  effectiveCapacity,
  wing,
  bannedStations,
  homeSystem,
  includeAllPlanetaryAndGround,
  largePadOnly,
  minLandingPad,
  stationKind,
  excludeFleetCarriers,
  maxDistanceLy,
  constructionSiteSystems,
  buyIndexRefreshToken,
}: LogisticsPlanArgs): LogisticsPlanState {
  const [tripSnapshot, setTripSnapshot] = useState<TripPlanSnapshot | null>(() => loadTripPlanSnapshot());

  // Lets the trip-line toggle build the next snapshot outside the state updater, which must stay
  // pure: StrictMode double-invokes updaters and would schedule the localStorage save twice.
  const tripSnapshotRef = useRef(tripSnapshot);
  useEffect(() => {
    tripSnapshotRef.current = tripSnapshot;
  }, [tripSnapshot]);

  useEffect(() => {
    // The pinned plan was cleared on disk along with the buy index — drop our copy too, or the
    // trips would keep showing stations that no longer exist.
    if (!loadTripPlanSnapshot()) setTripSnapshot(null);
  }, [buyIndexRefreshToken]);

  /**
   * S-8: a snapshot saved before sites were keyed by market id names them by label. Resolve it
   * once the sites have arrived, carry the manual ticks across, and save it in the new shape.
   */
  useEffect(() => {
    if (!tripSnapshot?.legacyDepotLabels || !activeDepots?.length) return;
    const adopted = adoptLegacyDepotIds(tripSnapshot, activeDepots);
    tripSnapshotRef.current = adopted;
    scheduleSaveTripPlanSnapshot(adopted);
    setTripSnapshot(adopted);
  }, [tripSnapshot, activeDepots]);

  const checkoutsSig = useMemo(
    () =>
      deferred.checkouts
        .map(
          (c) =>
            `${c.referenceSystem}:${(c.materialListings ?? [])
              .map((m) => {
                const top = m.stations[0];
                const topKey = top
                  ? `${top.systemName}:${top.stationName}:${top.marketId ?? ""}:${formatHopLy(top.distanceLy)}`
                  : "";
                return `${m.id}:${topKey}:${m.stations.length}`;
              })
              .sort()
              .join(",")}`,
        )
        .join("|"),
    [deferred.checkouts],
  );

  /**
   * Everything besides the depots and the checkouts that changes the shape of a plan.
   * Without it, changing a filter left the pinned snapshot in place — and a pinned plan is
   * preferred whenever the live one has no trips, so the screen could keep showing a plan
   * built under filters that no longer applied.
   */
  const planConstraintsSig = useMemo(
    () =>
      [
        `pad:${minLandingPad ?? ""}`,
        `kind:${stationKind ?? ""}`,
        `fc:${excludeFleetCarriers ? 1 : 0}`,
        `ground:${includeAllPlanetaryAndGround ? 1 : 0}`,
        `maxly:${maxDistanceLy ?? ""}`,
        `ban:${bannedStations
          .map((b) => `${b.systemName}/${b.stationName}`)
          .sort()
          .join(",")}`,
        `wing:${wing
          .flatMap((m) => m.claims.map((c) => `${c.commodityId}:${c.tons}:${c.targetDepotMarketId ?? ""}`))
          .sort()
          .join(",")}`,
      ].join("|"),
    [
      minLandingPad,
      stationKind,
      excludeFleetCarriers,
      includeAllPlanetaryAndGround,
      maxDistanceLy,
      bannedStations,
      wing,
    ],
  );

  const planRefreshKey = useMemo(() => {
    if (!activeDepots?.length) return "";
    return planRefreshFingerprint(activeDepots, effectiveCapacity, checkoutsSig, planConstraintsSig);
  }, [activeDepots, effectiveCapacity, checkoutsSig, planConstraintsSig]);

  const plan = useMemo(() => {
    if (!isActive || !activeDepots?.length || !coordsReady) return null;
    return buildLogisticsPlan({
      checkouts: deferred.checkouts,
      buyListings: listingsReady ? deferred.buyListings : undefined,
      activeDepots,
      cargoByKey: deferred.cargoByKey,
      cargoCapacity: effectiveCapacity,
      wing,
      shopHistory: deferred.shopHistory,
      bannedStations,
      homeSystem,
      dockedStation: docked
        ? { stationName: docked.stationName, systemName: docked.starSystem?.trim() || dockMarketSystem || "" }
        : null,
      includeAllPlanetaryAndGround,
      largePadOnly,
      minLandingPad,
      stationKind,
      excludeFleetCarriers,
      maxDistanceLy,
      systemDistanceLy: deferred.systemDistanceLy,
      constructionDistanceSystems: constructionSiteSystems,
      systemCoords,
    });
  }, [
    isActive,
    coordsReady,
    systemCoords,
    activeDepots,
    dockMarketSystem,
    deferred,
    wing,
    constructionSiteSystems,
    bannedStations,
    homeSystem,
    docked,
    listingsReady,
    effectiveCapacity,
    includeAllPlanetaryAndGround,
    largePadOnly,
    minLandingPad,
    stationKind,
    excludeFleetCarriers,
    maxDistanceLy,
  ]);

  const displayPlan = useMemo(
    () =>
      resolveDisplayLogisticsPlan({
        live: plan,
        snapshot: tripSnapshot,
        planRefreshKey,
        hasActiveDepots: (activeDepots?.length ?? 0) > 0,
      }),
    [plan, tripSnapshot, planRefreshKey, activeDepots?.length],
  );

  const completedLineIds = useMemo(() => {
    if (!tripSnapshot || !activeDepots?.length || !displayPlan) return new Set<string>();
    return new Set(
      syncTripLineCompletions(
        { ...tripSnapshot, plan: displayPlan },
        activeDepots,
        deferred.cargoByKey,
        tripSnapshot.manualCompletedLineIds,
      ),
    );
  }, [tripSnapshot, activeDepots, deferred.cargoByKey, displayPlan]);

  const lastPersistedPlanKeyRef = useRef("");
  useEffect(() => {
    if (!activeDepots?.length || !planRefreshKey || !plan) return;
    if (lastPersistedPlanKeyRef.current === planRefreshKey) return;
    if (!plan.trips.length) return;
    lastPersistedPlanKeyRef.current = planRefreshKey;
    /**
     * The snapshot on disk is already this plan: keep it, and the ticks in it. The ref above
     * starts empty on every mount, so without this check each app start replaced the saved
     * snapshot with a fresh one and every manual tick was lost.
     */
    if (tripSnapshotRef.current?.planRefreshKey === planRefreshKey) return;
    const fresh = createTripPlanSnapshot(plan, planRefreshKey, activeDepots);
    startTransition(() => {
      setTripSnapshot(fresh);
      scheduleSaveTripPlanSnapshot(fresh);
    });
  }, [planRefreshKey, plan, activeDepots]);

  const toggleTripLine = useCallback((lineId: string) => {
    const prev = tripSnapshotRef.current;
    if (!prev) return;
    const set = new Set(prev.manualCompletedLineIds);
    if (set.has(lineId)) set.delete(lineId);
    else set.add(lineId);
    const next = { ...prev, manualCompletedLineIds: [...set] };
    // Advance the ref right away so two quick clicks both build on the latest snapshot, rather
    // than on the state the ref-sync effect has not written back yet.
    tripSnapshotRef.current = next;
    scheduleSaveTripPlanSnapshot(next);
    startTransition(() => setTripSnapshot(next));
  }, []);

  const tripMaterialIds = useMemo(() => {
    const ids = new Set<string>();
    if (!displayPlan?.trips.length) return ids;
    for (const trip of displayPlan.trips) {
      for (const stop of trip.stops) {
        if (stop.kind !== "buy") continue;
        for (const b of stop.buys) ids.add(b.commodityId);
      }
    }
    return ids;
  }, [displayPlan]);

  return { plan, displayPlan, completedLineIds, tripMaterialIds, toggleTripLine };
}
