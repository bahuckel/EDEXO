import { depotDisplayLabel } from "./depotLabel";
import type { DepotSnapshot } from "./types";
import type { HaulTrip, LogisticsPlan } from "./logisticsPlanner";
import { storageGet, storageSet, storageRemove } from "./storage";

/**
 * v3 since S-8: delivery lines are keyed by the site's market id, not its label. A v2 snapshot is
 * still read, flagged `legacyDepotLabels`, and converted by `adoptLegacyDepotIds` once the sites
 * are known; the v2 key is removed on the first v3 save.
 */
const TRIP_PLAN_SNAPSHOT_KEY = "edexo-colonize-trip-plan-snapshot-v3";
const LEGACY_TRIP_PLAN_SNAPSHOT_KEY = "edexo-colonize-trip-plan-snapshot-v2";

export type ContributionBaseline = Record<string, Record<string, number>>;

export type TripPlanSnapshot = {
  planRefreshKey: string;
  plan: LogisticsPlan;
  baselineContributions: ContributionBaseline;
  /** User-toggled ○/✓ only — not cargo/contribution auto-detect. */
  manualCompletedLineIds: string[];
  createdAt: string;
  /** Read from a v2 snapshot: deliveries name sites by label only. See `adoptLegacyDepotIds`. */
  legacyDepotLabels?: boolean;
};

export function tripBuyLineId(tripNumber: number, stopIndex: number, commodityId: string): string {
  return `t${tripNumber}-s${stopIndex}-b-${commodityId}`;
}

export function tripDeliverLineId(
  tripNumber: number,
  stopIndex: number,
  depotMarketId: string,
  commodityId: string,
): string {
  return `t${tripNumber}-s${stopIndex}-d-${depotMarketId}-${commodityId}`;
}

/**
 * Convert a v2 snapshot, whose deliveries name sites by label, once the sites are known.
 *
 * A label is resolved to the first site that carries it — exactly what v2 itself did, so a plan
 * made before the upgrade keeps meaning what it meant. Manual ticks are carried across to the new
 * line ids, so nothing the commander ticked is lost. A label no active site carries any more (the
 * site finished) keeps an empty id: its lines stay distinct, and nothing can auto-complete them.
 */
export function adoptLegacyDepotIds(snapshot: TripPlanSnapshot, depots: DepotSnapshot[]): TripPlanSnapshot {
  if (!snapshot.legacyDepotLabels) return snapshot;
  const idByLabel = new Map<string, string>();
  for (const d of depots) {
    const label = depotDisplayLabel(d);
    if (!idByLabel.has(label)) idByLabel.set(label, d.marketId);
  }
  const manual = new Set(snapshot.manualCompletedLineIds);
  const trips = snapshot.plan.trips.map((trip) => ({
    ...trip,
    stops: trip.stops.map((stop) =>
      stop.deliveries
        ? {
            ...stop,
            deliveries: stop.deliveries.map((depot) => {
              const marketId = depot.depotMarketId || idByLabel.get(depot.depotLabel) || "";
              for (const m of depot.materials) {
                const v2Id = `t${trip.tripNumber}-s${stop.stopIndex}-d-${depot.depotLabel}-${m.commodityId}`;
                if (!manual.delete(v2Id)) continue;
                manual.add(tripDeliverLineId(trip.tripNumber, stop.stopIndex, marketId, m.commodityId));
              }
              return { ...depot, depotMarketId: marketId };
            }),
          }
        : stop,
    ),
  }));
  const adopted: TripPlanSnapshot = { ...snapshot, plan: { ...snapshot.plan, trips }, manualCompletedLineIds: [...manual] };
  delete adopted.legacyDepotLabels;
  return adopted;
}

/**
 * Changes when the haul plan should be regenerated — deliveries (provided) do not affect this.
 *
 * `constraintsSig` carries whatever else changes the shape of a plan: landing-pad and
 * distance filters, banned stations, wing claims, the docked station. Without it a filter
 * change left the pinned snapshot in place, and since a pinned plan is preferred whenever
 * the live one has no trips, the screen kept showing a plan built under the old filters.
 */
