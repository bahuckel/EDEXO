import { useMemo } from "react";
import { formatMarketAge } from "../../../../shared/colonize/marketAge";
import { buildPlannerCheckouts, depotNeedsFromProjects, type DepotNeedItem } from "../../../../shared/colonize/plannerDepotNeeds";
import { loadSavedCheckout } from "../../../../shared/colonize/savedCheckout";
import { isStationBanned, type BannedStation } from "../../../../shared/colonize/stationBans";
import type { BasketCheckoutBundle, BasketCheckoutResult, DepotSnapshot } from "../../../../shared/colonize/types";
import { useNow } from "../../hooks/useNow";

export type PlannerCheckoutsArgs = {
  isActive: boolean;
  activeDepots: DepotSnapshot[] | undefined;
  cargoByKey: Map<string, number>;
  /** The sellers usePlannerStations holds: loaded from the saved checkout at start, saved by it whenever they change. */
  checkoutBundle: BasketCheckoutBundle | null;
  bannedStations: BannedStation[];
  constructionRefSystems: string[];
  constructionSiteSystems: string[];
  homeSystem: string;
};

export type PlannerCheckouts = {
  depotNeeds: DepotNeedItem[];
  checkouts: BasketCheckoutResult[];
  /** Human age of the saved station data, or null when nothing is saved. */
  checkoutAge: string | null;
  checkoutStale: boolean;
};

/**
 * What the active builds still need, and the station catalogue the planner routes against: the sellers
 * usePlannerStations holds (the saved checkout until it gathers new ones).
 */
export function usePlannerCheckouts({
  isActive,
  activeDepots,
  cargoByKey,
  checkoutBundle,
  bannedStations,
  constructionRefSystems,
  constructionSiteSystems,
  homeSystem,
}: PlannerCheckoutsArgs): PlannerCheckouts {
  // The age below has to move on while nothing re-renders the plan, so it has its own clock.
  const nowMs = useNow(60_000);

  /*
    When the sellers were gathered: the stamp usePlannerStations put on the saved copy as it took them in. This hook
    used to save the bundle again itself, on every mount of the Plan tab too: 50-500 KB written per tab switch, and
    "Sellers last gathered" reset to "just now" each time, so "(getting old)" never showed (audit 2026-10-22).
  */
  const savedAt = useMemo(() => (checkoutBundle ? (loadSavedCheckout()?.savedAt ?? null) : null), [checkoutBundle]);

  const depotNeeds = useMemo(
    () => (activeDepots?.length ? depotNeedsFromProjects(activeDepots, cargoByKey) : []),
    [activeDepots, cargoByKey],
  );

  const checkouts = useMemo(() => {
    if (!isActive) return [];
    const bundlePlans = checkoutBundle?.plans ?? [];
    const fallbackRef = constructionRefSystems[0] || homeSystem || "";
    const raw = buildPlannerCheckouts({ depotNeeds, bundlePlans, fallbackReferenceSystem: fallbackRef });
    return raw.map((plan, i) => ({
      ...plan,
      constructionSiteSystem:
        constructionSiteSystems[i]?.trim() ||
        plan.constructionSiteSystem?.trim() ||
        constructionSiteSystems[0]?.trim() ||
        "",
      catalogStations: (plan.catalogStations ?? []).filter(
        (e) => !isStationBanned(bannedStations, e.systemName, e.stationName),
      ),
      groups: (plan.groups ?? []).filter(
        (g) => !isStationBanned(bannedStations, g.systemName, g.stationName),
      ),
    }));
  }, [
    isActive,
    checkoutBundle,
    bannedStations,
    depotNeeds,
    constructionRefSystems,
    constructionSiteSystems,
    homeSystem,
  ]);

  const checkoutAge = savedAt ? formatMarketAge(savedAt, nowMs) : null;
  const checkoutStale = savedAt ? nowMs - Date.parse(savedAt) > 30 * 60_000 : false;

  return { depotNeeds, checkouts, checkoutAge, checkoutStale };
}
