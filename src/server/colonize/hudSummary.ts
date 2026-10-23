/**
 * The HUD's Colonize section (1.3.0), built here from what the server already holds: the Colonize store's journal
 * state (sites, the hold, where the ship is docked) and the Colonize window's saved trip plan with its ticks
 * (ui-state.json). The window computes the plan; the HUD only reads where it says to go next, the same way the window
 * decides which trip is next (`syncTripLineCompletions`: ticks, cargo aboard, deliveries the sites recorded).
 *
 * Rebuilt when the store or the saved settings change, kept, and read by `buildSnapshot` at its own pace;
 * `onColonizeHudChange` lets the app push the HUD when it changes.
 */
import { carrierAvailability, carrierHaulIds, mergeAvailability, shipCargoByKey, type CarrierStock } from "../../shared/colonize/carrierStock";
import { resolveCargoCapacity } from "../../shared/colonize/cargoCapacityOverride";
import { depotDisplayLabel } from "../../shared/colonize/depotLabel";
import type { ColonizeHudDTO, ColonizeHudLine } from "../../shared/colonize/hud";
import { parseMarketId } from "../../shared/colonize/marketId";
import { siteMaterials, siteTotals, tonsLeftById } from "../../shared/colonize/siteMaterials";
import {
  isTripFullyComplete,
  parseTripPlanSnapshot,
  planDepotFingerprint,
  tripBuyLineId,
  tripBuyProgress,
  type TripPlanSnapshot,
} from "../../shared/colonize/tripPlanProgress";
import type { ColonizeSnapshot, DepotSnapshot } from "../../shared/colonize/types";
import { KEY_CARGO_CAPACITY, KEY_CARRIER_HAUL, KEY_TRIP_PLAN } from "../../shared/colonize/uiStateKeys";

const MAX_SITES = 3;

type Coords = [number, number, number];

/** Positions the server already holds (no network): the ship's system, and a system by name. */
export type HudPositions = {
  ship?: (snap: ColonizeSnapshot) => Coords | null;
  system?: (name: string) => Coords | null;
};

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/*
  The saved plan, parsed the way the window parses it, and only when its text changed: refreshes run on every store
  notify (every ~900 ms while docked at a site) and the plan is ~140 KB (audit 2026-10-22).
*/
let lastPlanText: string | undefined;
let lastPlan: TripPlanSnapshot | null = null;
function tripPlan(text: string | undefined): TripPlanSnapshot | null {
  if (text !== lastPlanText) {
    lastPlanText = text;
    lastPlan = parseTripPlanSnapshot(text);
  }
  return lastPlan;
}

const sitePct = (d: DepotSnapshot) => Math.floor(siteTotals(d).pct);

