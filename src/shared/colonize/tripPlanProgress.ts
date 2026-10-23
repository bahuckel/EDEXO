import type { DepotSnapshot } from "./types";
import type { HaulTrip, LogisticsPlan } from "./logisticsPlanner";
import { storageGet, storageSet, storageRemove } from "./storage";
import { KEY_TRIP_PLAN } from "./uiStateKeys";

/** v3 since S-8: delivery lines are keyed by the site's market id, not its label. */
const TRIP_PLAN_SNAPSHOT_KEY = KEY_TRIP_PLAN;

export type ContributionBaseline = Record<string, Record<string, number>>;

export type TripPlanSnapshot = {
  planRefreshKey: string;
  plan: LogisticsPlan;
  baselineContributions: ContributionBaseline;
  /** User-toggled ○/✓ only — not cargo/contribution auto-detect. */
  manualCompletedLineIds: string[];
  createdAt: string;
  /**
   * The ticks of the last plans this one replaced, newest first (at most EARLIER_PLANS). The same key builds the same
   * plan, so going back to it (a filter switched off and on again, the other ship) brings its ticks back instead of
   * starting over (audit 2026-10-22: "calculations should be saved").
   */
  earlier?: EarlierPlanTicks[];
};

export type EarlierPlanTicks = {
  planRefreshKey: string;
  manualCompletedLineIds: string[];
  baselineContributions: ContributionBaseline;
};

const EARLIER_PLANS = 3;

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
 * Changes when the haul plan should be regenerated — including deliveries (what is left), see planLeftFingerprint.
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
  return `${planDepotFingerprint(depots)}|cap:${capacity ?? ""}|co:${checkoutsSig}|cn:${constraintsSig}|left:${planLeftFingerprint(depots)}`;
}

/**
 * What every site still needs. In the key since 2026-10-23 (owner: "make it automatically detect if a trip was done
 * out of order ... recalculate what's left and show a new order list based on what was completed"): a delivery to
 * any site, in any order, by the commander or a wingmate, makes a new plan from what is left, numbered from trip 1.
 * Before, only the requirements were in the key, so a trip hauled out of order stayed listed until ticked by hand.
 * Kept last in the key: the HUD tells a plan made for other sites by the part before "|cap:".
 */
function planLeftFingerprint(depots: DepotSnapshot[]): string {
  return depots
    .map((d) => {
      const left = d.resources
        .map((r) => `${r.name}:${Math.max(0, r.required - r.provided)}`)
        .sort()
        .join(",");
      return `${d.marketId}|${left}`;
    })
    .sort()
    .join(";");
}

/**
 * The sites part of planRefreshFingerprint: which sites, and what each requires. The HUD compares it with the saved
 * plan's key to tell a plan made for sites that have since finished (`"stale"`).
 */
export function planDepotFingerprint(depots: DepotSnapshot[]): string {
  return depots
    .map((d) => {
      const reqs = d.resources
        .map((r) => `${r.name}:${r.required}`)
        .sort()
        .join(",");
      return `${d.marketId}|${reqs}`;
    })
    .sort()
    .join(";");
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
  previous?: TripPlanSnapshot | null,
): TripPlanSnapshot {
  const fresh: TripPlanSnapshot = {
    planRefreshKey,
    // Plans are rebuilt fresh by buildLogisticsPlan and never mutated — store the reference.
    plan,
    baselineContributions: collectContributionBaseline(depots),
    manualCompletedLineIds: [],
    createdAt: new Date().toISOString(),
  };
  if (!previous || previous.planRefreshKey === planRefreshKey) return fresh;
  const kept: EarlierPlanTicks[] = [
    {
      planRefreshKey: previous.planRefreshKey,
      manualCompletedLineIds: previous.manualCompletedLineIds,
      baselineContributions: previous.baselineContributions,
    },
    ...(previous.earlier ?? []),
  ];
  // Back to a plan made before: its ticks and its starting point for deliveries, as they were.
  const back = kept.find((e) => e.planRefreshKey === planRefreshKey);
  if (back) {
    fresh.manualCompletedLineIds = [...back.manualCompletedLineIds];
    fresh.baselineContributions = back.baselineContributions;
  }
  const earlier = kept.filter((e) => e.planRefreshKey !== planRefreshKey).slice(0, EARLIER_PLANS);
  if (earlier.length) fresh.earlier = earlier;
  return fresh;
}

function parseEarlier(raw: unknown): EarlierPlanTicks[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: EarlierPlanTicks[] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    if (typeof r.planRefreshKey !== "string") continue;
    out.push({
      planRefreshKey: r.planRefreshKey,
      manualCompletedLineIds: Array.isArray(r.manualCompletedLineIds)
        ? r.manualCompletedLineIds.filter((id): id is string => typeof id === "string")
        : [],
      baselineContributions:
        r.baselineContributions && typeof r.baselineContributions === "object" ? (r.baselineContributions as ContributionBaseline) : {},
    });
    if (out.length >= EARLIER_PLANS) break;
  }
  return out.length ? out : undefined;
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

