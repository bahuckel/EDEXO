import { colonizeApi } from "../../api";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errText } from "../../../../shared/colonize/formatPrice";
import { enrichMaterialListingsGalaxyLy } from "../../../../shared/colonize/galaxyDistanceTargets";
import type { MissingBuyIndexedItem } from "../../../../shared/colonize/logisticsPlanner";
import type { MaterialBuyListing } from "../../../../shared/colonize/materialBuyIndexTypes";
import { depotNeedLabel, type DepotNeedItem } from "../../../../shared/colonize/plannerDepotNeeds";
import type { DepotSnapshot } from "../../../../shared/colonize/types";
import { useDebouncedValue } from "./useDebouncedValue";

export type DepotBuyListingsArgs = {
  isActive: boolean;
  depotNeeds: DepotNeedItem[];
  activeDepots: DepotSnapshot[] | undefined;
  constructionRefSystems: string[];
  constructionSiteSystems: string[];
  homeSystem: string;
  systemDistanceLy: Record<string, number>;
  /** Bump to re-fetch getDepotMaterialListings after Spansh / buy-index writes. */
  buyIndexRefreshToken: number;
};

export type DepotBuyListings = {
  listings: MaterialBuyListing[];
  /** False until the first fetch lands — the planner must not treat "no sellers" as final before then. */
  listingsReady: boolean;
  listingsLoading: boolean;
  /** Material id currently being fetched by the per-material "Saved sellers" button. */
  localFetchingId: string | null;
  fetchMissingMaterialLocally: (item: MissingBuyIndexedItem) => Promise<void>;
  /**
   * Why the saved sellers came back empty or failed ("not found in range", the server's error), or null. Held here so
   * the view only has to show it: it went to an optional callback nobody passed, and "Saved sellers" failed silently
   * (audit 2026-10-22).
   */
  localFetchNotice: string | null;
};

/**
 * The sellers the trip routing starts from: the server's buy index and journal (the same as Search and the Inara
 * import use).
 *
 * The fetch is keyed on signatures rather than object identity, so a new array of the same needs
 * does not fire another round trip to the server.
 */
