/**
 * Colonize on a paired phone or tablet (1.3.0): read-only, one column. The server lets a LAN device read and not
 * save (routes/colonizeRoutes.ts COLONIZE_LAN_READ), so this view asks only what it may: the sites and the hold
 * (getSnapshot, live on the socket) and the haul plan the PC made, with its ticks (ui-state.json, read-only load in
 * uiStateSync.ts). It makes no plan of its own, looks nothing up and changes nothing; the PC's window does those.
 *
 * Which trip is next is decided as on the PC (`syncTripLineCompletions`: ticks, cargo aboard, carriers switched on).
 */
import { useEffect, useMemo, useState } from "react";
import { colonizeApi } from "../api";
import { useColonizeSnapshot } from "../hooks/useColonizeSnapshot";
import { onRemoteUiState } from "../uiStateSync";
import { carrierAvailability, mergeAvailability } from "../../../shared/colonize/carrierStock";
import { loadCargoCapacityOverride, resolveCargoCapacity } from "../../../shared/colonize/cargoCapacityOverride";
import { commodityMergeBucket } from "../../../shared/colonize/commodityKey";
import { depotDisplayLabel } from "../../../shared/colonize/depotLabel";
import { storageGet } from "../../../shared/colonize/storage";
import { loadTripPlanSnapshot, syncTripLineCompletions } from "../../../shared/colonize/tripPlanProgress";
import { AppLegalFooter } from "../../App";
import { DeliverHerePanel } from "./DockPanels";
import { SitesColumn } from "./SitesColumn";
import { NextTripCard, TripList } from "./Trips";

const CARRIER_HAUL_KEY = "edexo-colonize-carrier-haul-v1";
const noop = () => undefined;
const t = (n: number) => `${Math.round(n).toLocaleString("en-US")} t`;

function carriersSwitchedOn(): Set<string> {
  try {
    const j = JSON.parse(storageGet(CARRIER_HAUL_KEY) ?? "{}") as Record<string, unknown>;
    return new Set(Object.entries(j).filter(([, v]) => v === true).map(([k]) => k));
  } catch {
    return new Set();
  }
}

/** `streamer`: the same, for an OBS Browser source (no note, no Ko-fi, nothing to click, two columns when wide). */
export function PhoneView({ streamer = false }: { streamer?: boolean }) {
  const { snap } = useColonizeSnapshot(colonizeApi);
  // Another window saved (a tick on the PC): the plan is read again from storage.
  const [gen, setGen] = useState(0);
  const [trip, setTrip] = useState(loadTripPlanSnapshot);
  useEffect(
    () =>
      onRemoteUiState(() => {
        setTrip(loadTripPlanSnapshot());
        setGen((g) => g + 1);
      }),
    [],
  );
  const shipCargoByKey = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of snap?.shipCargo ?? []) {
      const k = commodityMergeBucket(c.name) || commodityMergeBucket(c.nameLocalised);
      if (k) m.set(k, (m.get(k) ?? 0) + c.count);
    }
    return m;
  }, [snap?.shipCargo]);
  const active = useMemo(() => snap?.activeDepots ?? [], [snap?.activeDepots]);
  const completed = useMemo(() => {
    if (!trip || !snap) return new Set<string>();
    const on = carriersSwitchedOn();
    const carriers = snap.carriers.filter((c) => on.has(c.carrierId));
    const cargo = mergeAvailability(shipCargoByKey, carrierAvailability(carriers, on));
    return new Set(syncTripLineCompletions(trip, active, cargo, trip.manualCompletedLineIds));
    // gen: the carriers switched on are read from storage, which another window may have changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip, snap, active, shipCargoByKey, gen]);

  const docked = snap?.liveDocked ?? null;
  const dockedSite = docked ? active.find((d) => d.marketId === docked.marketId) : undefined;
  const used = [...shipCargoByKey.values()].reduce((a, n) => a + n, 0);
  const capacity = resolveCargoCapacity(snap?.shipCargoCapacity ?? null, loadCargoCapacityOverride());
  const trips = trip?.plan.trips ?? [];
  const sitesModel = { snap, ui: { depotRefPins: {} }, setDepotRefPin: noop, setArchived: noop };

  return (
    <div className={`app-shell cz ${streamer ? "cz--stream" : "cz--phone"}`}>
      {/* Compare's app bar, as much of it as a read-only view has: the wordmark and the tray's two facts. */}
      <header className="cz-head">
        <span className="cz-mark">
          EDEXO<b>Colonize</b>
        </span>
        <div className="cz-chips">
          <span className={`cz-chip${docked?.stationName ? " cz-chip--info" : ""}`} data-testid="phone-where">
            <span className="cz-chip__k">{docked?.stationName ? "Docked" : "You"}</span>
            <b className="cz-chip__v">{dockedSite ? depotDisplayLabel(dockedSite) : (docked?.stationName ?? snap?.navContext.starSystem ?? "…")}</b>
          </span>
          <span className="cz-chip" data-testid="phone-hold">
            <span className="cz-chip__k">Hold</span>
            <b className="cz-chip__v">{`${Math.round(used).toLocaleString("en-US")} / ${capacity != null ? t(capacity) : "? t"}`}</b>
          </span>
        </div>
      </header>
      <main className="cz-main cz-stack">
        {streamer ? null : (
          <p className="cz-note cz-note--info" style={{ margin: 0 }}>
            Phone view: what the PC knows, as it changes. Ticks, plans and settings are made in Colonize on the PC.
          </p>
        )}
        {dockedSite ? <DeliverHerePanel m={{ shipCargoByKey }} site={dockedSite} /> : null}
        {trips.length ? (
          <>
            <NextTripCard trips={trips} completed={completed} onToggle={noop} onBan={noop} readOnly />
            {trips.length > 1 ? <TripList trips={trips} completed={completed} onToggle={noop} onBan={noop} readOnly /> : null}
          </>
        ) : active.length ? (
          <p className="cz-dim" data-testid="phone-no-plan" style={{ margin: 0 }}>
            No haul plan yet: open Colonize on the PC and it makes one from the sellers it knows.
          </p>
        ) : null}
        <SitesColumn m={sitesModel} readOnly />
      </main>
      {streamer ? null : <AppLegalFooter />}
    </div>
  );
}
