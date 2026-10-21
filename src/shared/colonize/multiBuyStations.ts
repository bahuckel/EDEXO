import type { Ly } from "./systemDistanceLy";
import type { MaterialBuyListing } from "./materialBuyIndexTypes";
import { lyOrLast, nearerLy } from "./systemDistanceLy";

export type MultiBuyMaterial = {
  id: string;
  label: string;
  supply: number | null;
};

export type MultiBuyStationGroup = {
  systemName: string;
  stationName: string;
  distanceLy: Ly;
  materials: MultiBuyMaterial[];
};

function stationKey(systemName: string, stationName: string): string {
  return `${systemName.trim().toLowerCase()}\0${stationName.trim().toLowerCase()}`;
}

/** Stations in the local buy index that sell two or more remaining project materials. */
export function groupStationsSellingMultipleRemaining(
  listings: MaterialBuyListing[],
): MultiBuyStationGroup[] {
  type Acc = {
    systemName: string;
    stationName: string;
    distanceLy: Ly;
    materials: Map<string, MultiBuyMaterial>;
  };
  const byStation = new Map<string, Acc>();
  for (const listing of listings) {
    if (!listing.quantityNeeded || listing.quantityNeeded <= 0) continue;
    for (const st of listing.stations) {
      const sys = st.systemName?.trim() || "";
      const sta = st.stationName?.trim() || "";
      if (!sys || !sta) continue;
      const key = stationKey(sys, sta);
      let acc = byStation.get(key);
      if (!acc) {
        acc = {
          systemName: sys,
          stationName: sta,
          distanceLy: st.distanceLy,
          materials: new Map(),
        };
        byStation.set(key, acc);
      }
      acc.distanceLy = nearerLy(acc.distanceLy, st.distanceLy);
      if (!acc.materials.has(listing.id)) {
        acc.materials.set(listing.id, {
          id: listing.id,
          label: listing.label,
          supply: st.supply ?? null,
        });
      }
    }
  }
  return [...byStation.values()]
    .filter((a) => a.materials.size >= 2)
    .map((a) => ({
      systemName: a.systemName,
      stationName: a.stationName,
      distanceLy: a.distanceLy,
      materials: [...a.materials.values()].sort((x, y) => x.label.localeCompare(y.label)),
    }))
    .sort((a, b) => {
      const da = lyOrLast(a.distanceLy);
      const db = lyOrLast(b.distanceLy);
      if (da !== db) return da - db;
      if (b.materials.length !== a.materials.length) return b.materials.length - a.materials.length;
      return a.stationName.localeCompare(b.stationName);
    });
}