/** Every line of the trip (its buys, its deliveries) is done; a trip with no lines counts as done. */
export function isTripFullyComplete(trip: HaulTrip, completed: Set<string>): boolean {
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
  return [...walkTripProgress(snapshot, depots, cargoByKey, manualCompleted).completed];
}

/** The walk syncTripLineCompletions makes, keeping the trip it stopped at and the cargo left over after that trip. */
function walkTripProgress(
  snapshot: TripPlanSnapshot,
  depots: DepotSnapshot[],
  cargoByKey: Map<string, number>,
  manualCompleted: string[],
): { completed: Set<string>; trip: HaulTrip | null; pool: Map<string, number> } {
  const completed = new Set(manualCompleted);
  const delta = contributionDeltaTons(depots, snapshot.baselineContributions);
  const cargoPool = new Map(cargoByKey);

  for (const trip of snapshot.plan.trips) {
    consumeCompletedDeliverLines(trip, delta, completed);
    consumeCompletedBuyLines(trip, cargoPool, completed);

    if (isTripFullyComplete(trip, completed)) continue;

    autoCompleteDeliverLines(trip, delta, completed);
    autoCompleteBuyLines(trip, cargoPool, completed);
    return { completed, trip, pool: cargoPool };
  }

  return { completed, trip: null, pool: cargoPool };
}

/**
 * syncTripLineCompletions, plus how much of each open buy line of the current trip is aboard already: the HUD's bars
 * (owner, 2026-10-22: "amount changing dynamically with bars"). A done line is full; an open line takes what the hold
 * has left of its commodity, stops in order, so a commodity bought at two stops fills the first stop's line first.
 * From the same walk as the ticks, so a full bar is always a ticked line.
 */
export function tripBuyProgress(
  snapshot: TripPlanSnapshot,
  depots: DepotSnapshot[],
  cargoByKey: Map<string, number>,
  manualCompleted: string[],
): { completed: Set<string>; trip: HaulTrip | null; haveByLineId: Map<string, number> } {
  const walk = walkTripProgress(snapshot, depots, cargoByKey, manualCompleted);
  const haveByLineId = new Map<string, number>();
  if (walk.trip) {
    const pool = new Map(walk.pool);
    for (const stop of [...walk.trip.stops].sort((a, b) => a.stopIndex - b.stopIndex)) {
      if (stop.kind !== "buy") continue;
      for (const b of stop.buys) {
        const id = tripBuyLineId(walk.trip.tripNumber, stop.stopIndex, b.commodityId);
        if (walk.completed.has(id)) {
          haveByLineId.set(id, b.buyTons);
          continue;
        }
        const avail = Math.max(0, pool.get(b.commodityId) ?? 0);
        const have = Math.min(b.buyTons, avail);
        haveByLineId.set(id, have);
        pool.set(b.commodityId, avail - have);
      }
    }
  }
  return { completed: walk.completed, trip: walk.trip, haveByLineId };
}

/** A saved trip plan from its stored text (the server's HUD reads it the way the window does); null when unusable. */
export function parseTripPlanSnapshot(text: string | null | undefined): TripPlanSnapshot | null {
  if (!text) return null;
  try {
    return snapshotFromParsed(JSON.parse(text) as Record<string, unknown>);
  } catch {
    return null;
  }
}

function snapshotFromParsed(parsed: Record<string, unknown>): TripPlanSnapshot | null {
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
    ...(parseEarlier(parsed.earlier) ? { earlier: parseEarlier(parsed.earlier) } : {}),
  };
}

/**
 * In-memory copy — re-parsing a multi-hundred-KB JSON on every panel mount stalls tab switches. Kept with the text it
 * was parsed from: another window's ticks arrive as new text in storage (uiStateSync.ts), and must not be hidden by
 * this copy. A save still waiting in the debounce below is newer than storage, so it wins.
 */
let tripSnapshotCache: TripPlanSnapshot | null | undefined;
let tripSnapshotCacheText: string | null | undefined;

export function loadTripPlanSnapshot(): TripPlanSnapshot | null {
  if (pendingTripSave !== undefined) return tripSnapshotCache ?? null;
  try {
    const body = storageGet(TRIP_PLAN_SNAPSHOT_KEY);
    if (tripSnapshotCache !== undefined && body === tripSnapshotCacheText) return tripSnapshotCache;
    tripSnapshotCacheText = body;
    tripSnapshotCache = body ? snapshotFromParsed(JSON.parse(body) as Record<string, unknown>) : null;
  } catch {
    tripSnapshotCache = null;
  }
  return tripSnapshotCache;
}

function saveTripPlanSnapshot(snapshot: TripPlanSnapshot | null): void {
  tripSnapshotCache = snapshot;
  tripSnapshotCacheText = snapshot ? JSON.stringify(snapshot) : null;
  try {
    if (!snapshot) {
      storageRemove(TRIP_PLAN_SNAPSHOT_KEY);
      return;
    }
    storageSet(TRIP_PLAN_SNAPSHOT_KEY, tripSnapshotCacheText!);
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
