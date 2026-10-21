import { colonizeApi } from "../../api";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GalaxyCoords, SystemCoordsByNorm } from "../../../../shared/colonize/galaxyDistanceCompute";
import { normSystemName } from "../../../../shared/colonize/stationFilter";
import type { PlannerInputs } from "./useDeferredPlannerInputs";

/**
 * How long the plan waits for coordinates before building without them. Warm, the main process
 * answers from its saved file in milliseconds; cold, a few hundred systems are a few EDSM batches.
 */
const COORDS_WAIT_MS = 3000;

/** Matches the main-side cap in `checkoutHandlers.ts`. */
const COORDS_REQUEST_CAP = 400;

/** A system main could not place is asked about again after this long. */
const COORDS_RETRY_MS = 10 * 60 * 1000;

/** Every system the planner can put a buy stop in: the listings it routes over, then shop history. */
type SellerSources = Pick<PlannerInputs, "checkouts" | "buyListings" | "shopHistory">;

function plannerSystems(inputs: SellerSources): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string | undefined) => {
    const norm = raw ? normSystemName(raw) : "";
    if (!norm || seen.has(norm)) return;
    seen.add(norm);
    out.push(raw!.trim());
  };
  for (const m of inputs.buyListings) for (const h of m.stations) add(h.systemName);
  for (const c of inputs.checkouts) {
    for (const m of c.materialListings ?? []) for (const h of m.stations) add(h.systemName);
    for (const e of c.catalogStations ?? []) add(e.systemName);
  }
  for (const h of inputs.shopHistory) add(h.systemName);
  return out;
}

/**
 * S-13: coordinates for the planner's seller-to-seller legs.
 *
 * `ready` holds the first plan back until the coordinates for its sellers have been asked for
 * (or {@link COORDS_WAIT_MS} has passed). Without it every app start built the plan from radial
 * distances and re-ordered it a moment later, so a stop the commander had ticked could move out
 * from under the tick — line ids carry the stop's position.
 */
export function usePlannerSystemCoords(args: {
  api: typeof colonizeApi | undefined;
  isActive: boolean;
  listingsReady: boolean;
  /**
   * The live values, not the deferred bundle: `listingsReady` is not deferred, and the first plan
   * must not be released on a bundle that still holds the previous (empty) listings.
   */
  checkouts: SellerSources["checkouts"];
  buyListings: SellerSources["buyListings"];
  shopHistory: SellerSources["shopHistory"];
}): { coords: SystemCoordsByNorm; ready: boolean } {
  const { api, isActive, listingsReady, checkouts, buyListings, shopHistory } = args;
  const [coords, setCoords] = useState<Record<string, GalaxyCoords>>({});
  /** Systems asked about and when; a miss is not asked again until {@link COORDS_RETRY_MS}. */
  const [askedAt, setAskedAt] = useState<Record<string, number>>({});
  const [waitedOut, setWaitedOut] = useState(false);

  const systems = useMemo(
    () => plannerSystems({ checkouts, buyListings, shopHistory }),
    [checkouts, buyListings, shopHistory],
  );
  const missing = useMemo(
    () => systems.filter((s) => !(normSystemName(s) in coords) && !(normSystemName(s) in askedAt)),
    [systems, coords, askedAt],
  );
  const missingSig = missing.join("\n");
  const missingRef = useRef(missing);
  useEffect(() => {
    missingRef.current = missing;
  }, [missing]);

  const canAsk = Boolean(api?.resolveSystemCoords);

  useEffect(() => {
    if (!isActive || !canAsk || !missingSig) return;
    // Main answers at most this many per request; the rest stay missing and go in the next one.
    const ask = missingRef.current.slice(0, COORDS_REQUEST_CAP);
    const timer = window.setTimeout(() => setWaitedOut(true), COORDS_WAIT_MS);
    void (async () => {
      let found: SystemCoordsByNorm = {};
      try {
        const res = await api!.resolveSystemCoords({ systems: ask });
        if (res.ok && res.coords) found = res.coords;
      } catch {
        /* a failed look-up counts as asked: the plan must not wait on it forever */
      }
      const now = Date.now();
      setAskedAt((prev) => {
        const next: Record<string, number> = {};
        for (const [k, at] of Object.entries(prev)) if (now - at < COORDS_RETRY_MS) next[k] = at;
        for (const s of ask) next[normSystemName(s)] = now;
        return next;
      });
      if (Object.keys(found).length) setCoords((prev) => ({ ...prev, ...found }));
      setWaitedOut(false);
    })();
    return () => window.clearTimeout(timer);
  }, [missingSig, isActive, canAsk, api]);

  /**
   * Only the first plan waits. Later, a new seller's coordinates arriving just rebuilds the plan;
   * holding it back would blank the trips for a round trip every time the listings grew.
   */
  const settled = !canAsk || !missing.length || waitedOut;
  const [primed, setPrimed] = useState(false);
  useEffect(() => {
    // Not before the listings are in: those are the sellers the first plan routes over.
    if (settled && listingsReady) setPrimed(true);
  }, [settled, listingsReady]);

  return { coords, ready: primed || settled };
}
