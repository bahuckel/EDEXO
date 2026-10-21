import type { LogisticsPlan } from "./types";

/** Flatten a plan into the tick-list the Build tab shows. */

/** Flatten plan into a capacity-aware shopping run (buy quantities are per-stop caps, not total depot gaps). */
export function shoppingRunFromLogisticsPlan(plan: LogisticsPlan): {
  createdAt: string;
  items: {
    id: string;
    label: string;
    quantityNeeded: number;
    stopIndex: number;
    stationName: string;
    systemName: string;
    bodyName?: string | null;
    done: boolean;
  }[];
} {
  const items: {
    id: string;
    label: string;
    quantityNeeded: number;
    stopIndex: number;
    stationName: string;
    systemName: string;
    bodyName?: string | null;
    done: boolean;
  }[] = [];
  let globalStop = 0;
  for (const trip of plan.trips) {
    for (const stop of trip.stops) {
      if (stop.kind !== "buy") continue;
      for (const b of stop.buys) {
        items.push({
          id: b.commodityId,
          label: b.label,
          quantityNeeded: b.buyTons,
          stopIndex: globalStop,
          stationName: stop.stationName,
          systemName: stop.systemName,
          bodyName: stop.bodyName ?? null,
          done: false,
        });
      }
      globalStop++;
    }
  }
  return { createdAt: new Date().toISOString(), items };
}