function distance(a: Coords | null | undefined, b: Coords | null | undefined): number | null {
  if (!a || !b) return null;
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Null when no site is being built: the section then has nothing to say. */
export function buildColonizeHud(
  snap: ColonizeSnapshot,
  ui: Record<string, string | undefined>,
  pos: HudPositions = {},
): ColonizeHudDTO | null {
  const active = snap.activeDepots;
  if (!active.length) return null;
  const dockedId = snap.liveDocked?.marketId ?? null;
  const ordered = [...active].sort(
    (a, b) => Number(b.marketId === dockedId) - Number(a.marketId === dockedId) || (b.lastTimestamp ?? "").localeCompare(a.lastTimestamp ?? ""),
  );
  const sites = ordered.slice(0, MAX_SITES).map((d) => ({
    marketId: d.marketId,
    label: depotDisplayLabel(d),
    system: d.starSystem,
    pct: sitePct(d),
    leftTons: siteTotals(d).remaining,
    docked: d.marketId === dockedId,
  }));

  const ship = shipCargoByKey(snap.shipCargo);
  const used = [...ship.values()].reduce((a, n) => a + n, 0);
  const override = Number(ui[KEY_CARGO_CAPACITY]);
  const hold = { used, capacity: resolveCargoCapacity(snap.shipCargoCapacity, Number.isFinite(override) ? override : null) };

  // Docked at a site: what aboard it still needs, biggest first.
  const dockedSite = active.find((d) => d.marketId === dockedId);
  let deliver: ColonizeHudDTO["deliver"] = null;
  if (dockedSite) {
    const lines: ColonizeHudLine[] = siteMaterials(dockedSite, ship)
      .filter((m) => m.aboard > 0)
      .map((m) => ({ label: m.label, tons: m.aboard }))
      .sort((a, b) => b.tons - a.tons);
    deliver = { site: depotDisplayLabel(dockedSite), lines };
  }

  // The saved plan's next trip, decided as the window decides it.
  let next: ColonizeHudDTO["next"] = null;
  let planState: NonNullable<ColonizeHudDTO["plan"]> = "none";
  let tripSiteId: string | null = null;
  const plan = tripPlan(ui[KEY_TRIP_PLAN]);
  if (plan?.plan.trips.length) {
    const on = carrierHaulIds(ui[KEY_CARRIER_HAUL]);
    const carriers: CarrierStock[] = snap.carriers.filter((c) => on.has(c.carrierId));
    const cargo = mergeAvailability(ship, carrierAvailability(carriers, new Set(carriers.map((c) => c.carrierId))));
    const progress = tripBuyProgress(plan, active, cargo, plan.manualCompletedLineIds);
    const done = progress.completed;
    const trips = plan.plan.trips;
    const trip = progress.trip ?? trips.find((t) => !isTripFullyComplete(t, done));
    // A plan made for another set of sites (one finished, a new one started): still shown, flagged.
    const stale = !plan.planRefreshKey.startsWith(`${planDepotFingerprint(active)}|cap:`);
    planState = trip ? (stale ? "stale" : "active") : "done";
    if (trip) {
      // A commodity no site needs any more (delivered in full, by anyone) is finished: off the HUD (owner, 2026-10-22).
      const stillNeeded = tonsLeftById(active);
      const needed = (id: string) => (stillNeeded.get(id) ?? 1) > 0;
      const buyStops = trip.stops.filter((s) => s.kind === "buy" && s.buys.length);
      const open = buyStops.find((s) =>
        s.buys.some((b) => needed(b.commodityId) && !done.has(tripBuyLineId(trip.tripNumber, s.stopIndex, b.commodityId))),
      );
      const deliverStop = trip.stops.find((s) => s.deliveries?.length);
      const stop = open ?? deliverStop ?? trip.stops[0];
      tripSiteId = deliverStop?.deliveries?.[0]?.depotMarketId || null;
      if (stop) {
        const docked = snap.liveDocked;
        const stopMid = parseMarketId(stop.marketId);
        // By market id, else name and system: a station name alone repeats across systems (audit 2026-10-22).
        const here =
          !!docked &&
          ((!!stopMid && stopMid === docked.marketId) ||
            (norm(docked.stationName) === norm(stop.stationName) && norm(docked.starSystem) === norm(stop.systemName)));
        next = {
          trip: trip.tripNumber,
          trips: trips.length,
          kind: open ? "buy" : "deliver",
          station: stop.stationName,
          system: stop.systemName,
          distanceLy: typeof stop.distanceLy === "number" ? stop.distanceLy : null,
          fromShipLy: distance(pos.ship?.(snap), pos.system?.(stop.systemName)),
          here,
          buys: (open ? stop.buys : [])
            .filter((b) => needed(b.commodityId))
            .map((b) => {
              const id = tripBuyLineId(trip.tripNumber, stop.stopIndex, b.commodityId);
              return {
                commodityId: b.commodityId,
                label: b.label,
                tons: b.buyTons,
                have: Math.min(b.buyTons, progress.haveByLineId.get(id) ?? 0),
                done: done.has(id),
              };
            }),
          deliverTo: [...new Set(trip.stops.flatMap((s) => (s.deliveries ?? []).map((d) => d.depotLabel)))],
        };
      }
    }
  }

  // The site to follow: docked at it, else where the current trip delivers, else the most recent.
  const targetSite = dockedSite ?? (tripSiteId ? active.find((d) => d.marketId === tripSiteId) : undefined) ?? ordered[0]!;
  const target: ColonizeHudDTO["target"] = {
    marketId: targetSite.marketId,
    label: depotDisplayLabel(targetSite),
    system: targetSite.starSystem,
    pct: sitePct(targetSite),
    leftTons: siteTotals(targetSite).remaining,
    needs: siteMaterials(targetSite, ship).map((m) => ({
      commodityId: m.id,
      label: m.label,
      required: m.required,
      provided: m.provided,
      aboard: m.aboard,
      done: m.done,
    })),
  };

  return { sites, moreSites: Math.max(0, active.length - MAX_SITES), deliver, next, target, plan: planState, hold };
}

/* ---- the copy the snapshot reads ----------------------------------------------------------------------------- */

let source: (() => { snap: ColonizeSnapshot; ui: Record<string, string | undefined>; pos?: HudPositions } | null) | null = null;
let current: ColonizeHudDTO | null = null;
let currentSig = "null";
const listeners = new Set<() => void>();

/** Set by the Colonize service while it runs (colonizeService.ts); null when it stops. */
export function setColonizeHudSource(next: typeof source): void {
  source = next;
  refreshColonizeHud();
}

/** Rebuilds the section's data; tells the listeners only when it changed. */
export function refreshColonizeHud(): void {
  let next: ColonizeHudDTO | null = null;
  try {
    const s = source?.();
    next = s ? buildColonizeHud(s.snap, s.ui, s.pos) : null;
  } catch (e) {
    console.error("[colonize] HUD summary failed:", e);
  }
  const sig = JSON.stringify(next);
  if (sig === currentSig) return;
  current = next;
  currentSig = sig;
  for (const fn of listeners) fn();
}

export function getColonizeHud(): ColonizeHudDTO | null {
  return current;
}

export function onColonizeHudChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
