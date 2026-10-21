import type { MaterialBuyStationHit } from "./materialBuyIndexTypes";
import { hasBoughtFromStation, isRecentShopStation, type ShopHistoryEntry } from "./shopHistory";
import { galaxyLyFromSite, lyOrLast } from "./systemDistanceLy";

/** 0 = bought here before, 1 = recent visit, 2 = unknown. */
function shopHistoryStationTier(
  shopHistory: ShopHistoryEntry[],
  systemName: string,
  stationName: string,
): number {
  if (hasBoughtFromStation(shopHistory, systemName, stationName)) return 0;
  if (isRecentShopStation(shopHistory, systemName, stationName)) return 1;
  return 2;
}

/** Closest first from the construction site, then visited shops, then name. */
export function compareBuyStationHits(
  a: MaterialBuyStationHit,
  b: MaterialBuyStationHit,
  shopHistory: ShopHistoryEntry[],
  constructionSite: string,
  distanceMap: Record<string, number>,
): number {
  const da =
    galaxyLyFromSite(a.systemName, constructionSite, distanceMap) ?? lyOrLast(a.distanceLy);
  const db =
    galaxyLyFromSite(b.systemName, constructionSite, distanceMap) ?? lyOrLast(b.distanceLy);
  if (da !== db) return da - db;

  const ta = shopHistoryStationTier(shopHistory, a.systemName, a.stationName);
  const tb = shopHistoryStationTier(shopHistory, b.systemName, b.stationName);
  if (ta !== tb) return ta - tb;

  return a.stationName.localeCompare(b.stationName);
}
