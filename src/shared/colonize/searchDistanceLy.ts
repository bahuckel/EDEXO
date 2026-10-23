import type { MaterialBuyStationHit } from "./materialBuyIndexTypes";
import { normSystemName } from "./stationFilter";
import { bestGalaxyLyFromSites, isKnownLy, lyOrLast } from "./systemDistanceLy";

/** Hop from active build site(s) for Search — 0 Ly only when seller is the construction system. */
export function resolveSearchHopLy(
  sellerSystem: string,
  constructionRefs: string[],
  distanceMap: Record<string, number>,
  savedLy?: number | null,
): number | null {
  const refs = constructionRefs.map((s) => s.trim()).filter(Boolean);
  const sellN = normSystemName(sellerSystem);
  if (sellN && refs.some((r) => normSystemName(r) === sellN)) return 0;

  if (refs.length && Object.keys(distanceMap).length) {
    const fromGalaxy = bestGalaxyLyFromSites(sellerSystem, refs, distanceMap);
    if (isKnownLy(fromGalaxy)) return fromGalaxy;
  }

  /**
   * A saved index distance is measured from whatever reference the row was searched from, which
   * in Search need not be one of these sites. A saved 0 says "same system as that reference" — and
   * if the seller were one of these sites, the first check above would already have said 0.
   */
  if (isKnownLy(savedLy) && savedLy > 0) return savedLy;
  return null;
}

export function sortMaterialBuyHitsBySearchDistance(
  hits: MaterialBuyStationHit[],
  constructionRefs: string[],
  distanceMap: Record<string, number>,
): MaterialBuyStationHit[] {
  return [...hits].sort((a, b) => {
    const da = lyOrLast(resolveSearchHopLy(a.systemName, constructionRefs, distanceMap, a.distanceLy));
    const db = lyOrLast(resolveSearchHopLy(b.systemName, constructionRefs, distanceMap, b.distanceLy));
    if (da !== db) return da - db;
    return a.stationName.localeCompare(b.stationName);
  });
}
