import { colonizeApi } from "../api";
import { useEffect, useMemo, useRef, useState, startTransition } from "react";
import type { BasketCheckoutBundle, BasketCheckoutResult } from "../../../shared/colonize/types";
import {
  collectGalaxyDistanceTargets,
  filterUnresolvedGalaxyDistanceTargets,
} from "../../../shared/colonize/galaxyDistanceTargets";
import {
  loadGalaxyDistanceCache,
  saveGalaxyDistanceCache,
  sanitizeGalaxyDistanceMap,
} from "../../../shared/colonize/systemDistanceLy";
import type { ShopHistoryEntry } from "../../../shared/colonize/shopHistory";

/**
 * Names the backend could not resolve stay in the missing-targets list forever, so without a
 * memory of what was already asked for they would be re-requested on every effect run. The TTL
 * keeps a later retry possible (the backend may learn the system from a newer dump).
 */
const DISTANCE_ATTEMPT_TTL_MS = 10 * 60 * 1000;

export function useGalaxyDistances(args: {
  api: typeof colonizeApi;
  constructionSiteRefs: string[];
  effectiveShopHistory: ShopHistoryEntry[];
  checkoutResult: BasketCheckoutResult | null;
  checkoutBundle: BasketCheckoutBundle | null;
  extraSellerSystems?: string[];
}) {
  const { api, constructionSiteRefs, effectiveShopHistory, checkoutResult, checkoutBundle, extraSellerSystems } =
    args;
  const [systemDistanceLy, setSystemDistanceLy] = useState<Record<string, number>>(() => loadGalaxyDistanceCache());
  const [distancesLoading, setDistancesLoading] = useState(false);
  const [distanceResolveErr, setDistanceResolveErr] = useState<string | null>(null);
  const distanceResolveInflightRef = useRef(0);
  const attemptedTargetsRef = useRef<Map<string, number>>(new Map());

  // The resolve effect must not depend on the distance map identity: every resolve writes a new
  // object, which would otherwise restart the effect and re-request the same names in a loop.
  const systemDistanceLyRef = useRef(systemDistanceLy);
  useEffect(() => {
    systemDistanceLyRef.current = systemDistanceLy;
  }, [systemDistanceLy]);

  const constructionSiteRefsRef = useRef(constructionSiteRefs);
  useEffect(() => {
    constructionSiteRefsRef.current = constructionSiteRefs;
  }, [constructionSiteRefs]);

  const missingTargetsRef = useRef<string[]>([]);

  const constructionSitesSig = useMemo(
    () =>
      constructionSiteRefs
        .map((s) => s.trim())
        .filter(Boolean)
        .sort()
        .join("\0"),
    [constructionSiteRefs],
  );

  const galaxyDistanceTargets = useMemo(
    () =>
      collectGalaxyDistanceTargets({
        shopHistory: effectiveShopHistory,
        checkoutResult,
        checkoutBundle,
        constructionRefs: constructionSiteRefs,
        extraSellerSystems,
      }),
    [effectiveShopHistory, checkoutResult, checkoutBundle, constructionSiteRefs, extraSellerSystems],
  );

  const missingGalaxyDistanceTargets = useMemo(() => {
    const merged = sanitizeGalaxyDistanceMap({
      ...loadGalaxyDistanceCache(),
      ...systemDistanceLy,
    });
    return filterUnresolvedGalaxyDistanceTargets(constructionSiteRefs, galaxyDistanceTargets, merged);
  }, [constructionSiteRefs, galaxyDistanceTargets, systemDistanceLy]);

  const distanceResolveSig = useMemo(() => {
    const to = [...missingGalaxyDistanceTargets].sort().join("\0");
    return `${constructionSitesSig}→${to}`;
  }, [constructionSitesSig, missingGalaxyDistanceTargets]);

  // Declared before the resolve effect so the ref is current by the time that effect reads it.
  useEffect(() => {
    missingTargetsRef.current = missingGalaxyDistanceTargets;
  }, [missingGalaxyDistanceTargets]);

  useEffect(() => {
    if (!constructionSitesSig) return;
    const cached = loadGalaxyDistanceCache();
    if (!Object.keys(cached).length) return;
    startTransition(() => {
      setSystemDistanceLy((prev) => sanitizeGalaxyDistanceMap({ ...cached, ...prev }));
    });
  }, [constructionSitesSig]);

  useEffect(() => {
    if (!api?.resolveSystemDistances) {
      setDistancesLoading(false);
      return;
    }
    const fromSystems = constructionSiteRefsRef.current;
    if (!fromSystems.length) {
      setDistancesLoading(false);
      return;
    }
    const now = Date.now();
    const attempted = attemptedTargetsRef.current;
    for (const [name, at] of attempted) {
      if (now - at >= DISTANCE_ATTEMPT_TTL_MS) attempted.delete(name);
    }
    const toSystems = missingTargetsRef.current.filter((name) => !attempted.has(name));
    if (!toSystems.length) {
      setDistancesLoading(false);
      return;
    }
    let cancelled = false;
    const CHUNK = 80;
    const timer = window.setTimeout(() => {
      distanceResolveInflightRef.current += 1;
      setDistancesLoading(true);
      void (async () => {
        try {
          let merged = sanitizeGalaxyDistanceMap({
            ...loadGalaxyDistanceCache(),
            ...systemDistanceLyRef.current,
          });
          let lastErr: string | null = null;
          for (let i = 0; i < toSystems.length; i += CHUNK) {
            if (cancelled) return;
            const chunk = toSystems.slice(i, i + CHUNK);
            // Record the attempt before awaiting: a name the backend cannot resolve must not be
            // asked for again on the next effect run, or the request repeats forever.
            const attemptedAt = Date.now();
            for (const name of chunk) attemptedTargetsRef.current.set(name, attemptedAt);
            const res = await api.resolveSystemDistances({
              fromSystems,
              toSystems: chunk,
            });
            if (!res.ok) {
              // A transport-level failure says nothing about the names, so let them be retried.
              for (const name of chunk) attemptedTargetsRef.current.delete(name);
              lastErr = res.err;
              continue;
            }
            merged = sanitizeGalaxyDistanceMap({
              ...merged,
              ...res.distances,
            });
          }
          if (cancelled) return;
          startTransition(() => {
            setSystemDistanceLy(merged);
            setDistanceResolveErr(lastErr);
          });
          saveGalaxyDistanceCache(merged);
        } catch (e) {
          if (!cancelled) {
            startTransition(() => setDistanceResolveErr(e instanceof Error ? e.message : String(e)));
          }
        } finally {
          distanceResolveInflightRef.current = Math.max(0, distanceResolveInflightRef.current - 1);
          if (distanceResolveInflightRef.current === 0) setDistancesLoading(false);
        }
      })();
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [distanceResolveSig, api]);

  return {
    systemDistanceLy,
    setSystemDistanceLy,
    distancesLoading,
    distanceResolveErr,
    galaxyDistanceTargets,
    missingGalaxyDistanceTargets,
  };
}
