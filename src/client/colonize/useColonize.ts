/**
 * Everything the Colonize window knows and can do, in one place (1.3.0; the state half of EDEXO-Colonize's
 * 1,170-line App.tsx, without its views, basket, checkout dialog and shopping run, which the plan replaces).
 *
 * The views (Plan, Docked, Search, Sources, Wing) read from this and call its actions; nothing else holds state.
 */
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { capsByReference, strictestRules, type ProjectSettings } from "../../shared/colonize/projectSettings";
import { depotDisplayLabel } from "../../shared/colonize/depotLabel";
import { colonizeApi } from "./api";
import { carrierAvailability, mergeAvailability, shipCargoByKey as holdByKey, type CarrierStock } from "../../shared/colonize/carrierStock";
import { resolveCargoCapacity, clearCargoCapacityOverride, loadCargoCapacityOverride, saveCargoCapacityOverride } from "../../shared/colonize/cargoCapacityOverride";
import { commodityMergeBucket } from "../../shared/colonize/commodityKey";
import { isConstructionDepotStation, purgeConstructionDepotsFromShopHistory } from "../../shared/colonize/constructionDepot";
import type { ClearBuyDataScope } from "../../shared/colonize/buyIndexClear";
import { mergeJournalAndLocalShopHistory } from "../../shared/colonize/journalShopHistory";
import { errText } from "../../shared/colonize/formatPrice";
import { buildLogisticsSummary } from "../../shared/colonize/logisticsSummary";
import { constructionSiteSystems, plannerConstructionReferenceSystems, primaryCheckoutReferenceSystem } from "../../shared/colonize/plannerScan";
import { clearSavedCheckout } from "../../shared/colonize/savedCheckout";
import { clearShopHistory, loadShopHistory, recordShopVisit, saveShopHistory, type ShopHistoryCachedOffer, type ShopHistoryEntry } from "../../shared/colonize/shopHistory";
import { loadBannedStations, type BannedStation } from "../../shared/colonize/stationBans";
import { bestGalaxyLyFromSites, clearGalaxyDistanceCache, isKnownLy } from "../../shared/colonize/systemDistanceLy";
import { clearTripPlanSnapshot } from "../../shared/colonize/tripPlanProgress";
import type { CheckoutRoutingMode, DepotSnapshot } from "../../shared/colonize/types";
import type { WingMember } from "../../shared/colonize/wingManifest";
import { stabilizeSnapshot } from "./hooks/snapshotStability";
import { useColonizeSnapshot } from "./hooks/useColonizeSnapshot";
import { useGalaxyDistances } from "./hooks/useGalaxyDistances";
import { useMaterialBuyScanStatus } from "./hooks/useMaterialBuyScan";
import { usePlannerSettings } from "./hooks/usePlannerSettings";
import { usePlannerStations } from "./hooks/usePlannerStations";
import type { CheckoutFilterState } from "./lib/planFilters";
import { loadWingManifest, saveWingManifest } from "./lib/wingStore";
import { depotReferenceSystemFrom } from "./state/uiState";
import { useUiDispatch, useUiState } from "./state/useAppState";

/** A stable empty list, so a snapshot without carriers does not rebuild every memo below it. */
const EMPTY_CARRIERS: CarrierStock[] = [];

