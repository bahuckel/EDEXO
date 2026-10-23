import type { MaterialBuyStationHit } from "./materialBuyIndexTypes";
import { isCommanderBuyOffer } from "./stationSellOffer";
import { LIVE_SCAN_NEARBY_LY } from "./stationFilter";
import { constructionHopLy, isKnownLy } from "./systemDistanceLy";

/** True when at least one buy hit is within maxLy of the distance origin. */
export function hasBuyStationWithinLy(
  hits: MaterialBuyStationHit[],
  maxLy = LIVE_SCAN_NEARBY_LY,
  distanceBySystem: Record<string, number> = {},
  distanceOrigin?: string,
): boolean {
  if (!hits.length) return false;
  const distRef = distanceOrigin?.trim();
  for (const h of hits) {
    if (!isCommanderBuyOffer(h.supply, h.buyPrice)) continue;
    const ly =
      distRef && Object.keys(distanceBySystem).length > 0
        ? constructionHopLy(distRef, h.systemName, distanceBySystem)
        : h.distanceLy;
    if (isKnownLy(ly) && ly <= maxLy) return true;
  }
  return false;
}
