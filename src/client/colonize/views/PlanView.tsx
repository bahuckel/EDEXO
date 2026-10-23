/**
 * Plan: your sites on the left, one haul plan on the right — what the plan may use (pad, distance, planet ports,
 * carriers that sell, order), what to buy here when you are docked at a seller, the next trip, materials nobody
 * sells nearby, and the trips after it.
 *
 * The planning is EDEXO-Colonize's (planner hooks, src/shared/colonize/planner); this view replaces its Build and
 * Plan tabs, its basket, checkout dialog and shopping run.
 */
import { useMemo } from "react";
import { isConstructionDepotStation } from "../../../shared/colonize/constructionDepot";
import { formatTons } from "../../../shared/colonize/formatPrice";
import { inaraCommoditySearchUrl } from "../../../shared/colonize/inaraLinks";
import type { MissingBuyIndexedItem } from "../../../shared/colonize/logisticsPlanner";
import type { MinLandingPad } from "../../../shared/colonize/stationFilter";
import type { CheckoutRoutingMode } from "../../../shared/colonize/types";
import { useBackgroundScanScheduler } from "../planner/hooks/useBackgroundScanScheduler";
import { useDeferredPlannerInputs } from "../planner/hooks/useDeferredPlannerInputs";
import { useDepotBuyListings } from "../planner/hooks/useDepotBuyListings";
import { useLogisticsPlan } from "../planner/hooks/useLogisticsPlan";
import { usePlannerCheckouts } from "../planner/hooks/usePlannerCheckouts";
import { usePlannerSystemCoords } from "../planner/hooks/usePlannerSystemCoords";
import { colonizeApi } from "../api";
import { onGalaxyDrawerLinkClick } from "../../galaxyDrawerRequest";
import { openInEdexoBrowser } from "../inaraBrowser";
import type { ColonizeModel } from "../useColonize";
import { Select, type SelectOption } from "../../ui/Select";
import { BuyHerePanel, DeliverHerePanel } from "./DockPanels";
import { SitesColumn } from "./SitesColumn";
import { NextTripCard, TripList } from "./Trips";
import { BTN, BTN_GO, BTN_LINK, BTN_WARN, Panel } from "./ui";

