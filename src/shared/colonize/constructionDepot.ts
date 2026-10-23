import type { DepotSnapshot } from "./types";
import { exactStationNamesMatch, normStationName, normSystemName } from "./stationFilter";

/**
 * The minimum a caller must know about a construction site.
 *
 * Nullable on purpose: `DepotSnapshot` carries `string | null` for these fields,
 * and depot snapshots are passed straight in as refs from both processes.
 */
export type ConstructionDepotRef = {
  marketId?: string;
  starSystem?: string | null;
  systemName?: string | null;
  stationName?: string | null;
  constructionSiteLabel?: string | null;
  label?: string | null;
};

function depotSystemName(d: ConstructionDepotRef): string {
  return (d.starSystem ?? d.systemName ?? "").trim();
}

function depotStationNames(d: ConstructionDepotRef): string[] {
  return [d.stationName, d.constructionSiteLabel, d.label].filter((n): n is string => Boolean(n?.trim()));
}

const CONSTRUCTION_DEPOT_NAME_RE =
  /construction\s+(depot|site|platform|hub|installation)|orbital\s+construction|planetary\s+construction|colonisation\s+depot|colonization\s+depot/i;

/** Spansh/journal generic names for delivery-only markets. */
export function looksLikeConstructionDepotStation(
  stationName: string,
  stationType?: string | null,
): boolean {
  const name = stationName.trim();
  if (name && CONSTRUCTION_DEPOT_NAME_RE.test(name)) return true;
  const type = (stationType ?? "").trim();
  if (type && /construction/i.test(type) && /depot|site|platform|hub/i.test(type)) return true;
  return false;
}

/** Construction depots accept deliveries — they are never buy stations. */
export function isConstructionDepotStation(
  depots: ConstructionDepotRef[],
  args: {
    systemName: string;
    stationName: string;
    marketId?: string | null;
    stationType?: string | null;
  },
): boolean {
  const sys = normSystemName(args.systemName);
  if (!normStationName(args.stationName)) return false;
  for (const d of depots) {
    if (args.marketId && d.marketId && args.marketId === d.marketId) return true;
    const depotSys = normSystemName(depotSystemName(d));
    if (!depotSys || !sys || depotSys !== sys) continue;
    for (const name of depotStationNames(d)) {
      if (exactStationNamesMatch(name, args.stationName)) return true;
    }
    if (looksLikeConstructionDepotStation(args.stationName, args.stationType)) return true;
  }
  return false;
}

export function purgeConstructionDepotsFromShopHistory<T extends { systemName: string; stationName: string; marketId: string }>(
  history: T[],
  depots: DepotSnapshot[],
): T[] {
  return history.filter((h) => !isConstructionDepotStation(depots, h));
}