export function planRefreshFingerprint(
  depots: DepotSnapshot[],
  capacity: number | null | undefined,
  checkoutsSig: string,
  constraintsSig = "",
): string {
  const depotPart = depots
    .map((d) => {
      const reqs = d.resources
        .map((r) => `${r.name}:${r.required}`)
        .sort()
        .join(",");
      return `${d.marketId}|${reqs}`;
    })
    .sort()
    .join(";");
  return `${depotPart}|cap:${capacity ?? ""}|co:${checkoutsSig}|cn:${constraintsSig}`;
}

function collectContributionBaseline(depots: DepotSnapshot[]): ContributionBaseline {
  const out: ContributionBaseline = {};
  for (const d of depots) {
    const row: Record<string, number> = {};
    for (const c of d.contributions ?? []) {
      row[c.commodityId] = c.totalTons;
    }
    out[d.marketId] = row;
  }
  return out;
}

/**
 * Keep pinned haul trips visible while construction is active — live replanning
 * drops trips once cargo covers buy gaps, even before the deliver stop is done.
 */
export function resolveDisplayLogisticsPlan(args: {
  live: LogisticsPlan | null;
  snapshot: TripPlanSnapshot | null;
  planRefreshKey: string;
  hasActiveDepots: boolean;
}): LogisticsPlan | null {
  const { live, snapshot, planRefreshKey, hasActiveDepots } = args;
  if (!live) return snapshot?.plan ?? null;
  if (
    hasActiveDepots &&
    snapshot?.planRefreshKey === planRefreshKey &&
    snapshot.plan.trips.length > 0 &&
    live.trips.length === 0
  ) {
    return {
      ...snapshot.plan,
      cargoOnHand: live.cargoOnHand,
      cargoFree: live.cargoFree,
      totalRemainingTons: live.totalRemainingTons,
      warnings: live.warnings.length ? live.warnings : snapshot.plan.warnings,
      missingBuyIndexed: live.missingBuyIndexed.length
        ? live.missingBuyIndexed
        : snapshot.plan.missingBuyIndexed ?? [],
      missingTripEligible: live.missingTripEligible.length
        ? live.missingTripEligible
        : snapshot.plan.missingTripEligible ?? [],
      dockBuys: live.dockBuys.length ? live.dockBuys : snapshot.plan.dockBuys,
      buyStationKeyByCommodityId:
        live.buyStationKeyByCommodityId ?? snapshot.plan.buyStationKeyByCommodityId,
    };
  }
  return live;
}

export function createTripPlanSnapshot(
  plan: LogisticsPlan,
  planRefreshKey: string,
  depots: DepotSnapshot[],
): TripPlanSnapshot {
  return {
    planRefreshKey,
    // Plans are rebuilt fresh by buildLogisticsPlan and never mutated — store the reference.
    plan,
    baselineContributions: collectContributionBaseline(depots),
    manualCompletedLineIds: [],
    createdAt: new Date().toISOString(),
  };
}

function contributionDeltaTons(
  depots: DepotSnapshot[],
  baseline: ContributionBaseline,
): Map<string, Map<string, number>> {
  const delta = new Map<string, Map<string, number>>();
  for (const d of depots) {
    const baseRow = baseline[d.marketId] ?? {};
    for (const c of d.contributions ?? []) {
      const base = baseRow[c.commodityId] ?? 0;
      const extra = c.totalTons - base;
      if (extra <= 0.01) continue;
      let row = delta.get(d.marketId);
      if (!row) {
        row = new Map();
        delta.set(d.marketId, row);
      }
      row.set(c.commodityId, (row.get(c.commodityId) ?? 0) + extra);
    }
  }
  return delta;
}

function collectTripLineIds(trip: HaulTrip): string[] {
  const ids: string[] = [];
  for (const stop of trip.stops) {
    if (stop.kind === "buy") {
      for (const b of stop.buys) {
        ids.push(tripBuyLineId(trip.tripNumber, stop.stopIndex, b.commodityId));
      }
    } else if (stop.kind === "deliver" && stop.deliveries?.length) {
      for (const depot of stop.deliveries) {
        for (const m of depot.materials) {
          ids.push(tripDeliverLineId(trip.tripNumber, stop.stopIndex, depot.depotMarketId, m.commodityId));
        }
      }
    }
  }
  return ids;
}

