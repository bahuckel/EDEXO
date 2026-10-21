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
import type { ColonizeModel } from "../useColonize";
import { BuyHerePanel, DeliverHerePanel } from "./DockPanels";
import { SitesColumn } from "./SitesColumn";
import { NextTripCard, TripList } from "./Trips";

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
    checkoutResult: m.stations.checkoutResult,
    checkoutBundle: m.stations.checkoutBundle,
    bannedStations: m.bannedStations,
    constructionRefSystems: m.constructionRefSystems,
    constructionSiteSystems: m.constructionSiteRefs,
    homeSystem: m.homeSystem,
    buyIndexRefreshToken: m.buyIndexRefreshToken,
  });
  const { listings, listingsReady, listingsLoading, localFetchingId, fetchMissingMaterialLocally } = useDepotBuyListings({
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
  const totalTons = plan?.totalRemainingTons ?? 0;

  if (!activeDepots?.length) {
    return (
      <div className="cz-cols">
        <SitesColumn m={m} />
        <section className="cz-wide cz-panel">
          <h2 className="cz-h2">Nothing to haul yet</h2>
          <p>
            A construction site appears here once you dock at it or deliver to it: the game writes it to your journal, and
            this window follows your journals from the last seven days.
          </p>
          <p className="cz-dim">
            Looking for where to build? <a href="/?screen=galaxy&amp;drawer=finder" target="_blank" rel="noreferrer">Find colony sites</a>{" "}
            on the galaxy map: systems near your colonies with the bodies you want, not yet taken.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="cz-cols">
      <SitesColumn m={m} />
      <section className="cz-wide" aria-labelledby="cz-plan-h">
        <div className="cz-row">
          <h2 id="cz-plan-h" className="cz-h2">
            Haul plan
          </h2>
          <span style={{ color: "var(--text-dim)" }}>
            {trips.length
              ? `${trips.length} trip${trips.length === 1 ? "" : "s"} · ${Math.round(totalTons).toLocaleString("en-US")} t`
              : listingsLoading || m.stations.busy
                ? "Working it out…"
                : "No trips yet"}
          </span>
        </div>

        <PlanFilters m={m} />

        {m.stations.error ? (
          <div className="cz-note cz-note--bad" role="alert">
            <span className="cz-note__text">{m.stations.error}</span>
            <button type="button" className="cz-btn cz-btn--quiet" onClick={m.stations.clearError}>
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

        {missing.length ? (
          <div className="cz-note cz-note--warn" role="status">
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M10 2 19 18H1Z" fill="none" stroke="var(--warn)" strokeWidth="1.6" />
              <path d="M10 8v4M10 14.5v.5" stroke="var(--warn)" strokeWidth="1.8" />
            </svg>
            <div className="cz-note__text cz-stack" style={{ gap: 8 }}>
              {missing.map((item) => (
                <div key={`${item.why}-${item.id}`} className="cz-row" style={{ alignItems: "center" }}>
                  <span>
                    <b>{item.label}</b> ({Math.round(item.quantityTons).toLocaleString("en-US")} t):{" "}
                    {item.why === "none"
                      ? "no seller known nearby."
                      : "sellers are known, but none fits what the plan may use (pad, distance, planet ports)."}
                  </span>
                  <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="cz-btn cz-btn--warn"
                      disabled={m.stations.fetchingMissingId === item.id || localFetchingId === item.id}
                      onClick={() => void m.stations.findMissing(item)}
                    >
                      {m.stations.fetchingMissingId === item.id ? "Asking Spansh…" : "Ask Spansh"}
                    </button>
                    <button
                      type="button"
                      className="cz-btn cz-btn--warn"
                      disabled={localFetchingId === item.id}
                      title="Look through the sellers already saved, further out"
                      onClick={() => void fetchMissingMaterialLocally(item)}
                    >
                      Saved sellers
                    </button>
                    <a className="cz-btn cz-btn--warn" href={inaraCommoditySearchUrl(item.label, near)} target="_blank" rel="noreferrer">
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
          <div className="cz-panel cz-stack">
            <p style={{ margin: 0 }}>
              {checkouts.length
                ? "The sellers known do not fit what the plan may use. Loosen the filters above, or look for more sellers."
                : "No sellers known yet for what your sites need."}
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="cz-btn cz-btn--primary" disabled={m.stations.lookingBusy} onClick={m.stations.lookNow}>
                {m.stations.lookingBusy ? "Looking…" : "Look on Spansh now"}
              </button>
              <button type="button" className="cz-btn" disabled={m.stations.busy} onClick={m.stations.reloadSaved}>
                Use saved sellers
              </button>
            </div>
          </div>
        ) : null}

        <p className="cz-small cz-dim" style={{ margin: 0 }}>
          {checkoutAge ? `Sellers last gathered ${checkoutAge}${checkoutStale ? " (getting old)" : ""}. ` : ""}
          {m.stations.lookingBusy ? "Looking for more sellers now. " : ""}
          The plan updates as you buy, deliver and dock.
        </p>
      </section>
    </div>
  );
}

const PADS: { v: MinLandingPad; label: string }[] = [
  { v: "L", label: "L" },
  { v: "M", label: "M" },
  { v: "any", label: "Any" },
];
const ORDERS: { v: CheckoutRoutingMode; label: string }[] = [
  { v: "fewest_stops", label: "Fewest stops" },
  { v: "nearest", label: "Nearest" },
  { v: "cheapest", label: "Cheapest" },
];

/** What the plan may use, on the plan itself (they were the checkout dialog's in EDEXO-Colonize). */
function PlanFilters({ m }: { m: ColonizeModel }) {
  const f = m.filters;
  const set = (patch: Partial<typeof f>) => m.setFilters({ ...f, ...patch });
  return (
    <div className="cz-filters" role="group" aria-label="What the plan may use">
      <label className="cz-field">
        Pad
        <select
          className="cz-select"
          value={f.minLandingPad ?? "any"}
          onChange={(e) => {
            const v = e.target.value as MinLandingPad;
            set({ minLandingPad: v, largePadOnly: v === "L" });
          }}
        >
          {PADS.map((p) => (
            <option key={p.v} value={p.v}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label className="cz-field">
        Within
        <input
          className="cz-input"
          inputMode="numeric"
          size={4}
          value={f.maxDistanceLy}
          placeholder="any"
          onChange={(e) => set({ maxDistanceLy: e.target.value.replace(/[^\d.]/g, "") })}
        />
        ly
      </label>
      <button
        type="button"
        className="cz-toggle"
        aria-pressed={f.showPlanetary}
        title="Surface ports and settlements"
        onClick={() => set({ showPlanetary: !f.showPlanetary, includePlanetaryAndGround: !f.showPlanetary })}
      >
        Planet ports
      </button>
      <button
        type="button"
        className="cz-toggle"
        aria-pressed={!f.excludeFleetCarriers}
        title="Other commanders' fleet carriers that sell what you need"
        onClick={() => set({ excludeFleetCarriers: !f.excludeFleetCarriers })}
      >
        Carriers that sell
      </button>
      <label className="cz-field">
        Order
        <select className="cz-select" value={m.routingMode} onChange={(e) => m.setRoutingMode(e.target.value as CheckoutRoutingMode)}>
          {ORDERS.map((o) => (
            <option key={o.v} value={o.v}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="cz-btn" disabled={m.stations.lookingBusy} onClick={m.stations.lookNow} style={{ marginLeft: "auto" }}>
        {m.stations.lookingBusy ? "Looking…" : "Look for sellers now"}
      </button>
    </div>
  );
}
