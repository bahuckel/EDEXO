/**
 * Where the haul plan's sellers come from, and keeping them fresh (the planner half of EDEXO-Colonize's
 * `useCheckout`; its basket and checkout dialog are gone in 1.3.0, the plan is the one place to plan).
 *
 * - `reloadSaved`: the plan from what the server already knows (buy index: Spansh results, Inara imports, markets
 *   you docked at). Cheap; no network.
 * - `lookNow` / the background look: ask Spansh for more sellers, until each material has enough seller systems
 *   (the cap) or every material has one.
 * - `findMissing`: one material nobody sells nearby, asked for live.
 * - Bans: a station the commander never wants in the plan.
 *
 * Errors land in `error`, shown on the plan itself (the old app showed them only inside the checkout dialog).
 */
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { colonizeApi } from "../api";
import { combinedMissingWithQty } from "../../../shared/colonize/basketGap";
import type { CheckoutFiltersPayload } from "../../../shared/colonize/ipc/contract";
import type { MissingBuyIndexedItem } from "../../../shared/colonize/logisticsPlanner";
import { mergeCheckoutPlansByRef } from "../../../shared/colonize/mergeCheckoutPlans";
import { plannerConstructionReferenceSystems, type DepotRefResolver } from "../../../shared/colonize/plannerScan";
import { parseMaxSystemsPerMaterial, type PlannerSettings } from "../../../shared/colonize/plannerSettings";
import { errText } from "../../../shared/colonize/formatPrice";
import { loadSavedCheckout, scheduleSaveCheckoutSnapshot } from "../../../shared/colonize/savedCheckout";
import { banStation, unbanStation, type BannedStation } from "../../../shared/colonize/stationBans";
import { collectConstructionSystems } from "../../../shared/colonize/stationFilter";
import type { BasketCheckoutBundle, CheckoutRoutingMode, ColonizeSnapshot } from "../../../shared/colonize/types";
import type { CheckoutFilterState } from "../lib/planFilters";

