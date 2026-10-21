/**
 * The HUD's Colonize section (1.3.0), built here from what the server already holds: the Colonize store's journal
 * state (sites, the hold, where the ship is docked) and the Colonize window's saved trip plan with its ticks
 * (ui-state.json). The window computes the plan; the HUD only reads where it says to go next, the same way the window
 * decides which trip is next (`syncTripLineCompletions`: ticks, cargo aboard, deliveries the sites recorded).
 *
 * Rebuilt when the store or the saved settings change, kept, and read by `buildSnapshot` at its own pace;
 * `onColonizeHudChange` lets the app push the HUD when it changes.
 */
import { carrierAvailability, mergeAvailability, type CarrierStock } from "../../shared/colonize/carrierStock";
import { resolveCargoCapacity } from "../../shared/colonize/cargoCapacityOverride";
import { commodityMergeBucket } from "../../shared/colonize/commodityKey";
import { depotDisplayLabel } from "../../shared/colonize/depotLabel";
import type { ColonizeHudDTO, ColonizeHudLine } from "../../shared/colonize/hud";
import {
  isTripFullyComplete,
  syncTripLineCompletions,
  tripBuyLineId,
  type TripPlanSnapshot,
} from "../../shared/colonize/tripPlanProgress";
import type { ColonizeSnapshot, DepotSnapshot } from "../../shared/colonize/types";

const MAX_SITES = 3;
const KEY_TRIPS = "edexo-colonize-trip-plan-snapshot-v3";
const KEY_CAPACITY = "edexo-colonize-cargo-capacity-v1";
const KEY_CARRIERS = "edexo-colonize-carrier-haul-v1";

const left = (r: DepotSnapshot["resources"][number]) => Math.max(0, r.required - r.provided);
const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

function parseJson(text: string | undefined): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** The saved plan, when it has trips (the window writes it; a torn or old one is ignored). */
function tripPlan(text: string | undefined): TripPlanSnapshot | null {
  const j = parseJson(text) as Partial<TripPlanSnapshot> | null;
  if (!j || typeof j !== "object" || !Array.isArray(j.plan?.trips) || !j.plan.trips.length) return null;
  return {
    planRefreshKey: String(j.planRefreshKey ?? ""),
    plan: j.plan,
    baselineContributions: j.baselineContributions && typeof j.baselineContributions === "object" ? j.baselineContributions : {},
    manualCompletedLineIds: Array.isArray(j.manualCompletedLineIds) ? j.manualCompletedLineIds.filter((x): x is string => typeof x === "string") : [],
    createdAt: String(j.createdAt ?? ""),
  };
}

function shipCargoByKey(snap: ColonizeSnapshot): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of snap.shipCargo) {
    const k = commodityMergeBucket(c.name) || commodityMergeBucket(c.nameLocalised);
    if (k) m.set(k, (m.get(k) ?? 0) + c.count);
  }
  return m;
}

function sitePct(d: DepotSnapshot): number {
  const required = d.resources.reduce((a, r) => a + r.required, 0);
  const remaining = d.resources.reduce((a, r) => a + left(r), 0);
  const pct = d.progress != null ? d.progress * 100 : required > 0 ? ((required - remaining) / required) * 100 : 0;
  return Math.max(0, Math.min(100, Math.floor(pct)));
}

/** Null when no site is being built: the section then has nothing to say. */
export function buildColonizeHud(snap: ColonizeSnapshot, ui: Record<string, string | undefined>): ColonizeHudDTO | null {
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
    leftTons: d.resources.reduce((a, r) => a + left(r), 0),
    docked: d.marketId === dockedId,
  }));

  const ship = shipCargoByKey(snap);
  const used = [...ship.values()].reduce((a, n) => a + n, 0);
  const override = Number(ui[KEY_CAPACITY]);
  const hold = { used, capacity: resolveCargoCapacity(snap.shipCargoCapacity, Number.isFinite(override) ? override : null) };

  // Docked at a site: what aboard it still needs.
  const dockedSite = active.find((d) => d.marketId === dockedId);
  let deliver: ColonizeHudDTO["deliver"] = null;
  if (dockedSite) {
    const lines: ColonizeHudLine[] = [];
    for (const r of dockedSite.resources) {
      const k = commodityMergeBucket(r.name) || commodityMergeBucket(r.nameLocalised);
      const give = Math.min(left(r), k ? (ship.get(k) ?? 0) : 0);
      if (give > 0) lines.push({ label: r.nameLocalised || r.name, tons: give });
    }
    deliver = { site: depotDisplayLabel(dockedSite), lines: lines.sort((a, b) => b.tons - a.tons) };
  }

  // The saved plan's next trip, decided as the window decides it.
  let next: ColonizeHudDTO["next"] = null;
  const plan = tripPlan(ui[KEY_TRIPS]);
  if (plan) {
    const haul = parseJson(ui[KEY_CARRIERS]) as Record<string, unknown> | null;
    const on = new Set(Object.entries(haul ?? {}).filter(([, v]) => v === true).map(([k]) => k));
    const carriers: CarrierStock[] = snap.carriers.filter((c) => on.has(c.carrierId));
    const cargo = mergeAvailability(ship, carrierAvailability(carriers, new Set(carriers.map((c) => c.carrierId))));
    const done = new Set(syncTripLineCompletions(plan, active, cargo, plan.manualCompletedLineIds));
    const trips = plan.plan.trips;
    const trip = trips.find((t) => !isTripFullyComplete(t, done));
    if (trip) {
      const buyStops = trip.stops.filter((s) => s.kind === "buy" && s.buys.length);
      const open = buyStops.find((s) => s.buys.some((b) => !done.has(tripBuyLineId(trip.tripNumber, s.stopIndex, b.commodityId))));
      const stop = open ?? trip.stops.find((s) => s.deliveries?.length) ?? trip.stops[0];
      if (stop) {
        next = {
          trip: trip.tripNumber,
          trips: trips.length,
          station: stop.stationName,
          system: stop.systemName,
          distanceLy: typeof stop.distanceLy === "number" ? stop.distanceLy : null,
          here: !!snap.liveDocked && norm(snap.liveDocked.stationName) === norm(stop.stationName),
          buys: (open ? stop.buys : []).map((b) => ({
            label: b.label,
            tons: b.buyTons,
            done: done.has(tripBuyLineId(trip.tripNumber, stop.stopIndex, b.commodityId)),
          })),
          deliverTo: [...new Set(trip.stops.flatMap((s) => (s.deliveries ?? []).map((d) => d.depotLabel)))],
        };
      }
    }
  }
  return { sites, moreSites: Math.max(0, active.length - MAX_SITES), deliver, next, hold };
}

/* ---- the copy the snapshot reads ----------------------------------------------------------------------------- */

let source: (() => { snap: ColonizeSnapshot; ui: Record<string, string | undefined> } | null) | null = null;
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
    next = s ? buildColonizeHud(s.snap, s.ui) : null;
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
