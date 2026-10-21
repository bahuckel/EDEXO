import { buyStationPlaceKey } from "./buyStationMerge";
import type { MaterialBuyListing, MaterialBuyStationHit } from "./materialBuyIndexTypes";
import { lyOrLast } from "./systemDistanceLy";
import type { BasketCheckoutResult } from "./types";

/** Place-based, so the same station from two sources collapses to one row. */
function stationRowKey(st: MaterialBuyStationHit): string {
  return buyStationPlaceKey(st);
}

function sortHitsByDistance(a: MaterialBuyStationHit, b: MaterialBuyStationHit): number {
  const da = lyOrLast(a.distanceLy);
  const db = lyOrLast(b.distanceLy);
  return da - db || a.stationName.localeCompare(b.stationName);
}

export function mergeMaterialListings(plans: { materialListings?: MaterialBuyListing[] }[]): MaterialBuyListing[] {
  const byId = new Map<string, MaterialBuyListing>();
  for (const plan of plans) {
    for (const mat of plan.materialListings ?? []) {
      const prev = byId.get(mat.id);
      if (!prev) {
        byId.set(mat.id, {
          ...mat,
          stations: [...mat.stations].sort(sortHitsByDistance),
        });
        continue;
      }
      const stations = new Map<string, MaterialBuyStationHit>();
      for (const h of prev.stations) stations.set(stationRowKey(h), h);
      for (const h of mat.stations) {
        const k = stationRowKey(h);
        const old = stations.get(k);
        if (!old || sortHitsByDistance(h, old) < 0) {
          stations.set(k, h);
        } else if (!old.bodyName && h.bodyName) {
          stations.set(k, { ...old, bodyName: h.bodyName });
        }
      }
      byId.set(mat.id, {
        ...prev,
        quantityNeeded: Math.max(prev.quantityNeeded, mat.quantityNeeded),
        stations: [...stations.values()].sort(sortHitsByDistance),
        servedFromCache: prev.servedFromCache && mat.servedFromCache,
      });
    }
  }
  return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** Union material listings per construction ref — fresh search + background bundle both contribute. */
export function mergeCheckoutPlansByRef(plans: BasketCheckoutResult[]): BasketCheckoutResult[] {
  const out: BasketCheckoutResult[] = [];
  for (const plan of plans) {
    const key = plan.referenceSystem.trim().toLowerCase();
    if (!key) continue;
    const idx = out.findIndex((p) => p.referenceSystem.trim().toLowerCase() === key);
    if (idx < 0) {
      out.push(plan);
      continue;
    }
    const existing = out[idx]!;
    out[idx] = {
      ...existing,
      materialListings: mergeMaterialListings([existing, plan]),
      catalogStations: [...(existing.catalogStations ?? []), ...(plan.catalogStations ?? [])],
      unresolved: [...new Set([...existing.unresolved, ...plan.unresolved])],
      groups: existing.groups.length ? existing.groups : plan.groups,
    };
  }
  return out;
}

export const STATION_TONE_COUNT = 24;

function stationToneKey(systemName: string, stationName: string, marketId?: string | null): string {
  const mid = marketId?.trim();
  if (mid) return `m:${mid}`;
  return `s:${systemName.trim().toLowerCase()}\0${stationName.trim().toLowerCase()}`;
}

export function commodityToneByBuyStation(
  listings: MaterialBuyListing[],
  stationTones: Map<string, number>,
  assignments?: Record<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const mat of listings) {
    const nearest = mat.stations[0];
    if (!nearest) continue;
    const nameKey = nearest.stationName.trim().toLowerCase();
    const tone =
      stationTones.get(nameKey) ??
      assignments?.[nameKey] ??
      stationTones.get(stationToneKey(nearest.systemName, nearest.stationName, nearest.marketId));
    if (tone != null) out.set(mat.id, tone);
  }
  return out;
}

export function toneForStation(
  stationTones: Map<string, number>,
  systemName: string,
  stationName: string,
  marketId?: string | null,
  assignments?: Record<string, number>,
): number | null {
  const nameKey = stationName.trim().toLowerCase();
  const byStationName = stationTones.get(nameKey) ?? assignments?.[nameKey];
  if (byStationName != null) return byStationName;
  const mid = marketId?.trim();
  if (mid) {
    const byMarket = stationTones.get(`m:${mid}`);
    if (byMarket != null) return byMarket;
  }
  const sysKey = `s:${systemName.trim().toLowerCase()}\0${stationName.trim().toLowerCase()}`;
  const bySys = stationTones.get(sysKey);
  if (bySys != null) return bySys;
  return stationTones.get(stationToneKey(systemName, stationName, marketId)) ?? null;
}