export function usePlannerStations(args: {
  snap: ColonizeSnapshot | null;
  cargoByKey: Map<string, number>;
  filters: CheckoutFilterState;
  routingMode: CheckoutRoutingMode;
  plannerSettings: PlannerSettings;
  resolveDepotRef: DepotRefResolver;
  buyIndexRefreshToken: number;
  setBuyIndexRefreshToken: Dispatch<SetStateAction<number>>;
  setBannedStations: Dispatch<SetStateAction<BannedStation[]>>;
}) {
  const {
    snap,
    cargoByKey,
    filters,
    routingMode,
    plannerSettings,
    resolveDepotRef,
    buyIndexRefreshToken,
    setBuyIndexRefreshToken,
    setBannedStations,
  } = args;
  // The sellers the plan routes against: the saved copy at start, saved again (and stamped) only when they change.
  const [bundle, setBundle] = useState<BasketCheckoutBundle | null>(() => loadSavedCheckout()?.bundle ?? null);
  const bundleRef = useRef(bundle);
  useEffect(() => {
    bundleRef.current = bundle;
  }, [bundle]);
  const [busy, setBusy] = useState(false);
  const [lookingBusy, setLookingBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [atCap, setAtCap] = useState(false);
  const [paused, setPaused] = useState(false);
  const [fetchingMissingId, setFetchingMissingId] = useState<string | null>(null);
  const snapRef = useRef(snap);
  const cargoRef = useRef(cargoByKey);
  snapRef.current = snap;
  cargoRef.current = cargoByKey;
  const cooldownRef = useRef(0);

  const constructionSystems = useMemo(
    () => (snap?.activeDepots?.length ? collectConstructionSystems(snap.activeDepots) : []),
    [snap?.activeDepots],
  );
  const liveStation = snap?.liveDocked?.stationName?.trim() ?? "";
  const liveSystem = snap?.liveDocked?.starSystem?.trim() || snap?.dockMarket?.starSystem?.trim() || "";
  const dockedStation = useMemo(
    () => (liveStation && liveSystem ? { systemName: liveSystem, stationName: liveStation } : null),
    [liveStation, liveSystem],
  );

  const payloadFilters = useCallback((): CheckoutFiltersPayload => {
    const maxLy = filters.maxDistanceLy.trim() ? Number(filters.maxDistanceLy) : null;
    const minSup = filters.minSupply.trim() ? Number(filters.minSupply) : null;
    return {
      maxDistanceLy: maxLy != null && Number.isFinite(maxLy) && maxLy > 0 ? maxLy : null,
      minSupply: minSup != null && Number.isFinite(minSup) && minSup > 0 ? minSup : null,
      largePadOnly: filters.minLandingPad === "L",
      minLandingPad: filters.minLandingPad,
      stationKind: filters.showPlanetary ? "any" : "space",
      excludeFleetCarriers: filters.excludeFleetCarriers,
      includePlanetaryAndGround: filters.showPlanetary,
      constructionSystems,
      dockedStation,
      constructionDepots: (snapRef.current?.activeDepots ?? []).map((d) => ({
        marketId: d.marketId,
        systemName: d.starSystem?.trim() || "",
        starSystem: d.starSystem?.trim() || "",
        stationName: d.stationName?.trim() || d.constructionSiteLabel?.trim() || "",
        constructionSiteLabel: d.constructionSiteLabel,
        label: d.constructionSiteLabel,
      })),
      maxSystemsPerMaterial: parseMaxSystemsPerMaterial(plannerSettings.maxSystemsPerMaterial),
    };
  }, [filters, constructionSystems, dockedStation, plannerSettings.maxSystemsPerMaterial]);

  /** Whether every material has enough sellers saved (the background look then rests). */
  const checkPause = useCallback(async (): Promise<boolean> => {
    const s = snapRef.current;
    if (!s?.activeDepots?.length) {
      startTransition(() => {
        setAtCap(false);
        setPaused(false);
      });
      return false;
    }
    const items = combinedMissingWithQty(s.activeDepots, cargoRef.current);
    const refs = plannerConstructionReferenceSystems(s, resolveDepotRef);
    if (!items.length || !refs.length) return false;
    try {
      const res = await colonizeApi.plannerMaterialsAtCap({
        referenceSystems: refs,
        items,
        maxSystemsPerMaterial: parseMaxSystemsPerMaterial(plannerSettings.maxSystemsPerMaterial) ?? 0,
        constructionDepots: payloadFilters().constructionDepots,
      });
      if (!res.ok) return false;
      const pause = res.atCap || res.allFound;
      startTransition(() => {
        setAtCap(res.atCap);
        setPaused(pause);
      });
      return pause;
    } catch {
      return false;
    }
  }, [payloadFilters, plannerSettings.maxSystemsPerMaterial, resolveDepotRef]);

  useEffect(() => {
    void checkPause();
  }, [checkPause, snap?.activeDepots?.length, buyIndexRefreshToken]);

  const refresh = useCallback(
    async (opts: { background: boolean; askSpansh: boolean; force?: boolean }) => {
      const s = snapRef.current;
      if (!s?.activeDepots?.length) return;
      const items = combinedMissingWithQty(s.activeDepots, cargoRef.current);
      if (!items.length) return;
      if (opts.background) {
        if (!opts.askSpansh) return;
        // An automatic look rests once every material has enough sellers; "Look now" asks anyway.
        if (!opts.force && (paused || (await checkPause()))) return;
        if (Date.now() - cooldownRef.current < 2000) return;
        cooldownRef.current = Date.now();
        startTransition(() => setLookingBusy(true));
      } else setBusy(true);
      setError(null);
      const refs = plannerConstructionReferenceSystems(s, resolveDepotRef);
      try {
        if (!refs.length) return;
        const f = payloadFilters();
        const res = await colonizeApi.checkoutBasketMulti({
          referenceSystems: refs,
          journalDir: s.journalDir?.trim() || null,
          includePlanetaryAndGround: filters.showPlanetary,
          filters: f,
          routingMode,
          cacheOnly: true,
          items,
        });
        if (res.ok && res.bundle.plans.length) {
          const next = { plans: res.bundle.plans };
          scheduleSaveCheckoutSnapshot(next);
          startTransition(() => setBundle(next));
        } else if (!res.ok) setError(res.err);
        else if (!opts.background) setError("No seller known yet for what your sites need. Ask Spansh to look.");
        if (opts.askSpansh) {
          const scan = await colonizeApi.schedulePlannerMaterialScan({
            referenceSystems: refs,
            items,
            maxSystemsPerMaterial: parseMaxSystemsPerMaterial(plannerSettings.maxSystemsPerMaterial),
            constructionDepots: f.constructionDepots,
            force: opts.force === true,
          });
          if (scan.ok && (scan.atCap || scan.allFound)) {
            startTransition(() => {
              setAtCap(scan.atCap);
              setPaused(true);
            });
          }
          setBuyIndexRefreshToken((t) => t + 1);
        }
      } catch (e) {
        setError(errText(e));
      } finally {
        if (opts.background) startTransition(() => setLookingBusy(false));
        else setBusy(false);
      }
    },
    [checkPause, filters.showPlanetary, paused, payloadFilters, plannerSettings.maxSystemsPerMaterial, resolveDepotRef, routingMode, setBuyIndexRefreshToken],
  );

  const reloadSaved = useCallback(() => void refresh({ background: false, askSpansh: false }), [refresh]);
  const backgroundLook = useCallback(
    () => void refresh({ background: true, askSpansh: plannerSettings.liveSpanshScans }),
    [refresh, plannerSettings.liveSpanshScans],
  );
  const lookNow = useCallback(() => void refresh({ background: true, askSpansh: true, force: true }), [refresh]);

  const findMissing = useCallback(
    async (item: MissingBuyIndexedItem) => {
      const s = snapRef.current;
      if (!s?.activeDepots?.length) return;
      const refs = plannerConstructionReferenceSystems(s, resolveDepotRef);
      if (!refs.length) return;
      const line = { id: item.id, name: item.label, nameLocalised: item.label, quantityTons: item.quantityTons };
      setFetchingMissingId(item.id);
      setError(null);
      try {
        void colonizeApi.scheduleActiveBasketScan({ referenceSystem: refs[0]!, items: [line] });
        const res = await colonizeApi.checkoutBasketMulti({
          referenceSystems: refs,
          journalDir: s.journalDir?.trim() || null,
          includePlanetaryAndGround: filters.showPlanetary,
          filters: payloadFilters(),
          routingMode,
          cacheOnly: false,
          forceLiveScan: true,
          items: [line],
        });
        if (!res.ok) {
          setError(res.err);
          return;
        }
        if (!res.bundle.plans.length) {
          setError(`Spansh knows no seller of ${item.label} in range.`);
          return;
        }
        const next = { plans: mergeCheckoutPlansByRef([...(bundleRef.current?.plans ?? []), ...res.bundle.plans]) };
        bundleRef.current = next;
        scheduleSaveCheckoutSnapshot(next);
        startTransition(() => setBundle(next));
        setBuyIndexRefreshToken((t) => t + 1);
      } catch (e) {
        setError(errText(e));
      } finally {
        setFetchingMissingId(null);
      }
    },
    [filters.showPlanetary, payloadFilters, resolveDepotRef, routingMode, setBuyIndexRefreshToken],
  );

  const ban = useCallback(
    (systemName: string, stationName: string) => {
      setBannedStations((prev) => banStation(prev, systemName, stationName));
      void refresh({ background: false, askSpansh: false });
    },
    [refresh, setBannedStations],
  );
  const unban = useCallback(
    (systemName: string, stationName: string) => setBannedStations((prev) => unbanStation(prev, systemName, stationName)),
    [setBannedStations],
  );

  return {
    checkoutBundle: bundle,
    setCheckoutBundle: setBundle,
    busy,
    lookingBusy,
    error,
    clearError: () => setError(null),
    atCap,
    fetchingMissingId,
    reloadSaved,
    backgroundLook,
    lookNow,
    findMissing,
    ban,
    unban,
  };
}