function isTripFullyComplete(trip: HaulTrip, completed: Set<string>): boolean {
  const ids = collectTripLineIds(trip);
  if (!ids.length) return true;
  return ids.every((id) => completed.has(id));
}

function consumeCompletedDeliverLines(
  trip: HaulTrip,
  delta: Map<string, Map<string, number>>,
  completed: Set<string>,
): void {
  for (const stop of trip.stops) {
    if (stop.kind !== "deliver" || !stop.deliveries?.length) continue;
    for (const depot of stop.deliveries) {
      const row = delta.get(depot.depotMarketId);
      if (!row) continue;
      for (const m of depot.materials) {
        const lineId = tripDeliverLineId(trip.tripNumber, stop.stopIndex, depot.depotMarketId, m.commodityId);
        if (!completed.has(lineId)) continue;
        row.set(m.commodityId, Math.max(0, (row.get(m.commodityId) ?? 0) - m.tons));
      }
    }
  }
}

function autoCompleteDeliverLines(
  trip: HaulTrip,
  delta: Map<string, Map<string, number>>,
  completed: Set<string>,
): void {
  for (const stop of trip.stops) {
    if (stop.kind !== "deliver" || !stop.deliveries?.length) continue;
    for (const depot of stop.deliveries) {
      const row = delta.get(depot.depotMarketId);
      if (!row) continue;
      for (const m of depot.materials) {
        const lineId = tripDeliverLineId(trip.tripNumber, stop.stopIndex, depot.depotMarketId, m.commodityId);
        if (completed.has(lineId)) continue;
        const avail = row.get(m.commodityId) ?? 0;
        if (avail >= m.tons - 0.01) {
          completed.add(lineId);
          row.set(m.commodityId, avail - m.tons);
        }
      }
    }
  }
}

/** True once every delivery this trip schedules has been ticked off. */
function tripDeliveriesComplete(trip: HaulTrip, completed: Set<string>): boolean {
  let sawDelivery = false;
  for (const stop of trip.stops) {
    if (stop.kind !== "deliver" || !stop.deliveries?.length) continue;
    for (const depot of stop.deliveries) {
      for (const m of depot.materials) {
        sawDelivery = true;
        if (!completed.has(tripDeliverLineId(trip.tripNumber, stop.stopIndex, depot.depotMarketId, m.commodityId))) {
          return false;
        }
      }
    }
  }
  return sawDelivery;
}

/**
 * Account for goods an earlier trip has already bought so the next trip's auto-detect
 * sees only what is left of the hold.
 *
 * Skipped once the trip's deliveries are done: those tons were unloaded at the site and
 * are not in the hold any more, so subtracting them drove the pool negative and stopped
 * every later trip from ever auto-completing its buy lines.
 */
function consumeCompletedBuyLines(trip: HaulTrip, cargoPool: Map<string, number>, completed: Set<string>): void {
  if (tripDeliveriesComplete(trip, completed)) return;
  for (const stop of trip.stops) {
    if (stop.kind !== "buy") continue;
    for (const b of stop.buys) {
      const lineId = tripBuyLineId(trip.tripNumber, stop.stopIndex, b.commodityId);
      if (!completed.has(lineId)) continue;
      cargoPool.set(b.commodityId, Math.max(0, (cargoPool.get(b.commodityId) ?? 0) - b.buyTons));
    }
  }
}

function autoCompleteBuyLines(trip: HaulTrip, cargoPool: Map<string, number>, completed: Set<string>): void {
  for (const stop of trip.stops) {
    if (stop.kind !== "buy") continue;
    for (const b of stop.buys) {
      const lineId = tripBuyLineId(trip.tripNumber, stop.stopIndex, b.commodityId);
      if (completed.has(lineId)) continue;
      const avail = cargoPool.get(b.commodityId) ?? 0;
      if (avail >= b.buyTons - 0.01) {
        completed.add(lineId);
        cargoPool.set(b.commodityId, avail - b.buyTons);
      }
    }
  }
}

/**
 * Mark trip lines done in plan order — cargo and deliveries only apply to the
 * first trip that is not fully complete (later trips wait until earlier ones finish).
 */