export function PlanView({ m }: { m: ColonizeModel }) {
  const snap = m.snap;
  const activeDepots = snap?.activeDepots;
  const docked = snap?.liveDocked ?? null;
  const dockMarketSystem = snap?.dockMarket?.starSystem;
  const f = m.filters;
  const maxDistanceLy = f.maxDistanceLy.trim() && Number(f.maxDistanceLy) > 0 ? Number(f.maxDistanceLy) : null;

  const { depotNeeds, checkouts, checkoutAge, checkoutStale } = usePlannerCheckouts({
    isActive: true,
    activeDepots,
    cargoByKey: m.cargoByKey,
    checkoutBundle: m.stations.checkoutBundle,
    bannedStations: m.bannedStations,
    constructionRefSystems: m.constructionRefSystems,
    constructionSiteSystems: m.constructionSiteRefs,
    homeSystem: m.homeSystem,
  });
  const { listings, listingsReady, listingsLoading, localFetchingId, fetchMissingMaterialLocally, localFetchNotice } = useDepotBuyListings({
    isActive: true,
    depotNeeds,
    activeDepots,
    constructionRefSystems: m.constructionRefSystems,
    constructionSiteSystems: m.constructionSiteRefs,
    homeSystem: m.homeSystem,
    systemDistanceLy: m.systemDistanceLy,
    buyIndexRefreshToken: m.buyIndexRefreshToken,
  });
  const deferred = useDeferredPlannerInputs({
    checkouts,
    buyListings: listings,
    cargoByKey: m.cargoByKey,
    shopHistory: m.shopHistory,
    systemDistanceLy: m.systemDistanceLy,
  });
  const { coords, ready: coordsReady } = usePlannerSystemCoords({
    api: colonizeApi,
    isActive: true,
    listingsReady,
    checkouts,
    buyListings: listings,
    shopHistory: m.shopHistory,
  });
  const { plan, displayPlan, completedLineIds, toggleTripLine } = useLogisticsPlan({
    isActive: true,
    deferred,
    listingsReady,
    systemCoords: coords,
    coordsReady,
    activeDepots,
    docked,
    dockMarketSystem,
    effectiveCapacity: m.capacity,
    wing: m.wingMembers,
    bannedStations: m.bannedStations,
    homeSystem: m.homeSystem,
    includeAllPlanetaryAndGround: f.showPlanetary,
    largePadOnly: f.minLandingPad === "L",
    minLandingPad: f.minLandingPad,
    stationKind: f.showPlanetary ? "any" : "space",
    excludeFleetCarriers: f.excludeFleetCarriers,
    maxDistanceLy,
    constructionSiteSystems: m.constructionSiteRefs,
    buyIndexRefreshToken: m.buyIndexRefreshToken,
  });

  // Nothing left to look for once every material the plan needs has a seller, or each has enough of them.
  const restLooking = m.stations.atCap || Boolean(plan && depotNeeds.length > 0 && plan.missingBuyIndexed.length === 0);
  useBackgroundScanScheduler({
    enabled: m.plannerSettings.liveSpanshScans && Boolean(activeDepots?.length) && !restLooking,
    onBackgroundScan: m.stations.backgroundLook,
    docked,
    navSystem: snap?.navContext.starSystem,
    effectiveCapacity: m.capacity,
    depotNeeds,
    shopHistory: m.shopHistory,
    activeDepotCount: activeDepots?.length ?? 0,
  });

  const dockedAtSite = useMemo(() => {
    if (!docked?.stationName || !activeDepots?.length) return null;
    const sys = docked.starSystem?.trim() || dockMarketSystem || "";
    return isConstructionDepotStation(activeDepots, { systemName: sys, stationName: docked.stationName, marketId: docked.marketId })
      ? (activeDepots.find((d) => d.marketId === docked.marketId) ?? null)
      : null;
  }, [docked, activeDepots, dockMarketSystem]);

  const missing: (MissingBuyIndexedItem & { why: "none" | "filtered" })[] = [
    ...(plan?.missingBuyIndexed ?? []).map((i) => ({ ...i, why: "none" as const })),
    ...(plan?.missingTripEligible ?? []).map((i) => ({ ...i, why: "filtered" as const })),
  ];
  const near = m.constructionSiteRefs[0]?.trim() || m.homeSystem;
  const trips = displayPlan?.trips ?? [];
  // What the listed trips carry, and what is left after them when the plan stopped at its trip limit (a small hold).
  const totalTons = trips.reduce((a, tr) => a + tr.loadTons, 0);
  const afterTons = plan?.afterTripsTons ?? 0;

  if (!activeDepots?.length) {
    return (
      <div className="cz-cols cz-cols--plan">
        <SitesColumn m={m} />
        <div className="cz-wide">
          <Panel k="plan-empty" title="Nothing to haul yet">
            <p style={{ marginTop: 0 }}>
              A construction site appears here once you dock at it or deliver to it: the game writes it to your journal, and
              this window follows your journals from the last seven days.
            </p>
            <p className="cz-dim" style={{ marginBottom: 0 }}>
              Looking for where to build? <a href="/?screen=galaxy&amp;drawer=finder" target="_blank" rel="noreferrer" onClick={onGalaxyDrawerLinkClick("finder")}>
                Find colony sites
              </a>{" "}
              on the galaxy map: systems near your colonies with the bodies you want, not yet taken.
            </p>
          </Panel>
        </div>
      </div>
    );
  }

  return (
    <div className="cz-cols cz-cols--plan">
      <SitesColumn m={m} />
      <div className="cz-wide">
        <Panel
          k="plan"
          title="Haul plan"
          aside={
            <span className="cz-aside-note">
              {trips.length
                ? `${trips.length} trip${trips.length === 1 ? "" : "s"} · ${formatTons(totalTons)}`
                : listingsLoading || m.stations.busy
                  ? "Working it out…"
                  : "No trips yet"}
            </span>
          }
          help={
            <p>
              The plan fills your hold from the sellers known (your journal first, then Spansh and Inara), within what you allow
              below, and updates as you buy, deliver and dock.
            </p>
          }
        >
          <PlanFilters m={m} />
        </Panel>

        {localFetchNotice ? (
          <div className="cz-note cz-note--bad" role="alert">
            <span className="cz-note__text">{localFetchNotice}</span>
          </div>
        ) : null}
        {m.stations.error ? (
          <div className="cz-note cz-note--bad" role="alert">
            <span className="cz-note__text">{m.stations.error}</span>
            <button type="button" className={BTN_LINK} onClick={m.stations.clearError}>
              Dismiss
            </button>
          </div>
        ) : null}
        {m.distanceResolveErr ? (
          <div className="cz-note cz-note--warn" role="status">
            <span className="cz-note__text">Some distances could not be worked out: {m.distanceResolveErr}</span>
          </div>
        ) : null}

        {dockedAtSite ? <DeliverHerePanel m={m} site={dockedAtSite} /> : null}
        {docked && !dockedAtSite && plan ? <BuyHerePanel m={m} plan={plan} /> : null}

        {trips.length ? (
          <NextTripCard trips={trips} completed={completedLineIds} onToggle={toggleTripLine} onBan={m.stations.ban} />
        ) : null}

        {afterTons > 0 ? (
          <div className="cz-note cz-note--info" role="status">
            <span className="cz-note__text">
              Your hold takes {formatTons(m.capacity ?? 0)}, so the plan lists the first {trips.length} trips;{" "}
              {formatTons(afterTons)} more come after them. Switching on a carrier with cargo, or a
              bigger hold, cuts that down.
            </span>
          </div>
        ) : null}

        {missing.length ? (
          <div className="cz-note cz-note--warn" role="status">
            <span className="cz-note__tag">No seller</span>
            <div className="cz-note__text cz-stack" style={{ gap: 8 }}>
              {missing.map((item) => (
                <div key={`${item.why}-${item.id}`} className="cz-row" style={{ alignItems: "center" }}>
                  <span>
                    <b>{item.label}</b> ({formatTons(item.quantityTons)}):{" "}
                    {item.why === "none"
                      ? "no seller known nearby."
                      : "sellers are known, but none fits what the plan may use (pad, distance, planet ports)."}
                  </span>
                  <span className="cz-actions">
                    <button
                      type="button"
                      className={BTN_WARN}
                      disabled={m.stations.fetchingMissingId === item.id || localFetchingId === item.id}
                      onClick={() => void m.stations.findMissing(item)}
                    >
                      {m.stations.fetchingMissingId === item.id ? "Asking Spansh…" : "Ask Spansh"}
                    </button>
                    <button
                      type="button"
                      className={BTN_WARN}
                      disabled={localFetchingId === item.id}
                      title="Look through the sellers already saved, further out"
                      onClick={() => void fetchMissingMaterialLocally(item)}
                    >
                      Saved sellers
                    </button>
                    <a
                      className={BTN_WARN}
                      href={inaraCommoditySearchUrl(item.label, near)}
                      target="_blank"
                      rel="noreferrer"
                      title="Inara's sellers of this, in the EDEXO Browser; the EDEXO pop-up there reads them into Colonize"
                      onClick={(e) => {
                        if (openInEdexoBrowser(e.currentTarget.href)) e.preventDefault();
                      }}
                    >
                      Inara
                    </a>
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {trips.length > 1 ? <TripList trips={trips} completed={completedLineIds} onToggle={toggleTripLine} onBan={m.stations.ban} /> : null}

        {!trips.length && !listingsLoading ? (
          <Panel k="plan-no-trips" title="No trips yet">
            <div className="cz-stack">
              <p style={{ margin: 0 }}>
                {checkouts.length
                  ? "The sellers known do not fit what the plan may use. Loosen the filters above, or look for more sellers."
                  : "No sellers known yet for what your sites need."}
              </p>
              <div className="cz-actions">
                <button type="button" className={BTN_GO} disabled={m.stations.lookingBusy} onClick={m.stations.lookNow}>
                  {m.stations.lookingBusy ? "Looking…" : "Look on Spansh now"}
                </button>
                <button type="button" className={BTN} disabled={m.stations.busy} onClick={m.stations.reloadSaved}>
                  Use saved sellers
                </button>
              </div>
            </div>
          </Panel>
        ) : null}

        <p className="cz-small cz-dim" style={{ margin: 0 }}>
          {checkoutAge ? `Sellers last gathered ${checkoutAge}${checkoutStale ? " (getting old)" : ""}. ` : ""}
          {m.stations.lookingBusy ? "Looking for more sellers now. " : ""}
          The plan updates as you buy, deliver and dock.
        </p>
      </div>
    </div>
  );
}

const PADS: SelectOption<MinLandingPad>[] = [
  { value: "L", label: "L" },
  { value: "M", label: "M" },
  { value: "any", label: "Any" },
];
const ORDERS: SelectOption<CheckoutRoutingMode>[] = [
  { value: "fewest_stops", label: "Fewest stops" },
  { value: "nearest", label: "Nearest" },
  { value: "cheapest", label: "Cheapest" },
];

/** What the plan may use, on the plan itself (they were the checkout dialog's in EDEXO-Colonize). */
function PlanFilters({ m }: { m: ColonizeModel }) {
  const f = m.filters;
  const set = (patch: Partial<typeof f>) => m.setFilters({ ...f, ...patch });
  return (
    <div className="cz-filters" role="group" aria-label="What the plan may use">
      <span className="cz-field">
        <span className="cz-label">Pad</span>
        <Select<MinLandingPad>
          ariaLabel="Landing pad"
          value={f.minLandingPad ?? "any"}
          options={PADS}
          onChange={(v) => set({ minLandingPad: v, largePadOnly: v === "L" })}
        />
      </span>
      <label className="cz-field">
        <span className="cz-label">Within</span>
        <input
          className="cz-input"
          inputMode="numeric"
          size={4}
          value={f.maxDistanceLy}
          placeholder="any"
          onChange={(e) => set({ maxDistanceLy: e.target.value.replace(/[^\d.]/g, "") })}
        />
        <span className="cz-dim">ly</span>
      </label>
      <span className="cz-field">
        <span className="cz-label">Order</span>
        <Select<CheckoutRoutingMode> ariaLabel="Order" value={m.routingMode} options={ORDERS} onChange={(v) => m.setRoutingMode(v)} />
      </span>
      <button
        type="button"
        className={`btn-top-toggle cz-toggle${f.showPlanetary ? " btn-top-toggle--on" : ""}`}
        aria-pressed={f.showPlanetary}
        title="Surface ports and settlements"
        onClick={() => set({ showPlanetary: !f.showPlanetary, includePlanetaryAndGround: !f.showPlanetary })}
      >
        Planet ports
      </button>
      <button
        type="button"
        className={`btn-top-toggle cz-toggle${!f.excludeFleetCarriers ? " btn-top-toggle--on" : ""}`}
        aria-pressed={!f.excludeFleetCarriers}
        title="Other commanders' fleet carriers that sell what you need"
        onClick={() => set({ excludeFleetCarriers: !f.excludeFleetCarriers })}
      >
        Carriers that sell
      </button>
      <button type="button" className={BTN} disabled={m.stations.lookingBusy} onClick={m.stations.lookNow} style={{ marginLeft: "auto" }}>
        {m.stations.lookingBusy ? "Looking…" : "Look for sellers now"}
      </button>
    </div>
  );
}
