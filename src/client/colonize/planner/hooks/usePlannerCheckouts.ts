import { useEffect, useMemo, useState } from "react";
import { formatMarketAge } from "../../../../shared/colonize/marketAge";
import { buildPlannerCheckouts, depotNeedsFromProjects, type DepotNeedItem } from "../../../../shared/colonize/plannerDepotNeeds";
import { loadSavedCheckout, scheduleSaveCheckoutSnapshot, type SavedCheckout } from "../../../../shared/colonize/savedCheckout";
import { isStationBanned, type BannedStation } from "../../../../shared/colonize/stationBans";
import type { BasketCheckoutBundle, BasketCheckoutResult, DepotSnapshot } from "../../../../shared/colonize/types";
import { useNow } from "../../hooks/useNow";

export type PlannerCheckoutsArgs = {
  isActive: boolean;
  activeDepots: DepotSnapshot[] | undefined;
  cargoByKey: Map<string, number>;
  checkoutResult: BasketCheckoutResult | null;
  checkoutBundle: BasketCheckoutBundle | null;
  bannedStations: BannedStation[];
  constructionRefSystems: string[];
  constructionSiteSystems: string[];
  homeSystem: string;
  /** Bump to re-read the saved checkout after Spansh / buy-index writes. */
  buyIndexRefreshToken: number;
};

export type PlannerCheckouts = {
  depotNeeds: DepotNeedItem[];
  checkouts: BasketCheckoutResult[];
  /** Human age of the saved station data, or null when nothing is saved. */
  checkoutAge: string | null;
  checkoutStale: boolean;
};

/**
 * What the active builds still need, and the station catalogue the planner routes against —
 * the live bundle when one is loaded, otherwise the checkout snapshot kept in localStorage.
 */
export function usePlannerCheckouts({
  isActive,
  activeDepots,
  cargoByKey,
  checkoutResult,
  checkoutBundle,
  bannedStations,
  constructionRefSystems,
  constructionSiteSystems,
  homeSystem,
  buyIndexRefreshToken,
}: PlannerCheckoutsArgs): PlannerCheckouts {
  const [savedCheckout, setSavedCheckout] = useState<SavedCheckout | null>(() => loadSavedCheckout());
  // The panel is memo()-wrapped, so the saved-checkout age needs its own clock to keep moving.
  const nowMs = useNow(60_000);

  useEffect(() => {
    // Something else cleared the buy index and with it the saved checkout — drop our copy so the
    // planner does not keep routing against stations that are no longer on disk.
    if (!loadSavedCheckout()) setSavedCheckout(null);
  }, [buyIndexRefreshToken]);

  useEffect(() => {
    if (checkoutResult || checkoutBundle) {
      scheduleSaveCheckoutSnapshot(checkoutResult, checkoutBundle);
      setSavedCheckout({ savedAt: new Date().toISOString(), result: checkoutResult, bundle: checkoutBundle });
    }
  }, [checkoutResult, checkoutBundle]);

  const depotNeeds = useMemo(
    () => (activeDepots?.length ? depotNeedsFromProjects(activeDepots, cargoByKey) : []),
    [activeDepots, cargoByKey],
  );

  const checkouts = useMemo(() => {
    if (!isActive) return [];
    const bundlePlans = checkoutBundle?.plans.length
      ? checkoutBundle.plans
      : savedCheckout?.bundle?.plans.length
        ? savedCheckout.bundle.plans
        : [];
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
    savedCheckout,
    bannedStations,
    depotNeeds,
    constructionRefSystems,
    constructionSiteSystems,
    homeSystem,
  ]);

  const checkoutAge = savedCheckout ? formatMarketAge(savedCheckout.savedAt, nowMs) : null;
  const checkoutStale = savedCheckout ? nowMs - Date.parse(savedCheckout.savedAt) > 30 * 60_000 : false;

  return { depotNeeds, checkouts, checkoutAge, checkoutStale };
}