export function useColonize() {
  const api = colonizeApi;
  const { snap, setSnap, refresh } = useColonizeSnapshot(api);
  const ui = useUiState();
  const dispatch = useUiDispatch();
  const { plannerSettings, setPlannerSettings } = usePlannerSettings();
  const materialBuyScanStatus = useMaterialBuyScanStatus(api);
  const [buyIndexRefreshToken, setBuyIndexRefreshToken] = useState(0);
  const [searchDistanceTargets, setSearchDistanceTargets] = useState<string[]>([]);

  /* ---- a site's shopping hub (pinned per site) -------------------------------------------------------------- */
  const resolveDepotRef = useCallback(
    (d: DepotSnapshot) => depotReferenceSystemFrom(ui.depotRefPins, d),
    [ui.depotRefPins],
  );
  const setDepotRefPin = useCallback(
    (marketId: string, system: string) => dispatch({ type: "setDepotRefPin", marketId, system }),
    [dispatch],
  );
  const constructionRefSystems = useMemo(
    () => (snap?.activeDepots?.length ? plannerConstructionReferenceSystems(snap, resolveDepotRef) : []),
    [snap, resolveDepotRef],
  );
  const constructionSiteRefs = useMemo(
    () => (snap?.activeDepots?.length ? constructionSiteSystems(snap, resolveDepotRef) : []),
    [snap, resolveDepotRef],
  );
  const homeSystem = useMemo(() => primaryCheckoutReferenceSystem(snap, resolveDepotRef), [snap, resolveDepotRef]);

  /* ---- Inara imports ---------------------------------------------------------------------------------------- */
  const [inaraNotice, setInaraNotice] = useState<string | null>(null);
  useEffect(
    () =>
      api.onInaraImport((r) => {
        if (r.ok) {
          setBuyIndexRefreshToken((t) => t + 1);
          setInaraNotice(`Imported ${r.merged} station${r.merged === 1 ? "" : "s"} for ${r.commodityLabel} near ${r.nearSystem}.`);
        } else setInaraNotice(`The Inara import failed: ${r.err}`);
      }),
    [api],
  );

  /* ---- cargo: the hold, and carriers switched on ------------------------------------------------------------- */
  const shipCargoByKey = useMemo(() => holdByKey(snap?.shipCargo ?? []), [snap?.shipCargo]);
  const carriers = snap?.carriers ?? EMPTY_CARRIERS;
  const haulingCarrierIds = useMemo(
    () => new Set(carriers.map((c) => c.carrierId).filter((id) => ui.carrierHaul[id])),
    [carriers, ui.carrierHaul],
  );
  const haulingCarriers = useMemo(() => carriers.filter((c) => haulingCarrierIds.has(c.carrierId)), [carriers, haulingCarrierIds]);
  /** What the commander already owns: the hold, plus every carrier switched on. Summed here and nowhere else. */
  const cargoByKey = useMemo(
    () => mergeAvailability(shipCargoByKey, carrierAvailability(carriers, haulingCarrierIds)),
    [shipCargoByKey, carriers, haulingCarrierIds],
  );
  const toggleCarrier = useCallback((carrierId: string) => dispatch({ type: "toggleCarrierHaul", carrierId }), [dispatch]);
  const cargoOnHand = useMemo(() => [...shipCargoByKey.values()].reduce((a, b) => a + b, 0), [shipCargoByKey]);

  const [manualCapacity, setManualCapacity] = useState(() => loadCargoCapacityOverride());
  const capacity = useMemo(
    () => resolveCargoCapacity(snap?.shipCargoCapacity ?? null, manualCapacity),
    [snap?.shipCargoCapacity, manualCapacity],
  );
  const setCapacity = useCallback((tons: number | null) => {
    if (tons == null) clearCargoCapacityOverride();
    else saveCargoCapacityOverride(tons);
    setManualCapacity(tons);
  }, []);
  const freeTons = capacity != null && capacity > 0 ? Math.max(0, capacity - cargoOnHand) : null;

  /* ---- bans, filters, the plan's sellers -------------------------------------------------------------------- */
  // banStation / unbanStation save as they change the list.
  const [bannedStations, setBannedStations] = useState<BannedStation[]>(() => loadBannedStations());
  /*
    The plan's rules (the Haul plan's controls, `baseFilters`) under every active site's own (discuss item 1): one plan
    serves every site, so it runs under the strictest of them; `stricterFor` names the sites that tightened it.
  */
  const baseFilters = ui.checkoutFilters;
  const { filters, stricterFor } = useMemo(() => {
    const sites = (snap?.activeDepots ?? []).map((d) => ({ label: depotDisplayLabel(d), rules: ui.projects[d.marketId]?.rules }));
    const { rules, stricterFor } = strictestRules(baseFilters, sites);
    const filters: CheckoutFilterState =
      rules === baseFilters
        ? baseFilters
        : { ...rules, largePadOnly: rules.minLandingPad === "L", includePlanetaryAndGround: rules.showPlanetary };
    return { filters, stricterFor };
  }, [baseFilters, snap?.activeDepots, ui.projects]);
  const setFilters = useCallback((f: CheckoutFilterState) => dispatch({ type: "setCheckoutFilters", filters: f }), [dispatch]);
  const setProject = useCallback(
    (marketId: string, settings: ProjectSettings | null) => dispatch({ type: "setProject", marketId, settings }),
    [dispatch],
  );
  const setHudFollow = useCallback((marketId: string | null) => dispatch({ type: "setHudFollow", marketId }), [dispatch]);
  // Each site's own "systems per material", by its shopping hub (the scans' key).
  const maxSystemsByRef = useMemo(
    () =>
      capsByReference(
        (snap?.activeDepots ?? []).map((d) => ({ marketId: d.marketId, reference: resolveDepotRef(d) ?? "" })),
        ui.projects,
      ),
    [snap?.activeDepots, ui.projects, resolveDepotRef],
  );
  const routingMode = ui.routingMode;
  const setRoutingMode = useCallback((m: CheckoutRoutingMode) => dispatch({ type: "setRoutingMode", mode: m }), [dispatch]);
  const stations = usePlannerStations({
    snap,
    cargoByKey,
    filters,
    routingMode,
    plannerSettings,
    maxSystemsByRef,
    resolveDepotRef,
    buyIndexRefreshToken,
    setBuyIndexRefreshToken,
    setBannedStations,
  });

  /* ---- where you have docked ------------------------------------------------------------------------------- */
  const [shopHistory, setShopHistory] = useState<ShopHistoryEntry[]>(() => loadShopHistory());
  const effectiveShopHistory = useMemo(
    () => mergeJournalAndLocalShopHistory(snap?.journalShopHistory ?? [], shopHistory),
    [snap?.journalShopHistory, shopHistory],
  );
  useEffect(() => {
    if (!snap?.activeDepots?.length) return;
    setShopHistory((prev) => {
      const cleaned = purgeConstructionDepotsFromShopHistory(prev, snap.activeDepots);
      if (cleaned.length === prev.length) return prev;
      saveShopHistory(cleaned);
      return cleaned;
    });
  }, [snap?.activeDepots]);

  // A dock at a market (not a construction site) is remembered with what it sells, from Market.json.
  const lastDockRef = useRef<string | null>(null);
  useEffect(() => {
    const docked = snap?.liveDocked;
    if (!docked?.stationName || !docked.marketId) {
      lastDockRef.current = null;
      return;
    }
    const sys = docked.starSystem?.trim() || snap?.dockMarket?.starSystem || "";
    if (!sys) return;
    if (snap?.activeDepots?.length && isConstructionDepotStation(snap.activeDepots, { systemName: sys, stationName: docked.stationName, marketId: docked.marketId })) return;
    const key = `${docked.marketId}\0${sys}\0${docked.stationName}\0${docked.timestamp ?? ""}`;
    if (lastDockRef.current === key) return;
    lastDockRef.current = key;
    const record = (cachedOffers?: ShopHistoryCachedOffer[]) =>
      startTransition(() =>
        setShopHistory((prev) => recordShopVisit({ systemName: sys, stationName: docked.stationName, marketId: docked.marketId, cachedOffers }, prev)),
      );
    record();
    void api
      .readMarketSupplyBrief()
      .then((brief) => {
        if (!brief.ok || !brief.stationName || !brief.starSystem) return;
        const offers: ShopHistoryCachedOffer[] = [];
        for (const row of brief.rows) {
          const id = commodityMergeBucket(row.name) || commodityMergeBucket(row.nameLocalised);
          if (!id || (row.stock ?? 0) <= 0 || row.sellPrice == null) continue;
          offers.push({ commodityId: id, label: (row.nameLocalised || row.name).trim() || row.name, supply: row.stock ?? 0, buyPrice: row.sellPrice });
        }
        if (offers.length) record(offers);
      })
      .catch(() => {});
  }, [api, snap?.liveDocked, snap?.dockMarket?.starSystem, snap?.activeDepots]);

  /* ---- distances ------------------------------------------------------------------------------------------- */
  const { systemDistanceLy, setSystemDistanceLy, distancesLoading, distanceResolveErr } = useGalaxyDistances({
    api,
    constructionSiteRefs,
    effectiveShopHistory,
    checkoutBundle: stations.checkoutBundle,
    extraSellerSystems: searchDistanceTargets,
  });
  const shopHistoryWithDistance = useMemo(() => {
    const refs = constructionSiteRefs.map((s) => s.trim()).filter(Boolean);
    if (!refs.length) return effectiveShopHistory;
    return effectiveShopHistory.map((h) => {
      const d = bestGalaxyLyFromSites(h.systemName, refs, systemDistanceLy);
      return isKnownLy(d) ? { ...h, constructionDistanceLy: d } : h;
    });
  }, [effectiveShopHistory, systemDistanceLy, constructionSiteRefs]);

  /* ---- wing ------------------------------------------------------------------------------------------------ */
  const [wingMembers, setWingMembersState] = useState<WingMember[]>(() => loadWingManifest());
  const setWingMembers = useCallback((m: WingMember[]) => {
    setWingMembersState(m);
    saveWingManifest(m);
  }, []);
  const wingRef = useRef(wingMembers);
  wingRef.current = wingMembers;
  const [wingNotes, setWingNotes] = useState<string[]>([]);
  const [wingBusy, setWingBusy] = useState(false);
  const syncWing = useCallback(async () => {
    const roster = snap?.wingRoster ?? [];
    if (!roster.length) {
      setWingNotes(["Nobody in your wing yet: form one in the game first."]);
      return;
    }
    setWingBusy(true);
    try {
      const res = await api.syncWingCargoFromEdsm({ roster, existing: wingRef.current });
      if (!res.ok) setWingNotes([res.err]);
      else {
        setWingMembers(res.members);
        setWingNotes(res.notes);
      }
    } catch (e) {
      setWingNotes([errText(e)]);
    } finally {
      setWingBusy(false);
    }
  }, [api, snap?.wingRoster, setWingMembers]);
  const rosterSig = useMemo(() => (snap?.wingRoster ?? []).map((r) => r.commanderName).sort().join("|"), [snap?.wingRoster]);
  useEffect(() => {
    if (!rosterSig) return;
    const t = window.setTimeout(() => void syncWing(), 1500);
    return () => clearTimeout(t);
  }, [rosterSig, syncWing]);

  /* ---- sites ----------------------------------------------------------------------------------------------- */
  const setArchived = useCallback(
    (marketId: string, archived: boolean) =>
      void api
        .setDepotArchived(marketId, archived)
        // Through stabilizeSnapshot like every other snapshot, or the plan rebuilds from scratch (audit 2026-10-22).
        .then((next) => setSnap((prev) => stabilizeSnapshot(prev, next)))
        .catch(() => {}),
    [api, setSnap],
  );
  const summary = useMemo(
    () => (snap?.activeDepots?.length ? buildLogisticsSummary(snap.activeDepots, cargoByKey) : null),
    [snap?.activeDepots, cargoByKey],
  );

  /* ---- forgetting saved sellers ---------------------------------------------------------------------------- */
  const clearSavedBuyData = useCallback(
    async (scope: ClearBuyDataScope) => {
      const res = await api.clearSavedBuyData({ scope });
      if (!res.ok) return res;
      if (scope === "all" || scope === "visited") {
        clearShopHistory();
        setShopHistory([]);
      }
      if (scope === "all") {
        clearSavedCheckout();
        clearTripPlanSnapshot();
        clearGalaxyDistanceCache();
        stations.setCheckoutBundle(null);
        setSystemDistanceLy({});
      }
      setBuyIndexRefreshToken((t) => t + 1);
      void refresh();
      return { ok: true as const };
    },
    [api, refresh, setSystemDistanceLy, stations],
  );

  return {
    api,
    snap,
    refresh,
    ui,
    plannerSettings,
    setPlannerSettings,
    materialBuyScanStatus,
    buyIndexRefreshToken,
    inaraNotice,
    dismissInaraNotice: () => setInaraNotice(null),
    resolveDepotRef,
    setDepotRefPin,
    constructionRefSystems,
    constructionSiteRefs,
    homeSystem,
    shipCargoByKey,
    cargoByKey,
    cargoOnHand,
    carriers,
    haulingCarrierIds,
    haulingCarriers,
    toggleCarrier,
    capacity,
    manualCapacity,
    setCapacity,
    freeTons,
    bannedStations,
    filters,
    baseFilters,
    stricterFor,
    setFilters,
    setProject,
    setHudFollow,
    routingMode,
    setRoutingMode,
    stations,
    shopHistory: shopHistoryWithDistance,
    systemDistanceLy,
    distancesLoading,
    distanceResolveErr,
    setSearchDistanceTargets,
    wingMembers,
    setWingMembers,
    wingNotes,
    wingBusy,
    syncWing,
    setArchived,
    summary,
    clearSavedBuyData,
  };
}

export type ColonizeModel = ReturnType<typeof useColonize>;