export function useDepotBuyListings({
  isActive,
  depotNeeds,
  activeDepots,
  constructionRefSystems,
  constructionSiteSystems,
  homeSystem,
  systemDistanceLy,
  buyIndexRefreshToken,
}: DepotBuyListingsArgs): DepotBuyListings {
  const [indexListings, setIndexListings] = useState<MaterialBuyListing[]>([]);
  const [indexListingsReady, setIndexListingsReady] = useState(false);
  const [indexListingsLoading, setIndexListingsLoading] = useState(false);
  const [localFetchingId, setLocalFetchingId] = useState<string | null>(null);
  const [localFetchNotice, setLocalFetchNotice] = useState<string | null>(null);

  const indexListingsReadyRef = useRef(false);
  indexListingsReadyRef.current = indexListingsReady;
  const indexFetchGenRef = useRef(0);

  const debouncedDistanceLy = useDebouncedValue(systemDistanceLy, 2000);

  const depotNeedsSig = useMemo(
    () =>
      depotNeeds
        .map((n) => `${n.id}:${depotNeedLabel(n)}`)
        .sort()
        .join("|"),
    [depotNeeds],
  );
  const constructionRefSig = constructionRefSystems
    .map((s) => s.trim())
    .filter(Boolean)
    .join("|");
  const constructionSiteSig = constructionSiteSystems
    .map((s) => s.trim())
    .filter(Boolean)
    .join("|");
  const depotMarketSig = (activeDepots ?? []).map((d) => d.marketId).join("|");

  /** Where the sellers are looked up from and measured to, and which stations are sites (never sellers). */
  const scope = useMemo(() => {
    const ref = constructionRefSystems[0]?.trim() || constructionSiteSystems[0]?.trim() || homeSystem;
    const site = constructionSiteSystems[0]?.trim() || ref;
    const depots = (activeDepots ?? []).map((d) => ({
      marketId: d.marketId,
      systemName: d.starSystem,
      stationName: d.stationName,
      label: d.constructionSiteLabel ?? d.stationName,
    }));
    return { ref, site, depots };
  }, [constructionRefSystems, constructionSiteSystems, homeSystem, activeDepots]);

  const fetchMissingMaterialLocally = useCallback(
    async (item: MissingBuyIndexedItem) => {
      const { ref, site, depots } = scope;
      if (!ref) return;

      setLocalFetchingId(item.id);
      setLocalFetchNotice(null);
      try {
        const res = await colonizeApi.getDepotMaterialListings({
          referenceSystem: ref,
          distanceOrigin: site,
          needs: [{ id: item.id, label: item.label, quantityTons: item.quantityTons }],
          constructionDepots: depots,
          distanceBySystem: systemDistanceLy,
        });
        if (!res.ok) {
          setLocalFetchNotice(res.err);
          return;
        }
        let listing = res.listings.find((m) => m.id === item.id) ?? res.listings[0];
        if (!listing?.stations.length) {
          setLocalFetchNotice(`Material not found in scan range, use Inara to find the closest one — ${item.label}.`);
          return;
        }
        if (site && Object.keys(systemDistanceLy).length) {
          listing = enrichMaterialListingsGalaxyLy([listing], site, systemDistanceLy)[0] ?? listing;
        }
        startTransition(() => {
          setIndexListings((prev) => {
            const rest = prev.filter((m) => m.id !== item.id);
            return [...rest, listing!].sort((a, b) => a.label.localeCompare(b.label));
          });
        });
        setLocalFetchNotice(null);
      } catch (e) {
        // A rejected request used to escape to the error boundary, which took the whole planner
        // panel down over one material that could not be looked up.
        setLocalFetchNotice(`Could not look up ${item.label}: ${errText(e)}`);
      } finally {
        setLocalFetchingId(null);
      }
    },
    [scope, systemDistanceLy],
  );

  useEffect(() => {
    if (!isActive) return;
    if (!depotNeeds.length) {
      setIndexListings([]);
      setIndexListingsReady(false);
      setIndexListingsLoading(false);
      return;
    }
    const { ref, site, depots } = scope;
    if (!ref) return;

    const gen = ++indexFetchGenRef.current;
    const firstLoad = !indexListingsReadyRef.current;
    if (firstLoad) setIndexListingsLoading(true);

    void (async () => {
      try {
        const res = await colonizeApi.getDepotMaterialListings({
          referenceSystem: ref,
          distanceOrigin: site,
          needs: depotNeeds.map((need) => ({
            id: need.id,
            label: depotNeedLabel(need),
            quantityTons: need.quantityTons,
          })),
          constructionDepots: depots,
          distanceBySystem: systemDistanceLy,
        });
        if (gen !== indexFetchGenRef.current) return;
        if (!res.ok) {
          // This was a bare return: the buy list simply stayed empty and said nothing about why.
          setLocalFetchNotice(res.err);
          return;
        }
        let listings = res.listings;
        if (site && Object.keys(systemDistanceLy).length) {
          listings = enrichMaterialListingsGalaxyLy(listings, site, systemDistanceLy);
        }
        startTransition(() => {
          setIndexListings(listings);
          setIndexListingsReady(true);
        });
        setLocalFetchNotice(null);
      } catch (e) {
        if (gen === indexFetchGenRef.current) setLocalFetchNotice(`Could not load saved buy locations: ${errText(e)}`);
      } finally {
        if (gen === indexFetchGenRef.current) setIndexListingsLoading(false);
      }
    })();
    // Keyed by the *Sig strings: the arrays they summarise are new every snapshot, and distances are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isActive,
    depotNeedsSig,
    constructionRefSig,
    constructionSiteSig,
    depotMarketSig,
    homeSystem,
    buyIndexRefreshToken,
  ]);

  useEffect(() => {
    const site = constructionSiteSystems[0]?.trim() || constructionRefSystems[0]?.trim() || homeSystem;
    if (!indexListingsReady || !site || !Object.keys(debouncedDistanceLy).length) return;
    startTransition(() => {
      setIndexListings((prev) =>
        prev.length ? enrichMaterialListingsGalaxyLy(prev, site, debouncedDistanceLy) : prev,
      );
    });
  }, [debouncedDistanceLy, constructionSiteSystems, constructionRefSystems, homeSystem, indexListingsReady]);

  return {
    listings: indexListings,
    listingsReady: indexListingsReady,
    listingsLoading: indexListingsLoading,
    localFetchingId,
    fetchMissingMaterialLocally,
    localFetchNotice,
  };
}
