import { buyStationPlaceKey } from "../buyStationMerge";
import type { ListingProof } from "./types";

/** Identity for a physical station, and the record of what listings prove it sells. */

/** Stable planner key — same physical station even when only one source has a market id. */
export function catalogStationKey(
  systemName: string,
  stationName: string,
  _marketId?: string | null,
): string {
  return buyStationPlaceKey({ systemName, stationName });
}

export function stationKey(systemName: string, stationName: string): string {
  return catalogStationKey(systemName, stationName);
}

export function markStationSells(proof: ListingProof, stationK: string, commodityId: string): void {
  let set = proof.get(stationK);
  if (!set) {
    set = new Set();
    proof.set(stationK, set);
  }
  set.add(commodityId);
}

export function stationSellsCommodity(proof: ListingProof, stationK: string, commodityId: string): boolean {
  return proof.get(stationK)?.has(commodityId) ?? false;
}

export function stationMatches(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}
