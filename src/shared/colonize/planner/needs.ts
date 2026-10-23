import { makeCargoPool, tonsStillNeededWithPool } from "../basketGap";
import { itemLabel, resourceNeedId } from "../commodityKey";
import type { DepotSnapshot } from "../types";
import { uniqueDepotLabels } from "../depotLabel";
import type { WingMember } from "../wingManifest";
import { consumeWingTonsForDepot, makeWingClaimPool } from "../wingManifest";
import type { DepotNeedState, PlannerNeed, TripAllocationMap, TripDeliverDepot, TripStop } from "./types";

/** What each site still wants, and who gets the tons once they are bought. */

export function collectPlannerNeeds(
  depots: DepotSnapshot[],
  cargoByKey: Map<string, number>,
  wing: WingMember[],
): Map<string, PlannerNeed> {
  const acc = new Map<string, PlannerNeed>();
  const cargoPool = makeCargoPool(cargoByKey);
  const wingPool = makeWingClaimPool(wing);
  const labels = uniqueDepotLabels(depots);
  for (const d of depots) {
    const depotLabel = labels.get(d.marketId)!;
    for (const r of d.resources) {
      let need = tonsStillNeededWithPool(r, cargoPool);
      if (need <= 0) continue;
      const id = resourceNeedId(r);
      if (!id) continue;
      const wingT = consumeWingTonsForDepot({
        members: wing,
        commodityId: id,
        depotMarketId: d.marketId,
        untargetedPool: wingPool,
        needTons: need,
      });
      need = Math.max(0, need - wingT);
      if (need <= 0) continue;
      const label = itemLabel(r);
      let cur = acc.get(id);
      if (!cur) {
        cur = { commodityId: id, label, tons: 0, forDepots: [] };
        acc.set(id, cur);
      }
      cur.tons += need;
      if (!cur.forDepots.includes(depotLabel)) cur.forDepots.push(depotLabel);
    }
  }
  return acc;
}

export function totalNeedTons(needs: Map<string, PlannerNeed>): number {
  let s = 0;
  for (const n of needs.values()) s += n.tons;
  return s;
}

export function sumCargo(cargo: Map<string, number>): number {
  let s = 0;
  for (const v of cargo.values()) s += v;
  return s;
}

export function buildDepotNeedStates(depots: DepotSnapshot[], wing: WingMember[]): DepotNeedState[] {
  const wingPool = makeWingClaimPool(wing);
  const labels = uniqueDepotLabels(depots);
  return depots.map((d) => {
    const label = labels.get(d.marketId)!;
    const needs = new Map<string, { label: string; tons: number }>();
    for (const r of d.resources) {
      const gap = Math.max(0, r.required - r.provided);
      if (gap <= 0) continue;
      const id = resourceNeedId(r);
      if (!id) continue;
      let tons = gap;
      const wingT = consumeWingTonsForDepot({
        members: wing,
        commodityId: id,
        depotMarketId: d.marketId,
        untargetedPool: wingPool,
        needTons: tons,
      });
      tons = Math.max(0, tons - wingT);
      if (tons <= 0) continue;
      const rowLabel = itemLabel(r);
      needs.set(id, { label: rowLabel, tons });
    }
    return {
      marketId: d.marketId,
      label,
      systemName: d.starSystem?.trim() || "Construction",
      needs,
    };
  });
}

/**
 * Assign bought tons to the depots that still need them, and report which ones got any.
 *
 * The caller needs that list: a buy line used to advertise every depot wanting the
 * commodity, so a card could read "for Site A - Site B" while the trip only ever
 * delivered to Site A.
 */
export function recordTripAllocation(
  tripAllocation: TripAllocationMap,
  depotStates: DepotNeedState[],
  commodityId: string,
  label: string,
  tons: number,
): string[] {
  const allocatedTo: string[] = [];
  if (tons <= 0) return allocatedTo;
  let left = tons;
  for (const d of depotStates) {
    const row = d.needs.get(commodityId);
    if (!row || row.tons <= 0) continue;
    const take = Math.min(left, row.tons);
    if (take <= 0) continue;
    row.tons -= take;
    left -= take;
    let perDepot = tripAllocation.get(d.marketId);
    if (!perDepot) {
      perDepot = new Map();
      tripAllocation.set(d.marketId, perDepot);
    }
    const prev = perDepot.get(commodityId);
    if (prev) prev.tons += take;
    else perDepot.set(commodityId, { commodityId, label, tons: take });
    if (!allocatedTo.includes(d.label)) allocatedTo.push(d.label);
    if (left <= 0) break;
  }
  return allocatedTo;
}

function buildDeliveriesFromAllocation(
  tripAllocation: TripAllocationMap,
  depotStates: DepotNeedState[],
): TripDeliverDepot[] {
  const out: TripDeliverDepot[] = [];
  for (const d of depotStates) {
    const perDepot = tripAllocation.get(d.marketId);
    if (!perDepot?.size) continue;
    const materials = [...perDepot.values()].filter((m) => m.tons > 0);
    if (!materials.length) continue;
    out.push({
      depotMarketId: d.marketId,
      depotLabel: d.label,
      systemName: d.systemName,
      materials,
    });
  }
  return out;
}

/**
 * One deliver stop per system, not one stop for all of them.
 *
 * A single stop used to be emitted and labelled with the first depot's star system, so a
 * build spanning two systems showed everything dropping at whichever site happened to be
 * first, at 0 Ly. Deliveries already carry their own system; this groups by it.
 *
 * Ordering between systems follows depot order, which is stable but not distance-aware —
 * the planner has no site-to-site distances yet.
 *
 * `cargoLoaded` stays what it was: the hold on arrival at that stop, so it falls across
 * successive drops and is unchanged for the single-system case.
 */
export function makeDeliverStops(
  startIndex: number,
  tripAllocation: TripAllocationMap,
  depotStates: DepotNeedState[],
  cargoLoaded: number,
  fallbackSystem: string,
): TripStop[] {
  const deliveries = buildDeliveriesFromAllocation(tripAllocation, depotStates);
  if (!deliveries.length) return [];

  const bySystem = new Map<string, TripDeliverDepot[]>();
  for (const d of deliveries) {
    const key = d.systemName?.trim() || fallbackSystem;
    const list = bySystem.get(key) ?? [];
    list.push(d);
    bySystem.set(key, list);
  }

  const stops: TripStop[] = [];
  let holdOnArrival = cargoLoaded;
  let stopIndex = startIndex;
  for (const [systemName, group] of bySystem) {
    stops.push({
      stopIndex: stopIndex++,
      kind: "deliver",
      systemName,
      stationName: group.map((d) => d.depotLabel).join(" · ") || "Construction sites",
      distanceLy: 0,
      buys: [],
      deliverTo: group.map((d) => d.depotLabel),
      deliveries: group,
      cargoLoaded: holdOnArrival,
    });
    holdOnArrival -= group.reduce((sum, d) => sum + d.materials.reduce((t, m) => t + m.tons, 0), 0);
  }
  return stops;
}

function commodityLabelFromDepots(depotStates: DepotNeedState[], commodityId: string): string {
  for (const d of depotStates) {
    const row = d.needs.get(commodityId);
    if (row) return row.label;
  }
  return commodityId;
}

export function seedTripAllocationFromCargo(
  tripAllocation: TripAllocationMap,
  depotStates: DepotNeedState[],
  cargoByKey: Map<string, number>,
): void {
  for (const [id, onHand] of cargoByKey) {
    if (onHand <= 0) continue;
    recordTripAllocation(tripAllocation, depotStates, id, commodityLabelFromDepots(depotStates, id), onHand);
  }
}
