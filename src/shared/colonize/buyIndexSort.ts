import type { BuyIndexStationResult, BuyIndexSystemResult } from "./buyIndexSearchTypes";
import { lyOrLast } from "./systemDistanceLy";

/** Nearest to the construction site first, then by name. Used by both Search paths. */
export function sortSystemsByHop(a: BuyIndexSystemResult, b: BuyIndexSystemResult): number {
  const da = lyOrLast(a.minDistanceLy);
  const db = lyOrLast(b.minDistanceLy);
  if (da !== db) return da - db;
  return a.systemName.localeCompare(b.systemName);
}

export function sortStationsByHop(a: BuyIndexStationResult, b: BuyIndexStationResult): number {
  const da = lyOrLast(a.minDistanceLy);
  const db = lyOrLast(b.minDistanceLy);
  if (da !== db) return da - db;
  return a.stationName.localeCompare(b.stationName);
}