export function syncTripLineCompletions(
  snapshot: TripPlanSnapshot,
  depots: DepotSnapshot[],
  cargoByKey: Map<string, number>,
  manualCompleted: string[],
): string[] {
  const completed = new Set(manualCompleted);
  const delta = contributionDeltaTons(depots, snapshot.baselineContributions);
  const cargoPool = new Map(cargoByKey);

  for (const trip of snapshot.plan.trips) {
    consumeCompletedDeliverLines(trip, delta, completed);
    consumeCompletedBuyLines(trip, cargoPool, completed);

    if (isTripFullyComplete(trip, completed)) continue;

    autoCompleteDeliverLines(trip, delta, completed);
    autoCompleteBuyLines(trip, cargoPool, completed);
    break;
  }

  return [...completed];
}

function migrateTripPlanSnapshot(parsed: Record<string, unknown>, legacyDepotLabels: boolean): TripPlanSnapshot | null {
  if (!parsed || typeof parsed !== "object") return null;
  const plan = parsed.plan as LogisticsPlan | undefined;
  const planRefreshKey = parsed.planRefreshKey;
  if (!plan?.trips?.length || typeof planRefreshKey !== "string") return null;
  const manual =
    Array.isArray(parsed.manualCompletedLineIds)
      ? parsed.manualCompletedLineIds.filter((id): id is string => typeof id === "string")
      : [];
  return {
    planRefreshKey,
    plan,
    baselineContributions: (parsed.baselineContributions as ContributionBaseline) ?? collectContributionBaseline([]),
    manualCompletedLineIds: manual,
    createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
    ...(legacyDepotLabels ? { legacyDepotLabels: true } : {}),
  };
}

/** In-memory copy — re-parsing a multi-hundred-KB JSON on every panel mount stalls tab switches. */
let tripSnapshotCache: TripPlanSnapshot | null | undefined;

export function loadTripPlanSnapshot(): TripPlanSnapshot | null {
  if (tripSnapshotCache !== undefined) return tripSnapshotCache;
  try {
    const raw = storageGet(TRIP_PLAN_SNAPSHOT_KEY);
    const legacy = raw ? null : storageGet(LEGACY_TRIP_PLAN_SNAPSHOT_KEY);
    const body = raw ?? legacy;
    tripSnapshotCache = body
      ? migrateTripPlanSnapshot(JSON.parse(body) as Record<string, unknown>, legacy != null)
      : null;
  } catch {
    tripSnapshotCache = null;
  }
  return tripSnapshotCache;
}

function saveTripPlanSnapshot(snapshot: TripPlanSnapshot | null): void {
  tripSnapshotCache = snapshot;
  try {
    if (!snapshot) {
      storageRemove(TRIP_PLAN_SNAPSHOT_KEY);
      storageRemove(LEGACY_TRIP_PLAN_SNAPSHOT_KEY);
      return;
    }
    storageSet(TRIP_PLAN_SNAPSHOT_KEY, JSON.stringify(snapshot));
    /** Written in the new shape; the old one would otherwise be read again after a v3 clear. */
    if (!snapshot.legacyDepotLabels) storageRemove(LEGACY_TRIP_PLAN_SNAPSHOT_KEY);
  } catch {
    /* */
  }
}

let pendingTripSave: TripPlanSnapshot | null | undefined;
let tripSaveTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced persist — avoids blocking the UI thread on every trip checkbox click. */
export function scheduleSaveTripPlanSnapshot(snapshot: TripPlanSnapshot | null, debounceMs = 450): void {
  tripSnapshotCache = snapshot;
  pendingTripSave = snapshot;
  if (tripSaveTimer != null) clearTimeout(tripSaveTimer);
  tripSaveTimer = setTimeout(() => {
    tripSaveTimer = null;
    const next = pendingTripSave;
    pendingTripSave = undefined;
    saveTripPlanSnapshot(next ?? null);
  }, debounceMs);
}

export function clearTripPlanSnapshot(): void {
  pendingTripSave = undefined;
  if (tripSaveTimer != null) {
    clearTimeout(tripSaveTimer);
    tripSaveTimer = null;
  }
  saveTripPlanSnapshot(null);
}
